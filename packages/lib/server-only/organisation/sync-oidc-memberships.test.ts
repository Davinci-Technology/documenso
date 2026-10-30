import { describe, expect, it, vi } from 'vitest';

vi.mock('@documenso/prisma', () => ({ prisma: {} }));
vi.mock('./accept-organisation-invitation', () => ({ addUserToOrganisation: vi.fn() }));
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { computeTeamGroupChanges, extractOidcGroupsClaim, parseOidcGroupTeamMap } = await import(
  './sync-oidc-memberships'
);

const HR_GROUP = '6e679ae0-5c04-4a07-b3c8-7e8223bfd5e8';
const SALES_GROUP = 'ce247c2a-a41b-4ee0-afc4-d6119b82f438';

const groupTeamMap = {
  [HR_GROUP]: 'human-resources',
  [SALES_GROUP]: 'sales',
};

const teams = [
  { url: 'human-resources', memberGroupId: 'hr-member' },
  { url: 'sales', memberGroupId: 'sales-member' },
];

describe('computeTeamGroupChanges', () => {
  it('adds the member to a mapped team they are in the Entra group for', () => {
    const changes = computeTeamGroupChanges({
      groupTeamMap,
      groupsClaim: { groups: [HR_GROUP], hasGroupOverage: false },
      teams,
      currentGroupIds: ['org-member-group'],
    });

    expect(changes).toEqual({ skipped: null, addGroupIds: ['hr-member'], removeGroupIds: [] });
  });

  it('removes the member from a mapped team they are no longer in the Entra group for', () => {
    const changes = computeTeamGroupChanges({
      groupTeamMap,
      groupsClaim: { groups: [HR_GROUP], hasGroupOverage: false },
      teams,
      currentGroupIds: ['org-member-group', 'hr-member', 'sales-member'],
    });

    expect(changes).toEqual({ skipped: null, addGroupIds: [], removeGroupIds: ['sales-member'] });
  });

  it('matches group ids case-insensitively', () => {
    const changes = computeTeamGroupChanges({
      groupTeamMap,
      groupsClaim: { groups: [SALES_GROUP.toUpperCase()], hasGroupOverage: false },
      teams,
      currentGroupIds: [],
    });

    expect(changes.addGroupIds).toEqual(['sales-member']);
  });

  it('never touches unmapped teams or other groups', () => {
    const changes = computeTeamGroupChanges({
      groupTeamMap,
      groupsClaim: { groups: ['some-unmapped-entra-group'], hasGroupOverage: false },
      teams: [...teams, { url: 'admin_uefcp8j7', memberGroupId: 'admin-team-member' }],
      currentGroupIds: ['admin-team-member', 'hr-manager-group', 'org-admin-group'],
    });

    expect(changes).toEqual({ skipped: null, addGroupIds: [], removeGroupIds: [] });
  });

  it('is a no-op when the member already matches the claim', () => {
    const changes = computeTeamGroupChanges({
      groupTeamMap,
      groupsClaim: { groups: [HR_GROUP, SALES_GROUP], hasGroupOverage: false },
      teams,
      currentGroupIds: ['hr-member', 'sales-member'],
    });

    expect(changes).toEqual({ skipped: null, addGroupIds: [], removeGroupIds: [] });
  });

  it('makes no changes (no removals) when the groups claim is missing', () => {
    const changes = computeTeamGroupChanges({
      groupTeamMap,
      groupsClaim: { groups: undefined, hasGroupOverage: false },
      teams,
      currentGroupIds: ['hr-member', 'sales-member'],
    });

    expect(changes).toEqual({ skipped: 'missing_groups_claim', addGroupIds: [], removeGroupIds: [] });
  });

  it('makes no changes (no removals) on group overage', () => {
    const changes = computeTeamGroupChanges({
      groupTeamMap,
      groupsClaim: { groups: [], hasGroupOverage: true },
      teams,
      currentGroupIds: ['hr-member', 'sales-member'],
    });

    expect(changes).toEqual({ skipped: 'group_overage', addGroupIds: [], removeGroupIds: [] });
  });

  it('removes from every mapped team when the claim is present but empty', () => {
    const changes = computeTeamGroupChanges({
      groupTeamMap,
      groupsClaim: { groups: [], hasGroupOverage: false },
      teams,
      currentGroupIds: ['hr-member', 'sales-member'],
    });

    expect(changes.removeGroupIds.sort()).toEqual(['hr-member', 'sales-member']);
  });
});

describe('extractOidcGroupsClaim', () => {
  it('reads the groups claim', () => {
    expect(extractOidcGroupsClaim({ groups: [HR_GROUP, 42] })).toEqual({
      groups: [HR_GROUP],
      hasGroupOverage: false,
    });
  });

  it('reports a missing claim as undefined', () => {
    expect(extractOidcGroupsClaim({})).toEqual({ groups: undefined, hasGroupOverage: false });
  });

  it('detects Entra group overage', () => {
    expect(extractOidcGroupsClaim({ _claim_names: { groups: 'src1' } }).hasGroupOverage).toBe(true);
  });
});

describe('parseOidcGroupTeamMap', () => {
  it('parses and lowercases group ids', () => {
    expect(parseOidcGroupTeamMap(JSON.stringify({ 'ABC-1': 'sales' }))).toEqual({ 'abc-1': 'sales' });
  });

  it.each([undefined, '', 'not json', '[]', '{"a":1}', '{"a":""}'])('rejects %s', (raw) => {
    expect(parseOidcGroupTeamMap(raw)).toBeNull();
  });
});
