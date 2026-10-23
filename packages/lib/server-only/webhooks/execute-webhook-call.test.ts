import { createHmac, timingSafeEqual } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./assert-webhook-url', () => ({ assertNotPrivateUrl: vi.fn() }));
vi.mock('../../utils/timeout', () => ({ fetchWithTimeout: vi.fn() }));

import { fetchWithTimeout } from '../../utils/timeout';
import { assertNotPrivateUrl } from './assert-webhook-url';
import { executeWebhookCall } from './execute-webhook-call';

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PRIVATE_WEBHOOK_ALLOWED_HOSTS;
});

describe('webhook authentication contracts', () => {
  it('signs the exact serialized UTF8 bytes and preserves HR raw secret', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response('{}'));
    await executeWebhookCall({
      url: 'https://receiver.example/hook',
      body: { name: 'élève', nested: { a: 1 } },
      secret: 'test-secret',
    });
    const request = vi.mocked(fetchWithTimeout).mock.calls[0][1];
    const headers = request.headers as Record<string, string>;
    const expected = createHmac('sha256', 'test-secret')
      .update(request.body as string)
      .digest('hex');
    expect(headers['X-Documenso-Secret']).toBe('test-secret');
    expect(headers['X-Documenso-Signature']).toBe(`sha256=${expected}`);
    expect(request.redirect).toBe('manual');
    const wrong = createHmac('sha256', 'test-secret').update(`${request.body} `).digest('hex');
    expect(timingSafeEqual(Buffer.from(expected), Buffer.from(wrong))).toBe(false);
    expect(headers['X-Davinci-Secret']).toBeUndefined();
  });
  it('does not invent a signature when the webhook has no secret', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response('{}'));
    await executeWebhookCall({ url: 'https://receiver.example/hook', body: {}, secret: null });
    expect(
      (vi.mocked(fetchWithTimeout).mock.calls[0][1].headers as Record<string, string>)['X-Documenso-Signature'],
    ).toBeUndefined();
  });
  it('blocks real callback destinations in restricted staging', async () => {
    process.env.NEXT_PRIVATE_WEBHOOK_ALLOWED_HOSTS = 'sink.example';
    const result = await executeWebhookCall({ url: 'https://production.example/hook', body: {}, secret: 'test' });
    expect(result.success).toBe(false);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
  it('allows only the explicit trusted sink while retaining public-only protection by default', async () => {
    process.env.NEXT_PRIVATE_WEBHOOK_ALLOWED_HOSTS = 'sink.example';
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response('{}'));
    const result = await executeWebhookCall({ url: 'http://sink.example/hook', body: {}, secret: 'synthetic' });
    expect(result.success).toBe(true);
    expect(assertNotPrivateUrl).not.toHaveBeenCalled();
    delete process.env.NEXT_PRIVATE_WEBHOOK_ALLOWED_HOSTS;
    await executeWebhookCall({ url: 'https://public.example/hook', body: {}, secret: 'synthetic' });
    expect(assertNotPrivateUrl).toHaveBeenCalledWith('https://public.example/hook');
  });
});
