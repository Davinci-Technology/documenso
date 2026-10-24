import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';

if (process.env.SIGN_DELIVERY_TESTS !== 'true') {
  throw new Error('Delivery regression tests require explicit SIGN_DELIVERY_TESTS=true and an isolated database');
}
const database = new URL(process.env.NEXT_PRIVATE_DATABASE_URL ?? '');
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || !/rehearsal|test/.test(database.pathname)) {
  throw new Error('Delivery regression database must be a loopback rehearsal/test database');
}
process.env.NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY = randomBytes(32).toString('hex');
process.env.NEXT_PRIVATE_ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.NEXTAUTH_SECRET = randomBytes(32).toString('hex');

export default defineConfig({
  testDir: './e2e/api/delivery',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
});
