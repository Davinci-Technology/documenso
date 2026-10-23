import { cpSync } from 'node:fs';
import { serve } from '@hono/node-server';

// The normal app build copies compiled catalogs after rollup. This API-only
// fixture uses the same catalogs without building the unrelated browser client.
cpSync(
  new URL('../../lib/translations/', import.meta.url),
  new URL('../../../apps/remix/build/server/hono/packages/lib/translations/', import.meta.url),
  { recursive: true },
);
const { default: app } = await import('../../../apps/remix/build/server/hono/server/router.js');
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT) });
