import { DateTime } from 'luxon';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractDerivedDocumentMeta } from './document';
import { getDefaultDocumentTimeZone, toDocumentTimeZone } from './document-time-zone';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getDefaultDocumentTimeZone', () => {
  it('returns UTC when the setting is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_DOCUMENT_TIME_ZONE', undefined);

    expect(getDefaultDocumentTimeZone()).toBe('Etc/UTC');
  });

  it('returns the configured zone', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_DOCUMENT_TIME_ZONE', 'America/Edmonton');

    expect(getDefaultDocumentTimeZone()).toBe('America/Edmonton');
  });

  it('trims the configured zone', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_DOCUMENT_TIME_ZONE', ' America/Edmonton ');

    expect(getDefaultDocumentTimeZone()).toBe('America/Edmonton');
  });

  it('returns UTC when the setting is empty', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_DOCUMENT_TIME_ZONE', '');

    expect(getDefaultDocumentTimeZone()).toBe('Etc/UTC');
  });

  it('returns UTC when the setting is not a known zone', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_DOCUMENT_TIME_ZONE', 'Mars/Olympus');

    expect(getDefaultDocumentTimeZone()).toBe('Etc/UTC');
  });
});

describe('toDocumentTimeZone', () => {
  // Only instants that old and new tz data agree on, so the result does not depend on the runner's Node.
  it.each([
    ['2026-01-15T16:00:00Z', '2026-01-15 09:00'],
    ['2026-07-15T15:00:00Z', '2026-07-15 09:00'],
    ['2026-11-01T07:59:00Z', '2026-11-01 01:59'],
    ['2027-07-15T15:00:00Z', '2027-07-15 09:00'],
  ])('shows %s as %s in America/Edmonton', (iso, expected) => {
    expect(toDocumentTimeZone(new Date(iso), 'America/Edmonton').toFormat('yyyy-MM-dd HH:mm')).toBe(expected);
  });

  it.each([null, undefined, '', 'Not/AZone'])('reads %j as UTC', (timeZone) => {
    const date = new Date('2026-07-15T15:00:00Z');

    const result = toDocumentTimeZone(date, timeZone);

    expect(result.isValid).toBe(true);
    expect(result.zoneName).toBe('Etc/UTC');
    expect(result.toFormat('yyyy-MM-dd HH:mm ZZZZ')).toBe(
      DateTime.fromJSDate(date).setZone('Etc/UTC').toFormat('yyyy-MM-dd HH:mm ZZZZ'),
    );
  });

  it('prints a UTC document as literal text', () => {
    expect(
      toDocumentTimeZone(new Date('2026-03-04T17:05:09Z'), 'Etc/UTC')
        .setLocale('en-US')
        .toFormat('yyyy-MM-dd hh:mm:ss a (ZZZZ)'),
    ).toBe('2026-03-04 05:05:09 PM (UTC)');
  });

  it('prints an old UTC document the way a UTC server did', () => {
    const date = new Date('2026-03-04T17:05:09Z');
    const format = 'yyyy-MM-dd hh:mm:ss a (ZZZZ)';

    expect(toDocumentTimeZone(date, 'Etc/UTC').toFormat(format)).toBe(
      DateTime.fromJSDate(date).setZone('Etc/UTC').toFormat(format),
    );
  });
});

describe('extractDerivedDocumentMeta timezone', () => {
  const settings = (documentTimezone: string | null) =>
    ({ documentTimezone }) as Parameters<typeof extractDerivedDocumentMeta>[0];

  it('prefers the meta zone', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_DOCUMENT_TIME_ZONE', 'America/Edmonton');

    expect(extractDerivedDocumentMeta(settings('Europe/London'), { timezone: 'Asia/Tokyo' }).timezone).toBe(
      'Asia/Tokyo',
    );
  });

  it('uses the settings zone when the meta has none', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_DOCUMENT_TIME_ZONE', 'America/Edmonton');

    expect(extractDerivedDocumentMeta(settings('Europe/London'), {}).timezone).toBe('Europe/London');
  });

  it('uses the deployment default when neither has a zone', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_DOCUMENT_TIME_ZONE', 'America/Edmonton');

    expect(extractDerivedDocumentMeta(settings(null), {}).timezone).toBe('America/Edmonton');
  });

  it('uses UTC when the deployment default is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_DOCUMENT_TIME_ZONE', undefined);

    expect(extractDerivedDocumentMeta(settings(null), {}).timezone).toBe('Etc/UTC');
  });
});
