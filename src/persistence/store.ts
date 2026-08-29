/**
 * Persistence: PlayerState storage behind a small interface.
 * - KvStore: Deno KV (production / Deno Deploy).
 * - MemoryStore: in-memory (tests).
 */

import type { PlayerState } from '../engine/types.ts';

export interface PlayerStore {
  get(userId: number): Promise<PlayerState | undefined>;
  set(userId: number, state: PlayerState): Promise<void>;
  delete(userId: number): Promise<void>;
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
}

export class KvStore implements PlayerStore {
  private kv: Deno.Kv;

  private constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  static async open(path?: string): Promise<KvStore> {
    const kv = await Deno.openKv(path);
    return new KvStore(kv);
  }

  async get(userId: number): Promise<PlayerState | undefined> {
    const res = await this.kv.get<PlayerState>(['player', userId]);
    return res.value ?? undefined;
  }

  async set(userId: number, state: PlayerState): Promise<void> {
    await this.kv.set(['player', userId], state);
  }

  async delete(userId: number): Promise<void> {
    await this.kv.delete(['player', userId]);
  }
}
