import { DateTime } from 'luxon';

import { DEFAULT_DOCUMENT_TIME_ZONE, TIME_ZONES } from '../constants/time-zones';
import { env } from './env';

/**
 * The zone for a new document when neither the request nor the organisation/team picks one.
 *
 * The value is the same on the server and in the browser. Falls back to UTC when the deployment
 * setting is missing or not a known zone.
 */
export const getDefaultDocumentTimeZone = (): string => {
  const timeZone = env('NEXT_PUBLIC_DEFAULT_DOCUMENT_TIME_ZONE')?.trim();

  return timeZone && TIME_ZONES.includes(timeZone) ? timeZone : DEFAULT_DOCUMENT_TIME_ZONE;
};

/**
 * A stored instant shown in the document's zone. A missing or unknown zone reads as UTC,
 * the same way the date stamps are written.
 */
export const toDocumentTimeZone = (date: Date, timeZone?: string | null): DateTime => {
  const inZone = DateTime.fromJSDate(date).setZone(timeZone || DEFAULT_DOCUMENT_TIME_ZONE);

  return inZone.isValid ? inZone : DateTime.fromJSDate(date).setZone(DEFAULT_DOCUMENT_TIME_ZONE);
};
