/**
 * World interaction: travel, exploration events and dungeon dives.
 * Battles returned from here are stored on the player by the caller.
 */

import type { BattleState, PlayerState } from './types.ts';
import type { DungeonDef, ExploreEvent, ZoneDef } from '../content/types.ts';
import { zone } from '../content/zones.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { quest } from '../content/quests.ts';
import { countOf, grantDropRewards, removeItem } from './inventory.ts';
import { rollRewards, startBattle } from './combat.ts';
import { grantXp, statsOf } from './character.ts';
import { grantItem, onDungeonClear, onKill, onZoneEnter, syncAvailability } from './quests.ts';
import { defaultRng, randInt, type Rng, weightedIndex } from './rng.ts';
import { itemName } from '../content/items.ts';

function canTravel(p: PlayerState, zoneId: string): boolean {
  return p.unlockedZones.includes(zoneId) && p.currentZone !== zoneId;
}

export function travel(p: PlayerState, zoneId: string): { ok: boolean; lines: string[] } {
  const z = zone(zoneId);
  if (!z) return { ok: false, lines: ["You can't find a road to there."] };
  if (!canTravel(p, zoneId)) return { ok: false, lines: ['🚫 That path is still closed to you.'] };
  p.currentZone = zoneId;
  const lines = [`🧭 You arrive at ${z.emoji} ${z.name}.`, z.desc];
  if (z.safeHaven) {
    const s = statsOf(p);
    p.hp = s.maxHp;
    p.mp = s.maxMp;
    // The forage counter intentionally persists across visits now — the
    // real-time recharge (see explore) governs when the faucet refills.
    lines.push('🔥 A safe haven. HP and MP fully restored.');
  }
  onZoneEnter(p, zoneId);
  return { ok: true, lines };
}

export type ExploreOutcome =
  | { kind: 'battle'; battle: BattleState; buffsNeeded: true; line: string }
  | { kind: 'result'; lines: string[] };

/**
 * Victory resolution for ANY battle, routed by structured origin:
 * rewards → kills/stats → quest hooks → dungeon bookkeeping (only when the
 * battle truly came from a dungeon). Pure engine, so tests can drive it.
 */
export function resolveVictory(p: PlayerState, b: BattleState, rng: Rng = defaultRng): string[] {
  const def = enemyDef(b.enemy.id);
  if (!def) return [];
  const rewards = rollRewards(def, rng);
  p.gold += rewards.gold;
  const lines = [
    `🏆 ${b.enemy.name} is defeated!`,
    `✨ +${rewards.xp} XP · 💰 +${rewards.gold} gold`,
  ];
  lines.push(...grantXp(p, rewards.xp));
  lines.push(...grantDropRewards(p, rewards.drops));
  p.stats.kills++;
  p.stats.battlesWon++;
  if (def.boss) p.stats.bossesSlain++;
  onKill(p, def.id);
  syncAvailability(p);
  if (b.origin.kind === 'dungeon') {
    const z = zone(b.origin.zoneId);
    const d = z ? dungeonOf(z) : undefined;
    if (d && d.id === b.origin.dungeonId) {
      if (b.origin.boss) {
        lines.push(...onDungeonVictory(p, d).lines);
        // Location-specific story objectives key on the dungeon clear, never
        // on the enemy id — an overworld echo of the boss can't substitute.
        onDungeonClear(p, d.id);
      } else {
        lines.push(...onDungeonFloorVictory(p, d, b.origin.floor));
      }
    }
  }
  b.rewards = rewards;
  return lines;
}

export function explore(
  p: PlayerState,
  rng: Rng = defaultRng,
): ExploreOutcome {
  const z = zone(p.currentZone);
  if (!z) return { kind: 'result', lines: ['You are nowhere. Somehow.'] };
  if (p.battle) return { kind: 'result', lines: ['⚔️ Finish the fight in front of you first.'] };

  // Safe havens never spawn battles — content tables should already be
  // battle-free; this guard keeps them that way regardless of content.
  let pool = z.safeHaven
    ? z.explore.filter((e) => e.kind !== 'battle' && e.kind !== 'elite')
    : z.explore;
  // Safe-haven foraging is finite per REAL-TIME cooldown: a few picks and
  // the caches dry up for hours — free travel can no longer refresh the
  // faucet, so the Emberdawn loop is a 6-hour wait, not four taps.
  const forageKey = `forage_${z.id}`;
  let foraged = typeof p.flags[forageKey] === 'number' ? p.flags[forageKey]! : 0;
  if (z.safeHaven) {
    // The faucet recharges on a REAL-TIME cooldown — free travel never
    // refreshes it, so the Emberdawn loop is a 6-hour wait, not 4 taps.
    if (foraged >= 3) {
      const resetAt = p.flags['forageResetAt'];
      if (typeof resetAt === 'number' && Date.now() >= resetAt) {
        foraged = 0;
        delete p.flags[forageKey];
        delete p.flags['forageResetAt'];
      }
    }
    if (foraged >= 3) {
      pool = pool.filter((e) => e.kind !== 'treasure');
      if (p.flags['forageResetAt'] === undefined) {
        p.flags['forageResetAt'] = Date.now() + 6 * 3_600_000; // 6h recharge
      }
    } else {
      p.flags[forageKey] = foraged + 1;
    }
  }
  const weights = pool.map((e) => e.weight);
  const idx = weightedIndex(rng, weights);
  const ev = pool[idx];
  if (!ev) {
    return {
      kind: 'result',
      lines: ['🧺 Picked clean for now — the hearth still welcomes you.'],
    };
  }
  return applyExploreEvent(p, z, ev, rng);
}

function applyExploreEvent(p: PlayerState, z: ZoneDef, ev: ExploreEvent, rng: Rng): ExploreOutcome {
  switch (ev.kind) {
    case 'battle':
    case 'elite': {
      const battle = startBattle(ev.enemy, {
        kind: ev.kind === 'elite' ? 'elite' : 'explore',
        zoneId: z.id,
      });
      if (!battle) return { kind: 'result', lines: ['Nothing stirs.'] };
      return {
        kind: 'battle',
        battle,
        buffsNeeded: true,
        line: ev.kind === 'elite'
          ? ev.text
          : `${enemyDef(ev.enemy)?.emoji ?? '❔'} A wild ${
            enemyDef(ev.enemy)?.name ?? ev.enemy
          } appears!`,
      };
    }
    case 'treasure': {
      const lines = [`✨ ${ev.text}`];
      if (ev.gold) {
        const g = randInt(rng, Math.floor(ev.gold * 0.8), Math.ceil(ev.gold * 1.3));
        p.gold += g;
        lines.push(`💰 +${g} gold`);
      }
      if (ev.item) {
        lines.push(`🎁 Found: ${itemName(ev.item)}`);
        for (const qid of grantItem(p, ev.item, 1)) {
          lines.push(`📜 “${quest(qid)?.name ?? qid}” is ready to turn in!`);
        }
      }
      return { kind: 'result', lines };
    }
    case 'rest': {
      const s = statsOf(p);
      const healHp = Math.floor(s.maxHp * ev.healPct);
      const healMp = Math.floor(s.maxMp * ev.healPct);
      p.hp = Math.min(s.maxHp, p.hp + healHp);
      p.mp = Math.min(s.maxMp, p.mp + healMp);
      return { kind: 'result', lines: [`🌙 ${ev.text}`, `💚 +${healHp} HP · 💧 +${healMp} MP`] };
    }
    case 'flavor':
      return { kind: 'result', lines: [ev.text] };
  }
}

// ── Dungeons ────────────────────────────────────────────────────────────

export function dungeonOf(z: ZoneDef): DungeonDef | undefined {
  return z.dungeon;
}

function floorKey(d: DungeonDef): string {
  return `dgn_${d.id}_floor`;
}

function bossKey(d: DungeonDef): string {
  return `dgn_${d.id}_boss`;
}

/** Next floor the player will face (1-based); floors.length+1 = boss. */
function nextFloor(p: PlayerState, d: DungeonDef): number {
  const f = p.flags[floorKey(d)];
  return typeof f === 'number' ? f : 1;
}

/** True once this dungeon's boss has been defeated (rematches stay open). */
export function dungeonCleared(p: PlayerState, d: DungeonDef): boolean {
  return p.flags[bossKey(d)] === true;
}

/** Narrative reason the boss floor is sealed, or undefined when open.
 * A `requireDone: false` gate opens while the story quest is active or
 * turn-in-ready (the boss IS the quest target); `done` always opens so
 * rematches keep working after the story moves on. */
export function bossGateBlock(p: PlayerState, d: DungeonDef): string | undefined {
  const gate = d.bossGate;
  if (!gate) return undefined;
  const st = p.quests[gate.quest]?.status;
  const open = st === 'done' ||
    (gate.requireDone === false && (st === 'active' || st === 'turnIn'));
  if (!open) {
    const q = quest(gate.quest);
    const how = gate.requireDone === false ? 'begun' : 'completed';
    return q
      ? `⛔ Sealed. “${q.name}” must be ${how} before the deepest chamber opens.`
      : '⛔ Sealed by powers beyond your understanding.';
  }
  // A keyed gate demands its story key for the first descent — rematches
  // after clearing stay open.
  if (gate.item && !dungeonCleared(p, d) && countOf(p, gate.item) < 1) {
    return '⛔ Sealed. The deepest chamber only opens for its own key.';
  }
  return undefined;
}

/**
 * Enters the dungeon: normal floors are open once the zone is; the boss
 * floor (and rematches after clearing) are story-gated. Starting a fight
 * NEVER advances progress — that happens only on victory (see
 * `onDungeonFloorVictory` / `onDungeonVictory`), so fleeing or dying
 * simply leaves the floor pending.
 */
export function diveDungeon(
  p: PlayerState,
  d: DungeonDef,
  rng: Rng = defaultRng,
): { ok: boolean; battle?: BattleState; lines: string[] } {
  const bossFloor = d.floors.length + 1;
  const floor = nextFloor(p, d);

  if (floor >= bossFloor || dungeonCleared(p, d)) {
    const block = bossGateBlock(p, d);
    if (block) return { ok: false, lines: [block] };
    const battle = startBattle(d.boss, {
      kind: 'dungeon',
      zoneId: p.currentZone,
      dungeonId: d.id,
      floor: bossFloor,
      boss: true,
    });
    if (!battle) {
      return {
        ok: false,
        lines: ['The way is blocked by nothing at all, which is somehow worse.'],
      };
    }
    const again = dungeonCleared(p, d) ? ' again' : '';
    return {
      ok: true,
      battle,
      lines: [
        `${d.emoji} You descend to the deepest chamber. ${
          enemyDef(d.boss)?.name ?? d.boss
        } awaits${again}.`,
      ],
    };
  }

  const pool = d.floors[floor - 1]?.enemies ?? [d.boss];
  const enemyId = pool[Math.floor(rng() * pool.length)] ?? d.boss;
  const battle = startBattle(enemyId, {
    kind: 'dungeon',
    zoneId: p.currentZone,
    dungeonId: d.id,
    floor,
    boss: false,
  });
  if (!battle) {
    return { ok: false, lines: ['The way is blocked by nothing at all, which is somehow worse.'] };
  }
  return {
    ok: true,
    battle,
    lines: [`${d.emoji} Floor ${floor}: ${enemyDef(enemyId)?.name ?? enemyId} bars the way.`],
  };
}

/**
 * Victory over a NORMAL dungeon floor: grants that floor's treasure (once)
 * and advances the floor pointer. Fleeing or dying never routes here.
 */
export function onDungeonFloorVictory(p: PlayerState, d: DungeonDef, floor: number): string[] {
  const lines: string[] = [];
  if (floor >= d.floors.length + 1) return lines; // boss victories route elsewhere
  if (nextFloor(p, d) !== floor) return lines; // floor already cleared
  p.flags[floorKey(d)] = floor + 1;
  const t = d.floors[floor - 1]?.treasure;
  if (t) {
    if (t.gold) {
      p.gold += t.gold;
      lines.push(`💰 Floor cache: +${t.gold} gold`);
    }
    if (t.item) {
      lines.push(`🎁 Floor cache: ${itemName(t.item)}`);
      for (const qid of grantItem(p, t.item, 1)) {
        lines.push(`📜 “${quest(qid)?.name ?? qid}” is ready to turn in!`);
      }
    }
  }
  return lines;
}

/** Called after a DUNGEON BOSS battle victory; handles clear/first-clear bookkeeping. */
export function onDungeonVictory(
  p: PlayerState,
  d: DungeonDef,
): { firstClear: boolean; lines: string[] } {
  const lines: string[] = [];
  const firstClear = !dungeonCleared(p, d);
  p.flags[bossKey(d)] = true;
  if (firstClear) {
    // A keyed gate's story key is spent by the FIRST VICTORIOUS descent —
    // entry alone never consumes it, so a lost fight stays retryable.
    const key = d.bossGate?.item;
    if (key && removeItem(p, key, 1)) {
      lines.push(`🔑 The ${itemName(key)} dissolves into the seal.`);
    }
  }
  if (firstClear && d.firstClear) {
    const fc = d.firstClear;
    p.gold += fc.gold;
    const xpLines = grantXp(p, fc.xp);
    lines.push(`🏆 First clear of ${d.name}!`);
    lines.push(`💰 +${fc.gold} gold · ✨ +${fc.xp} XP`);
    if (fc.item) {
      lines.push(`🎁 Received: ${itemName(fc.item)}`);
      for (const qid of grantItem(p, fc.item, 1)) {
        lines.push(`📜 “${quest(qid)?.name ?? qid}” is ready to turn in!`);
      }
    }
    for (const f of fc.flags ?? []) p.flags[f] = true;
    if (fc.unlockZone && !p.unlockedZones.includes(fc.unlockZone)) {
      p.unlockedZones.push(fc.unlockZone);
      lines.push(`🗺️ New area unlocked: ${zone(fc.unlockZone)?.name ?? fc.unlockZone}`);
    }
    lines.push(...xpLines);
  }
  return { firstClear, lines };
}

export function dungeonProgressLine(p: PlayerState, d: DungeonDef): string {
  if (dungeonCleared(p, d)) return '🏆 Boss defeated — rematch available';
  const floor = nextFloor(p, d);
  return floor > d.floors.length
    ? '☠️ Boss floor ready'
    : `📍 Floor ${floor}/${d.floors.length + 1}`;
}
