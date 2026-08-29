/**
 * One-shot schema migration for the Postgres store. Intended as the Deno
 * Deploy pre-deploy command (Settings → App Config → Pre-Deploy Command):
 *
 *   deno task migrate:pg
 *
 * Runs with the same env as the app — on Deploy that includes the injected
 * DATABASE_URL / PG* variables for the attached Prisma Postgres instance.
 */

// @ts-types="npm:@types/pg"
import { Pool } from 'pg';
import { ensureSchema } from './store.ts';

const dbUrl = Deno.env.get('DATABASE_URL');
const pool = new Pool(dbUrl ? { connectionString: dbUrl } : {});
try {
  await ensureSchema(pool);
  console.log('players table ready');
} finally {
  await pool.end();
}
