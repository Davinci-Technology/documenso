import { prisma } from '@documenso/prisma';
import { OrganisationGroupType, OrganisationMemberRole, TeamMemberRole } from '@prisma/client';

import { getOidcAutoJoinOrganisationId, getOidcGroupTeamMapRaw } from '../../constants/auth';
import { generateDatabaseId } from '../../universal/id';
import { logger } from '../../utils/logger';
import { addUserToOrganisation } from './accept-organisation-invitation';

/**
 * Entra group object id (lowercased) -> team url.
 */
export type OidcGroupTeamMap = Record<string, string>;

export type OidcGroupsClaim = {
  /**
   * The `groups` claim from the ID token, or `undefined` when it was not emitted.
   */
  groups: string[] | undefined;

  /**
   * True when the IdP signalled group overage (Entra sets `_claim_names.groups`
   * instead of the `groups` claim when the user is in too many groups).
   */
  hasGroupOverage: boolean;
};

/**
 * Read the `groups` claim and the Entra group overage marker from decoded ID token claims.
 */
export const extractOidcGroupsClaim = (claims: Record<string, unknown>): OidcGroupsClaim => {
  const claimNames = claims._claim_names;

  const hasGroupOverage =
    typeof claimNames === 'object' && claimNames !== null && 'groups' in claimNames && Boolean(claimNames.groups);

  const groups = Array.isArray(claims.groups)
    ? claims.groups.filter((group): group is string => typeof group === 'string')
    : undefined;

  return { groups, hasGroupOverage };
};

/**
 * Parse the NEXT_PRIVATE_OIDC_GROUP_TEAM_MAP JSON object. Returns `null` when the
 * value is empty or not a JSON object of string -> non-empty string.
 */
export const parseOidcGroupTeamMap = (raw: string | undefined): OidcGroupTeamMap | null => {
  if (!raw || !raw.trim()) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const map: OidcGroupTeamMap = {};

  for (const [groupId, teamUrl] of Object.entries(parsed)) {
    if (typeof teamUrl !== 'string' || !teamUrl.trim() || !groupId.trim()) {
      return null;
    }

    map[groupId.trim().toLowerCase()] = teamUrl.trim();
  }

  return map;
};

export type ComputeTeamGroupChangesOptions = {
  groupTeamMap: OidcGroupTeamMap;
  groupsClaim: OidcGroupsClaim;
  /**
   * The mapped teams that exist in the organisation, with the id of each team's
   * INTERNAL_TEAM MEMBER-role organisation group.
   */
  teams: { url: string; memberGroupId: string }[];
  /**
   * Every organisation group id the member currently belongs to.
   */
  currentGroupIds: string[];
};

export type TeamGroupChanges =
  | { skipped: 'missing_groups_claim' | 'group_overage'; addGroupIds: []; removeGroupIds: [] }
  | { skipped: null; addGroupIds: string[]; removeGroupIds: string[] };

/**
 * Pure diff: which team MEMBER groups to add the member to and remove them from.
 *
 * Only the MEMBER groups of the supplied (mapped) teams are ever returned, so
 * unmapped teams and every other group are left untouched. When the groups
 * claim is missing or overage was signalled nothing is changed at all.
 */
export const computeTeamGroupChanges = ({
  groupTeamMap,
  groupsClaim,
  teams,
  currentGroupIds,
}: ComputeTeamGroupChangesOptions): TeamGroupChanges => {
  if (groupsClaim.hasGroupOverage) {
    return { skipped: 'group_overage', addGroupIds: [], removeGroupIds: [] };
  }

  if (!groupsClaim.groups) {
    return { skipped: 'missing_groups_claim', addGroupIds: [], removeGroupIds: [] };
  }

  const mappedTeamUrls = new Set(Object.values(groupTeamMap));

  const desiredTeamUrls = new Set(
    groupsClaim.groups
      .map((groupId) => groupTeamMap[groupId.trim().toLowerCase()])
      .filter((teamUrl): teamUrl is string => Boolean(teamUrl)),
  );

  const current = new Set(currentGroupIds);

  const addGroupIds = new Set<string>();
  const removeGroupIds = new Set<string>();

  for (const team of teams) {
    if (!mappedTeamUrls.has(team.url)) {
      continue;
    }

    const isMember = current.has(team.memberGroupId);

    if (desiredTeamUrls.has(team.url)) {
      if (!isMember) {
        addGroupIds.add(team.memberGroupId);
      }
    } else if (isMember) {
      removeGroupIds.add(team.memberGroupId);
    }
  }

  return { skipped: null, addGroupIds: [...addGroupIds], removeGroupIds: [...removeGroupIds] };
};

export type SyncOidcMembershipsOptions = {
  userId: number;
  groupsClaim: OidcGroupsClaim;
};

/**
 * On OIDC sign-in: auto-join the configured organisation as MEMBER and sync the
 * mapped teams' MEMBER groups from the IdP groups claim.
 *
 * Never throws; every failure is logged so sign-in is never blocked.
 */
export const syncOidcMemberships = async (options: SyncOidcMembershipsOptions) => {
  try {
    await syncOidcMembershipsOrThrow(options);
  } catch (error) {
    logger.error({
      msg: 'OIDC membership sync failed',
      event: 'auth.oidc.membership_sync_failed',
      userId: options.userId,
      error,
    });
  }
};

const findOrganisationMember = async (userId: number, organisationId: string) =>
  await prisma.organisationMember.findUnique({
    where: {
      userId_organisationId: { userId, organisationId },
    },
    include: {
      organisationGroupMembers: {
        include: {
          group: true,
        },
      },
    },
  });

const syncOidcMembershipsOrThrow = async ({ userId, groupsClaim }: SyncOidcMembershipsOptions) => {
  const organisationId = getOidcAutoJoinOrganisationId();

  if (!organisationId) {
    return;
  }

  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
    include: { groups: true },
  });

  if (!organisation) {
    logger.warn({
      msg: 'OIDC auto-join organisation not found',
      event: 'auth.oidc.membership_sync_skipped',
      organisationId,
    });

    return;
  }

  let member = await findOrganisationMember(userId, organisationId);

  if (!member) {
    try {
      await addUserToOrganisation({
        userId,
        organisationId,
        organisationGroups: organisation.groups,
        organisationMemberRole: OrganisationMemberRole.MEMBER,
        bypassEmail: true,
      });

      logger.info({
        msg: 'OIDC user auto-joined organisation',
        event: 'auth.oidc.organisation_joined',
        userId,
        organisationId,
      });
    } catch (error) {
      // A concurrent sign-in may have created the membership first.
      if (!(await findOrganisationMember(userId, organisationId))) {
        throw error;
      }
    }

    member = await findOrganisationMember(userId, organisationId);
  }

  if (!member) {
    return;
  }

  const groupTeamMapRaw = getOidcGroupTeamMapRaw();

  if (!groupTeamMapRaw) {
    return;
  }

  const groupTeamMap = parseOidcGroupTeamMap(groupTeamMapRaw);

  if (!groupTeamMap) {
    logger.warn({
      msg: 'NEXT_PRIVATE_OIDC_GROUP_TEAM_MAP is not a JSON object of group id -> team url; skipping team sync',
      event: 'auth.oidc.team_sync_skipped',
      userId,
    });

    return;
  }

  // Owners and admins already reach every team through their organisation role; leave them alone.
  const isOwnerOrAdmin =
    organisation.ownerUserId === userId ||
    member.organisationGroupMembers.some(
      ({ group }) =>
        group.type === OrganisationGroupType.INTERNAL_ORGANISATION &&
        group.organisationRole === OrganisationMemberRole.ADMIN,
    );

  if (isOwnerOrAdmin) {
    return;
  }

  const mappedTeamUrls = [...new Set(Object.values(groupTeamMap))];

  const teams = await prisma.team.findMany({
    where: {
      organisationId,
      url: { in: mappedTeamUrls },
    },
    select: {
      url: true,
      teamGroups: {
        where: {
          teamRole: TeamMemberRole.MEMBER,
          organisationGroup: {
            type: OrganisationGroupType.INTERNAL_TEAM,
            organisationId,
          },
        },
        select: {
          organisationGroupId: true,
        },
      },
    },
  });

  const missingTeamUrls = mappedTeamUrls.filter((url) => !teams.some((team) => team.url === url));

  if (missingTeamUrls.length > 0) {
    logger.warn({
      msg: 'Mapped OIDC teams not found in organisation',
      event: 'auth.oidc.team_sync_missing_teams',
      organisationId,
      teamUrls: missingTeamUrls,
    });
  }

  const changes = computeTeamGroupChanges({
    groupTeamMap,
    groupsClaim,
    teams: teams.flatMap((team) => {
      const memberGroup = team.teamGroups[0];

      return memberGroup ? [{ url: team.url, memberGroupId: memberGroup.organisationGroupId }] : [];
    }),
    currentGroupIds: member.organisationGroupMembers.map(({ groupId }) => groupId),
  });

  if (changes.skipped) {
    logger.warn({
      msg: 'OIDC groups claim unavailable; skipping team sync',
      event: 'auth.oidc.team_sync_skipped',
      reason: changes.skipped,
      userId,
    });

    return;
  }

  if (changes.addGroupIds.length === 0 && changes.removeGroupIds.length === 0) {
    return;
  }

  const organisationMemberId = member.id;

  await prisma.$transaction(async (tx) => {
    if (changes.addGroupIds.length > 0) {
      await tx.organisationGroupMember.createMany({
        data: changes.addGroupIds.map((groupId) => ({
          id: generateDatabaseId('group_member'),
          groupId,
          organisationMemberId,
        })),
        skipDuplicates: true,
      });
    }

    if (changes.removeGroupIds.length > 0) {
      await tx.organisationGroupMember.deleteMany({
        where: {
          organisationMemberId,
          groupId: { in: changes.removeGroupIds },
        },
      });
    }
  });

  logger.info({
    msg: 'OIDC team memberships synced',
    event: 'auth.oidc.team_sync_applied',
    userId,
    organisationId,
    addedGroupIds: changes.addGroupIds,
    removedGroupIds: changes.removeGroupIds,
  });
};
