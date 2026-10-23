import { beforeEach, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  ingest: vi.fn(),
  verify: vi.fn(),
  groupBy: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock('@documenso/auth/server/lib/utils/get-session', () => ({ getOptionalSession: deps.getOptionalSession }));
vi.mock('@documenso/lib/server-only/email/sendgrid-events', () => ({
  ingestSendGridEvents: deps.ingest,
  verifySendGridSignature: deps.verify,
}));
vi.mock('@documenso/prisma', () => ({
  prisma: {
    backgroundJob: { groupBy: deps.groupBy, findMany: deps.findMany },
    emailDelivery: { groupBy: deps.groupBy, findMany: deps.findMany },
  },
}));

import { deliveryOperationsRoute } from '../../../../apps/remix/server/api/operations/delivery';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PRIVATE_SENDGRID_WEBHOOK_VERIFICATION_KEY;
});

it('fails closed when signed event verification is unconfigured or invalid', async () => {
  const request = () => deliveryOperationsRoute.request('/webhooks/sendgrid', { method: 'POST', body: '[]' });
  expect((await request()).status).toBe(503);
  process.env.NEXT_PRIVATE_SENDGRID_WEBHOOK_VERIFICATION_KEY = 'test-public-key';
  deps.verify.mockReturnValue(false);
  expect((await request()).status).toBe(403);
  expect(deps.ingest).not.toHaveBeenCalled();
});

it('accepts a verified bounded batch and rejects malformed/oversized event bodies', async () => {
  process.env.NEXT_PRIVATE_SENDGRID_WEBHOOK_VERIFICATION_KEY = 'test-public-key';
  deps.verify.mockReturnValue(true);
  expect((await deliveryOperationsRoute.request('/webhooks/sendgrid', { method: 'POST', body: '[]' })).status).toBe(
    200,
  );
  expect(deps.ingest).toHaveBeenCalledWith([]);
  expect(
    (await deliveryOperationsRoute.request('/webhooks/sendgrid', { method: 'POST', body: 'invalid' })).status,
  ).toBe(400);
  expect(
    (
      await deliveryOperationsRoute.request('/webhooks/sendgrid', {
        method: 'POST',
        headers: { 'content-length': '1048577' },
        body: '[]',
      })
    ).status,
  ).toBe(413);
});

it('requires a non-embedded administrator session for operational status', async () => {
  for (const auth of [
    { user: null, session: null },
    { user: { roles: ['USER'] }, session: {} },
    { user: { roles: ['ADMIN'] }, session: { isEmbed: true } },
  ]) {
    deps.getOptionalSession.mockResolvedValue(auth);
    expect((await deliveryOperationsRoute.request('/operations/delivery')).status).toBe(403);
  }
  expect(deps.groupBy).not.toHaveBeenCalled();
  deps.getOptionalSession.mockResolvedValue({ user: { roles: ['ADMIN'] }, session: { isEmbed: false } });
  deps.groupBy.mockResolvedValue([]);
  deps.findMany.mockResolvedValue([]);
  const response = await deliveryOperationsRoute.request('/operations/delivery');
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('not inbox placement');
});
