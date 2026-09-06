/**
 * World interaction: travel, exploration events and dungeon dives.
 * Battles returned from here are stored on the player by the caller.
 */

import type { BattleOrigin, BattleState, PlayerState } from './types.ts';
import type { DungeonDef, ExploreEvent, ZoneDef } from '../content/types.ts';
import { zone } from '../content/zones.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { quest } from '../content/quests.ts';
import { countOf, grantDropRewards, removeItem } from './inventory.ts';
import { type BattleOutcome, rollRewards, startBattle } from './combat.ts';
import { grantXp, statsOf, xpRewardLabel, xpToGoldAtCap } from './character.ts';
import { MAX_LEVEL } from './classes.ts';
import {
  grantItem,
  onDungeonClear,
  onItemGain,
  onKill,
  onZoneEnter,
  questDropAllowed,
  questReadyLine,
  syncAvailability,
} from './quests.ts';
import { defaultRng, type Rng, weightedIndex } from './rng.ts';
import { grantContextualDrops, rollDropTable } from './loot.ts';
import { JOURNEY_BLOCK } from './routes.ts';
import { DUNGEON_BLOCK } from './dungeon_run.ts';
import { applyQuietEvent } from './event_rewards.ts';
import { itemName } from '../content/items.ts';
import { evalCondition } from './conditions.ts';

/** Recovery is derived from existing story state, never a second set of flags. */
export function zoneDescription(p: PlayerState, z: ZoneDef): string {
  return z.aftermath?.find((a) => evalCondition(p, a.when))?.text ?? z.desc;
}

/**
 * The ONE arrival authority (#159/#160): changes currentZone, restores a
 * safe haven, runs onZoneEnter (the zone flag + reach objectives), and
 * syncs availability — exactly once, only here. The journey coordinator
 * calls it on final arrival; test arrival fixtures also route through it;
 * nothing else may move the player between zones.
 */
export function arriveAt(p: PlayerState, toZone: string): string[] {
  if (p.dungeonRun) return [DUNGEON_BLOCK];
  const z = zone(toZone);
  p.currentZone = toZone;
  const lines = [`🧭 You arrive at ${z?.emoji ?? ''} ${z?.name ?? toZone}.`];
  if (z) lines.push(zoneDescription(p, z));
  if (z?.safeHaven) {
    const s = statsOf(p);
    p.hp = s.maxHp;
    p.mp = s.maxMp;
    // The respawn haven moves ONLY here (#160): a journey that has merely
    // begun — or a crossing still mid-road — never relocates it.
    p.respawnHaven = toZone;
    // The forage counter intentionally persists across visits now — the
    // real-time recharge (see explore) governs when the faucet refills.
    lines.push('🔥 A safe haven. HP and MP fully restored.');
  }
  for (const qid of onZoneEnter(p, toZone)) {
    // A reach objective completing on arrival is announced in the arrival
    // result itself (#119) — the player sees it the moment they step in.
    lines.push(questReadyLine(qid));
  }
  syncAvailability(p);
  return lines;
}

export type ExploreOutcome =
  | {
    kind: 'battle';
    battle: BattleState;
    /** #96: the opening's explicit adjudication — a terminal opening ends
     * the fight before any round runs, and the caller resolves it. */
    outcome: BattleOutcome;
    buffsNeeded: true;
    line: string;
  }
  | { kind: 'result'; lines: string[] };

/**
 * Victory resolution for ANY battle, routed by structured origin:
 * rewards → zone contextual loot → kills/stats → quest hooks → dungeon
 * bookkeeping (only when the battle truly came from a dungeon). Pure
 * engine, so tests can drive it.
 */

/** Origin policy for zone contextual loot (#165): battles fought in the
 * zone's OPEN world roll its authored `lootTable` in addition to ordinary
 * enemy rewards — explore and elite encounters in the zone, and travel
 * battles on roads departing it (a travel origin's `zoneId` is the road's
 * origin zone). Dungeon battles are EXCLUDED: a dungeon victory already
 * grants its authored floor caches and clear rewards, and the depths are a
 * distinct sub-context from the zone's open fields. The eligible zone
 * resolves ONLY from the structured battle origin — never from callback
 * data or display text. */
export function zoneLootEligible(origin: BattleOrigin): boolean {
  return origin.kind === 'explore' || origin.kind === 'elite' || origin.kind === 'travel';
}

export function resolveVictory(p: PlayerState, b: BattleState, rng: Rng = defaultRng): string[] {
  const def = enemyDef(b.enemy.id);
  if (!def) return [];
  const rewards = rollRewards(def, rng);
  // Quest items only drop while they still matter (#2): once every quest
  // that needs one is done — or the bag already holds the relevant amount —
  // further drops are suppressed instead of piling up as clutter.
  rewards.drops = rewards.drops.filter((id) => questDropAllowed(p, id));
  p.gold += rewards.gold;
  // At the summit the headline must not advertise XP the player cannot
  // receive (#36): show the conversion inline. Pre-cap unchanged. The
  // decision is made BEFORE the grant and stamped onto the reward record
  // (#40): a 44→45 victory is a pre-cap grant, so it records no conversion
  // even though the player ends the fight at the summit.
  const capped = p.level >= MAX_LEVEL;
  if (capped && rewards.xp > 0) rewards.xpConvertedGold = xpToGoldAtCap(rewards.xp);
  // Reward headline lives ONLY in the staged rewards (#40, #67): the victory
  // screen renders one authoritative Spoils line from `b.rewards`, so the
  // resolution lines never repeat XP/gold beside it.
  const lines = [
    `🏆 ${b.enemy.name} is defeated!`,
  ];
  // Every readiness flip this victory causes is collected (#119) — from the
  // drops, the kill, the availability refresh, the dungeon bookkeeping and
  // the first-clear rewards — deduped by quest id and announced ONCE, after
  // all of the victory's mutations have settled. A quest can only flip
  // active→turnIn a single time (refreshProgress is the sole authority), so
  // collection order is announcement order.
  const ready: string[] = [];
  lines.push(...grantXp(p, rewards.xp));
  lines.push(...grantDropRewards(p, rewards.drops));
  // #165: the zone's own contextual resources roll here, exactly once, from
  // the structured origin — in addition to the ordinary enemy rewards. The
  // ONE shared contextual grant site applies the central relevance filter
  // (#2) and routes through the central item path, so collect objectives
  // can complete on the spot like any other gain.
  if (zoneLootEligible(b.origin)) {
    const z = zone(b.origin.zoneId);
    if (z?.lootTable) {
      const contextual = rollDropTable(z.lootTable, rng);
      const granted = contextual.filter((d) => questDropAllowed(p, d.item));
      if (granted.length > 0) {
        rewards.contextual = granted;
        lines.push(...grantContextualDrops(p, granted).lines);
        ready.push(...onItemGain(p));
      }
    }
  }
  // An ordinary drop can complete a collect objective on the spot.
  ready.push(...onItemGain(p));
  p.stats.kills++;
  p.stats.battlesWon++;
  if (b.enemy.isBoss) p.stats.bossesSlain++;
  ready.push(...onKill(p, def.id));
  syncAvailability(p);
  // Safety net: if the availability refresh (or anything above) readied a
  // quest no hook claimed, the notice still flows — never a duplicate, since
  // refreshProgress reports each transition exactly once.
  ready.push(...onItemGain(p));
  if (b.origin.kind === 'dungeon') {
    const z = zone(b.origin.zoneId);
    const d = z ? dungeonOf(z) : undefined;
    if (
      d && d.id === b.origin.dungeonId && p.dungeonRun?.dungeonId === d.id &&
      p.dungeonRun.zoneId === b.origin.zoneId && p.dungeonRun.nextFloor === b.origin.floor
    ) {
      if (b.origin.boss) {
        lines.push(...onDungeonVictory(p, d, ready).lines);
        // Location-specific story objectives key on the dungeon clear, never
        // on the enemy id — an overworld echo of the boss can't substitute.
        ready.push(...onDungeonClear(p, d.id));
      } else {
        lines.push(...onDungeonFloorVictory(p, d, b.origin.floor, ready));
      }
    }
  }
  b.rewards = rewards;
  for (const qid of [...new Set(ready)]) lines.push(questReadyLine(qid));
  return lines;
}

/** Safe-haven forage faucet: 3 charges, then a real-time recharge (#3). */
const MAX_FORAGE_CHARGES = 3;
const FORAGE_COOLDOWN_MS = 6 * 3_600_000;

/** No authored ceiling on ordinary enemies: returning to earlier areas
 * should always work (#73) — old enemies stay spawnable end-game. */
const MAX_EXPLORE_LEVEL = Number.POSITIVE_INFINITY;

/** Authored encounter eligibility (#73, shared with the balance harness
 * #74): battle/elite events only roll for players inside their authored
 * level band. ONE pure rule — live explore() and the harness pools both
 * read this, so low-level protection cannot drift between the game and
 * the report. Non-hostile events (treasure, rest, flavor) always pass. */
export function encounterEligible(
  e: { kind: string; minPlayerLevel?: number; maxPlayerLevel?: number },
  level: number,
): boolean {
  if (e.kind !== 'battle' && e.kind !== 'elite') return true;
  return level >= (e.minPlayerLevel ?? 1) && level <= (e.maxPlayerLevel ?? MAX_EXPLORE_LEVEL);
}

/** True only when the active run has reached its final chamber. */
export function nextDiveIsBoss(p: PlayerState, d: DungeonDef): boolean {
  return nextFloor(p, d) >= d.floors.length + 1;
}

export function explore(
  p: PlayerState,
  rng: Rng = defaultRng,
  now: number = Date.now(),
): ExploreOutcome {
  if (p.dungeonRun) return { kind: 'result', lines: [DUNGEON_BLOCK] };
  const z = zone(p.currentZone);
  // A broken zone reference is a system fault: state it plainly and give
  // the player the working exit (#128 — system text is clear, never coy).
  if (!z) {
    return {
      kind: 'result',
      lines: ['You are far from any road. Send /start to rejoin the world.'],
    };
  }
  if (p.battle) return { kind: 'result', lines: ['⚔️ Finish the fight in front of you first.'] };
  // No exploring mid-crossing (#159/#166): the player is on the road, not
  // in the wilds — the central mutation refuses, not only the handler.
  if (p.journey) return { kind: 'result', lines: [JOURNEY_BLOCK] };

  // Safe havens never spawn battles — and never rest (#211): arrival at a
  // haven already restores both pools fully (arriveAt), so an in-haven rest
  // can only roll against full pools and claim a heal that lands nothing.
  // Content tables should already be battle- and rest-free; this guard keeps
  // them that way regardless of content.
  let pool = z.safeHaven
    ? z.explore.filter((e) => e.kind !== 'battle' && e.kind !== 'elite' && e.kind !== 'rest')
    : z.explore;
  // Authored encounter eligibility (#73, shared with the balance harness
  // #74): battle/elite events only roll for players inside their authored
  // level band — ONE pure rule, so the game and the report can never drift.
  pool = pool.filter((e) => encounterEligible(e, p.level));
  // Safe-haven foraging is finite per REAL-TIME cooldown: a few picks and
  // the caches dry up for hours — leaving and returning can no longer
  // refresh the faucet, so the Emberdawn loop is a 6-hour wait, not four taps.
  const forageKey = `forage_${z.id}`;
  let foraged = typeof p.flags[forageKey] === 'number' ? p.flags[forageKey]! : 0;
  if (z.safeHaven) {
    // The faucet recharges on a REAL-TIME cooldown — walking away and
    // back never refreshes it. `now` is injected so the engine stays deterministic (#3).
    if (foraged >= MAX_FORAGE_CHARGES) {
      const resetAt = p.flags['forageResetAt'];
      if (typeof resetAt === 'number' && now >= resetAt) {
        foraged = 0;
        delete p.flags[forageKey];
        delete p.flags['forageResetAt'];
      }
    }
    if (foraged >= MAX_FORAGE_CHARGES) {
      pool = pool.filter((e) => e.kind !== 'treasure');
    } else {
      const left = foraged + 1;
      p.flags[forageKey] = left;
      if (left >= MAX_FORAGE_CHARGES) {
        // Stamp the recharge the MOMENT the last charge is spent (#3) —
        // never one interaction later, or idle time gets re-charged.
        p.flags['forageResetAt'] = now + FORAGE_COOLDOWN_MS;
      }
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
      const started = startBattle(ev.enemy, {
        kind: ev.kind === 'elite' ? 'elite' : 'explore',
        zoneId: z.id,
      }, { player: p, rng });
      if (!started) return { kind: 'result', lines: ['Nothing stirs.'] };
      return {
        kind: 'battle',
        battle: started.battle,
        outcome: started.outcome,
        buffsNeeded: true,
        line: ev.kind === 'elite'
          ? ev.text
          : `${enemyDef(ev.enemy)?.emoji ?? '❔'} A wild ${
            enemyDef(ev.enemy)?.name ?? ev.enemy
          } appears!`,
      };
    }
    case 'treasure':
    case 'rest':
    case 'flavor':
      return { kind: 'result', lines: applyQuietEvent(p, ev, rng).lines };
  }
}

// ── Dungeons ────────────────────────────────────────────────────────────

export function dungeonOf(z: ZoneDef): DungeonDef | undefined {
  return z.dungeon;
}

function bossKey(d: DungeonDef): string {
  return `dgn_${d.id}_boss`;
}

/** Next floor the player will face (1-based); floors.length+1 = boss. */
function nextFloor(p: PlayerState, d: DungeonDef): number {
  return p.dungeonRun?.dungeonId === d.id ? p.dungeonRun.nextFloor : 1;
}

/** Next floor in this attempt; a fresh entry or rematch always begins at one. */
export function nextDungeonFloor(p: PlayerState, d: DungeonDef): number {
  return nextFloor(p, d);
}

/** Permanent first-clear record, independent of the active descent. */
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

/** Starts at floor one, or continues the same uninterrupted descent. */
export function diveDungeon(
  p: PlayerState,
  requested: DungeonDef,
  rng: Rng = defaultRng,
): { ok: boolean; battle?: BattleState; outcome?: BattleOutcome; lines: string[] } {
  if (p.journey) return { ok: false, lines: [JOURNEY_BLOCK] };
  if (p.battle) return { ok: false, lines: ['Finish the current battle first.'] };
  const d = zone(p.currentZone)?.dungeon;
  if (!d || d.id !== requested.id) return { ok: false, lines: ['That dungeon is not here.'] };
  if (p.dungeonRun && (p.dungeonRun.zoneId !== p.currentZone || p.dungeonRun.dungeonId !== d.id)) {
    return { ok: false, lines: [DUNGEON_BLOCK] };
  }
  const floor = nextFloor(p, d);
  const boss = floor === d.floors.length + 1;
  if (boss) {
    const block = bossGateBlock(p, d);
    if (block) return { ok: false, lines: [block] };
  }
  const room = d.floors[floor - 1];
  const enemyId = boss ? d.boss : room?.enemies[Math.floor(rng() * room.enemies.length)];
  if (!boss && room?.discovery) {
    p.dungeonRun ??= { zoneId: p.currentZone, dungeonId: d.id, nextFloor: 1 };
    const ready: string[] = [];
    const lines = [
      `${d.emoji} Floor ${floor}: ${room.discovery.name}`,
      room.discovery.text,
      ...onDungeonFloorVictory(p, d, floor, ready),
    ];
    for (const id of [...new Set(ready)]) lines.push(questReadyLine(id));
    return { ok: true, lines };
  }
  if (!enemyId || !enemyDef(enemyId)) {
    return { ok: false, lines: ['This dungeon floor is unavailable.'] };
  }
  p.dungeonRun ??= { zoneId: p.currentZone, dungeonId: d.id, nextFloor: 1 };
  const started = startBattle(enemyId, {
    kind: 'dungeon',
    zoneId: p.currentZone,
    dungeonId: d.id,
    floor,
    boss,
  }, { player: p, rng });
  if (!started) return { ok: false, lines: ['This dungeon floor is unavailable.'] };
  return {
    ok: true,
    battle: started.battle,
    outcome: started.outcome,
    lines: [
      `${d.emoji} Floor ${floor}: ${enemyDef(enemyId)!.name} (Lv ${
        enemyDef(enemyId)!.level
      }) bars the way.`,
    ],
  };
}

/** Leaving preserves earned loot, but never the next floor. */
export function abandonDungeon(p: PlayerState): { ok: boolean; lines: string[] } {
  if (p.battle || p.journey || !p.dungeonRun) {
    return { ok: false, lines: ['There is no descent you can leave here.'] };
  }
  delete p.dungeonRun;
  return { ok: true, lines: ['You return to the entrance. Your next descent begins at floor 1.'] };
}

/**
 * Victory over a NORMAL dungeon floor: grants that floor's treasure (once)
 * and advances the floor pointer. Fleeing or dying never routes here.
 * Readiness the cache item causes is COLLECTED into `ready` (#119) — the
 * caller announces it once, after all of the victory's mutations settle.
 */
function onDungeonFloorVictory(
  p: PlayerState,
  d: DungeonDef,
  floor: number,
  ready: string[],
): string[] {
  const lines: string[] = [];
  if (floor >= d.floors.length + 1) return lines; // boss victories route elsewhere
  if (!p.dungeonRun || p.dungeonRun.dungeonId !== d.id || nextFloor(p, d) !== floor) return lines;
  p.dungeonRun.nextFloor = floor + 1;
  const cacheKey = `dgn_${d.id}_cache_${floor}`;
  if (p.flags[cacheKey]) return lines;
  p.flags[cacheKey] = true;
  const t = d.floors[floor - 1]?.treasure;
  if (t) {
    if (t.gold) {
      p.gold += t.gold;
      lines.push(`💰 Floor cache: +${t.gold} gold`);
    }
    if (t.item) {
      lines.push(`🎁 Floor cache: ${itemName(t.item)}`);
      ready.push(...grantItem(p, t.item, 1));
    }
  }
  return lines;
}

/** Called after a DUNGEON BOSS battle victory; handles clear/first-clear
 * bookkeeping. First-clear item readiness is COLLECTED into `ready` (#119). */
function onDungeonVictory(
  p: PlayerState,
  d: DungeonDef,
  ready: string[],
): { firstClear: boolean; lines: string[] } {
  const lines: string[] = [];
  const firstClear = !dungeonCleared(p, d);
  p.flags[bossKey(d)] = true;
  delete p.dungeonRun;
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
    // The headline is evaluated BEFORE the grant (#40 semantics, #42): a
    // 44→45 clear is a pre-cap reward — nominal XP, no unawarded gold.
    const xpLabel = xpRewardLabel(p.level, fc.xp);
    const xpLines = grantXp(p, fc.xp);
    lines.push(`🏆 First clear of ${d.name}!`);
    lines.push(`💰 +${fc.gold} gold · ${xpLabel}`);
    if (fc.item) {
      lines.push(`🎁 Received: ${itemName(fc.item)}`);
      ready.push(...grantItem(p, fc.item, 1));
    }
    for (const f of fc.flags ?? []) p.flags[f] = true;
    for (const zid of fc.unlockZones ?? []) {
      if (!p.unlockedZones.includes(zid)) {
        p.unlockedZones.push(zid);
        lines.push(`🗺️ New area unlocked: ${zone(zid)?.name ?? zid}`);
      }
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
