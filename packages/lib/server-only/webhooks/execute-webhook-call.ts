import { createHmac } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { fetchWithTimeout } from '../../utils/timeout';
import { assertNotPrivateUrl } from './assert-webhook-url';

const WEBHOOK_TIMEOUT_MS = 10_000;

export type WebhookCallResult = {
  success: boolean;
  responseCode: number;
  responseBody: Prisma.InputJsonValue | Prisma.JsonNullValueInput;
  responseHeaders: Record<string, string>;
};

const parseBody = (text: string): Prisma.InputJsonValue => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const executeWebhookCall = async (options: {
  url: string;
  body: unknown;
  secret: string | null;
}): Promise<WebhookCallResult> => {
  const { url, body, secret } = options;

  try {
    const allowedHosts = process.env.NEXT_PRIVATE_WEBHOOK_ALLOWED_HOSTS;
    if (
      allowedHosts !== undefined &&
      !allowedHosts
        .split(',')
        .map((host) => host.trim())
        .includes(new URL(url).hostname)
    ) {
      throw new Error('Webhook destination is not allowed in this environment');
    }
    // An explicit operator allowlist permits isolated private callback sinks.
    // Without it, retain the default public-only SSRF protection.
    if (allowedHosts === undefined) {
      await assertNotPrivateUrl(url);
    }
    // Serialize exactly once: Meridian authenticates the transmitted UTF-8 bytes.
    const serializedBody = JSON.stringify(body);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      body: serializedBody,
      redirect: 'manual',
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Secret': secret ?? '',
        ...(secret
          ? { 'X-Documenso-Signature': `sha256=${createHmac('sha256', secret).update(serializedBody).digest('hex')}` }
          : {}),
      },
    });

    const text = await response.text();

    return {
      success: response.ok,
      responseCode: response.status,
      responseBody: parseBody(text),
      responseHeaders: Object.fromEntries(response.headers.entries()),
    };
  } catch (err) {
    return {
      success: false,
      responseCode: 0,
      responseBody: err instanceof Error ? err.message : 'Unknown error',
      responseHeaders: {},
    };
  }
};
