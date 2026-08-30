/**
 * Persistence: PlayerState storage behind a small interface.
 * - PgStore: Postgres via npm:pg. On Deno Deploy, an attached Prisma Postgres
 *   instance injects DATABASE_URL / PG* env vars (see docs.deno.com/deploy/
 *   reference/databases); any standard Postgres works locally too.
 * - MemoryStore: in-memory (tests).
 */

// @ts-types="npm:@types/pg"
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PlayerState } from '../engine/types.ts';

/** Inside a `withLock` section (#37) this carries the section's dedicated
 * client, so get/set/delete route through the connection that already holds
 * the advisory lock. A lock holder must never wait on the pool it is
 * occupying — at the pool limit that deadlocks the entire bot. */
const lockClient = new AsyncLocalStorage<PoolClient>();

export interface PlayerStore {
  get(userId: number): Promise<PlayerState | undefined>;
  set(userId: number, state: PlayerState): Promise<void>;
  delete(userId: number): Promise<void>;
  /** Serializes load → mutate → render → save for one user ACROSS bot
   * instances (#18): Postgres holds a transaction-scoped advisory lock keyed
   * by the user id on a dedicated connection for the duration of `fn`, and
   * fn's state queries run on that SAME connection (#37) — so two instances
   * can never interleave read-modify-write cycles for the same player, a
   * committed update is never silently lost, and concurrent distinct-user
   * updates can never starve the pool. The in-memory store is a passthrough
   * — a single process serializes per-user work via the bot's promise chain
   * and has no cross-instance race. */
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

  static async open(
    connectionString?: string,
    poolOpts?: { max?: number },
  ): Promise<PgStore> {
    // No args → pg reads PGHOST/PGPORT/PGUSER/… env vars, which is exactly
    // what Deno Deploy injects for attached Postgres instances.
    const pool = new Pool(
      connectionString ? { connectionString, ...poolOpts } : { ...poolOpts },
    );
    await pool.query('SELECT 1'); // fail fast with a clear error if unreachable
    await ensureSchema(pool);
    return new PgStore(pool);
  }

  /** Every state query flows through here: inside a withLock section it
   * MUST use the section's own client (#37) — a lock holder waiting on
   * `pool.query()` while pinning the last pool client deadlocks all
   * concurrent updates. Outside the lock, the pool is fine. */
  private query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    const client = lockClient.getStore();
    return client
      ? client.query<R>(text, values as never[])
      : this.pool.query<R>(text, values as never[]);
  }

  async get(userId: number): Promise<PlayerState | undefined> {
    const res = await this.query<{ data: PlayerState }>(
      'SELECT data FROM players WHERE user_id = $1',
      [userId],
    );
    return res.rows[0]?.data ?? undefined;
  }

  async set(userId: number, state: PlayerState): Promise<void> {
    await this.query(
      `INSERT INTO players (user_id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE
       SET data = EXCLUDED.data, updated_at = now()`,
      [userId, JSON.stringify(state)],
    );
  }

  async delete(userId: number): Promise<void> {
    await this.query('DELETE FROM players WHERE user_id = $1', [userId]);
  }

  /** Release connections — used by tests; Deploy tears isolates down itself. */
  // Called via `store.close()` in tests/persistence_pg_test.ts:37; fallow's
  // member analysis can't trace it through the concrete type.
  // fallow-ignore-next-line unused-class-member
  close(): Promise<void> {
    return this.pool.end();
  }

  /** Cross-instance serialization (#18, #37): the whole load→mutate→save
   * cycle runs inside a TRANSACTION on a dedicated client, under a
   * transaction-scoped advisory lock — COMMIT/ROLLBACK releases the lock
   * itself, so there is no explicit unlock step whose failure could hand a
   * pooled session back with the lock still attached. fn's get/set/delete
   * route through that same client (async-local scope), so a lock holder
   * never needs a second pool connection: N concurrent distinct-user
   * updates can never starve the pool. A failed section rolls back
   * atomically — half-applied state can never commit. */
  async withLock<T>(userId: number, fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      let result: T;
      try {
        await client.query('BEGIN');
        // Telegram user ids fit int64 comfortably; the lock lives until the
        // transaction ends — release is tied to commit/rollback, not to a
        // separate unlock query that could itself fail (#37).
        await client.query('SELECT pg_advisory_xact_lock($1)', [userId]);
        result = await lockClient.run(client, fn);
        await client.query('COMMIT');
      } catch (err) {
        // Never return a session to the pool inside an open transaction
        // holding the advisory lock: roll back first. If the connection is
        // too broken to roll back, pg discards it on the error anyway.
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
      return result;
    } finally {
      client.release();
    }
  }
}
