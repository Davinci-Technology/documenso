import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const url = new URL(process.env.NEXT_PRIVATE_DATABASE_URL ?? '');
if (
  process.env.SIGN_DELIVERY_TESTS !== 'true' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  !/rehearsal|test/.test(url.pathname)
) {
  throw new Error('Use an explicitly authorized fresh loopback rehearsal/test database');
}
const db = new pg.Client({ connectionString: url.toString() });
const directory = await mkdtemp(path.join(os.tmpdir(), 'sign-migration-'));
const run = (command, args, input) => {
  const result = spawnSync(command, args, {
    cwd: root,
    input,
    encoding: undefined,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, NEXT_PRIVATE_DIRECT_DATABASE_URL: url.toString() },
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${String(result.stderr)}`);
  }
  return result.stdout;
};
try {
  await db.connect();
  assert.equal(Math.floor(Number((await db.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 15);
  assert.equal(
    (await db.query('SELECT to_regclass(\'public."_prisma_migrations"\') AS table_name')).rows[0].table_name,
    null,
    'Refusing a previously migrated database',
  );
  const baseline = run('git', [
    'archive',
    '--format=tar',
    'c646631295cab18b8b35a8dea4e54933a76f1f2c',
    'packages/prisma',
  ]);
  run('tar', ['-xf', '-', '-C', directory], baseline);
  const migrate = (schema) =>
    run(process.execPath, [
      path.join(root, 'node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      schema,
    ]);
  migrate(path.join(directory, 'packages/prisma/schema.prisma'));
  await db.query(`INSERT INTO "BackgroundJob" (id,"jobId",name,version,"updatedAt",payload,status) VALUES
    ('migration-pending','migration.synthetic','Synthetic pending','1',NOW(),'{"opaqueId":"synthetic"}','PENDING'),
    ('migration-legacy','internal.seal-document','Synthetic legacy parent','1',NOW()-interval '5 minutes','{}','PROCESSING')`);
  migrate(path.join(root, 'packages/prisma/schema.prisma'));
  migrate(path.join(root, 'packages/prisma/schema.prisma'));
  const rows = (
    await db.query(`SELECT id,status,payload,"availableAt" IS NOT NULL AS backfilled,"leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL AS unfenced
    FROM "BackgroundJob" ORDER BY id`)
  ).rows;
  assert.equal(rows.length, 2);
  assert(rows.every((row) => row.backfilled && row.unfenced));
  assert.equal(rows.find((row) => row.id === 'migration-pending').payload.opaqueId, 'synthetic');
  const migrations = Number(
    (await db.query('SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows[0].count,
  );
  assert.equal(migrations, 167);
  console.log(
    JSON.stringify({
      postgresMajor: 15,
      migrations,
      retainedJobs: rows.length,
      availabilityBackfilled: true,
      legacyLeaseNull: true,
      redeployIdempotent: true,
    }),
  );
} finally {
  await db.end();
  await rm(directory, { recursive: true, force: true });
}
