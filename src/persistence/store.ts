/**
 * Persistence: PlayerState storage behind a small interface.
 * - PgStore: Postgres via npm:pg. On Deno Deploy, an attached Prisma Postgres
 *   instance injects DATABASE_URL / PG* env vars (see docs.deno.com/deploy/
 *   reference/databases); any standard Postgres works locally too.
 * - MemoryStore: in-memory (tests).
 */

// @ts-types="npm:@types/pg"
import { Pool } from 'pg';
import type { PlayerState } from '../engine/types.ts';

export interface PlayerStore {
  get(userId: number): Promise<PlayerState | undefined>;
  set(userId: number, state: PlayerState): Promise<void>;
  delete(userId: number): Promise<void>;
  /** Serializes load → mutate → render → save for one user ACROSS bot
   * instances (#18): Postgres holds a session advisory lock keyed by the
   * user id on a dedicated connection for the duration of `fn`, so two
   * instances can never interleave read-modify-write cycles for the same
   * player and a committed update is never silently lost. The in-memory
   * store is a passthrough — a single process serializes per-user work via
   * the bot's promise chain and has no cross-instance race. */
  withLock<T>(userId: number, fn: () => Promise<T>): Promise<T>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS players (
    user_id    BIGINT PRIMARY KEY,
    data       JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

/** Idempotent schema creation — shared by PgStore.open and `deno task migrate:pg`. */
export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
}

export class MemoryStore implements PlayerStore {
  private map = new Map<number, PlayerState>();

  // deno-lint-ignore require-await
  async get(userId: number): Promise<PlayerState | undefined> {
    return this.map.get(userId);
  }

  // deno-lint-ignore require-await
  async set(userId: number, state: PlayerState): Promise<void> {
    this.map.set(userId, structuredClone(state));
  }

  // deno-lint-ignore require-await
  async delete(userId: number): Promise<void> {
    this.map.delete(userId);
  }

  // deno-lint-ignore require-await
  async withLock<T>(_userId: number, fn: () => Promise<T>): Promise<T> {
    // Single process: the bot's per-user promise chain already serializes
    // load→mutate→save; there is no cross-instance race to guard (#18).
    return fn();
  }
}

/**
 * Postgres-backed store. PlayerState is plain JSON (no Dates/Maps/Sets), so a
 * single JSONB column round-trips it losslessly. pg parses jsonb columns back
 * into JS objects, so get() returns the state as-is.
 */
export class PgStore implements PlayerStore {
  private pool: Pool;

  private constructor(pool: Pool) {
    this.pool = pool;
  }

  static async open(connectionString?: string): Promise<PgStore> {
    // No args → pg reads PGHOST/PGPORT/PGUSER/… env vars, which is exactly
    // what Deno Deploy injects for attached Postgres instances.
    const pool = new Pool(connectionString ? { connectionString } : {});
    await pool.query('SELECT 1'); // fail fast with a clear error if unreachable
    await ensureSchema(pool);
    return new PgStore(pool);
  }

  async get(userId: number): Promise<PlayerState | undefined> {
    const res = await this.pool.query<{ data: PlayerState }>(
      'SELECT data FROM players WHERE user_id = $1',
      [userId],
    );
    return res.rows[0]?.data ?? undefined;
  }

  async set(userId: number, state: PlayerState): Promise<void> {
    await this.pool.query(
      `INSERT INTO players (user_id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE
       SET data = EXCLUDED.data, updated_at = now()`,
      [userId, JSON.stringify(state)],
    );
  }

  async delete(userId: number): Promise<void> {
    await this.pool.query('DELETE FROM players WHERE user_id = $1', [userId]);
  }

  /** Release connections — used by tests; Deploy tears isolates down itself. */
  // Called via `store.close()` in tests/persistence_pg_test.ts:37; fallow's
  // member analysis can't trace it through the concrete type.
  // fallow-ignore-next-line unused-class-member
  close(): Promise<void> {
    return this.pool.end();
  }

  /** Cross-instance serialization (#18): a SESSION advisory lock on a
   * DEDICATED connection encloses the whole load→mutate→save cycle, so two
   * bot instances can never interleave read-modify-write for one player —
   * the second instance waits, then works on the freshly saved state.
   * Same key on one connection would no-op, hence the dedicated client;
   * the in-process promise chain guarantees one lock per user at a time
   * locally, so waiting is the only cross-instance behavior ever seen. */
  async withLock<T>(userId: number, fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      // Telegram user ids fit int64 comfortably; advisory locks are
      // session-scoped and released explicitly (or on connection close).
      await client.query('SELECT pg_advisory_lock($1)', [userId]);
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [userId]);
      }
    } finally {
      client.release();
    }
  }
}
