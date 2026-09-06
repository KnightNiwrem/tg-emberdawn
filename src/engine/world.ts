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
export function zoneDescription(player: PlayerState, zoneDef: ZoneDef): string {
  return zoneDef.aftermath?.find((aftermath) => evalCondition(player, aftermath.when))?.text ??
    zoneDef.desc;
}

/**
 * The ONE arrival authority (#159/#160): changes currentZone, restores a
 * safe haven, runs onZoneEnter (the zone flag + reach objectives), and
 * syncs availability — exactly once, only here. The journey coordinator
 * calls it on final arrival; test arrival fixtures also route through it;
 * nothing else may move the player between zones.
 */
export function arriveAt(player: PlayerState, toZone: string): string[] {
  if (player.dungeonRun) return [DUNGEON_BLOCK];
  const zoneDef = zone(toZone);
  player.currentZone = toZone;
  const lines = [`🧭 You arrive at ${zoneDef?.emoji ?? ''} ${zoneDef?.name ?? toZone}.`];
  if (zoneDef) lines.push(zoneDescription(player, zoneDef));
  if (zoneDef?.safeHaven) {
    const derived = statsOf(player);
    player.hp = derived.maxHp;
    player.mp = derived.maxMp;
    // The respawn haven moves ONLY here (#160): a journey that has merely
    // begun — or a crossing still mid-road — never relocates it.
    player.respawnHaven = toZone;
    // The forage counter intentionally persists across visits now — the
    // real-time recharge (see explore) governs when the faucet refills.
    lines.push('🔥 A safe haven. HP and MP fully restored.');
  }
  for (const qid of onZoneEnter(player, toZone)) {
    // A reach objective completing on arrival is announced in the arrival
    // result itself (#119) — the player sees it the moment they step in.
    lines.push(questReadyLine(qid));
  }
  syncAvailability(player);
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

export function resolveVictory(
  player: PlayerState,
  battle: BattleState,
  rng: Rng = defaultRng,
): string[] {
  const def = enemyDef(battle.enemy.id);
  if (!def) return [];
  const rewards = rollRewards(def, rng);
  // Quest items only drop while they still matter (#2): once every quest
  // that needs one is done — or the bag already holds the relevant amount —
  // further drops are suppressed instead of piling up as clutter.
  rewards.drops = rewards.drops.filter((id) => questDropAllowed(player, id));
  player.gold += rewards.gold;
  // At the summit the headline must not advertise XP the player cannot
  // receive (#36): show the conversion inline. Pre-cap unchanged. The
  // decision is made BEFORE the grant and stamped onto the reward record
  // (#40): a 44→45 victory is a pre-cap grant, so it records no conversion
  // even though the player ends the fight at the summit.
  const capped = player.level >= MAX_LEVEL;
  if (capped && rewards.xp > 0) rewards.xpConvertedGold = xpToGoldAtCap(rewards.xp);
  // Reward headline lives ONLY in the staged rewards (#40, #67): the victory
  // screen renders one authoritative Spoils line from `battle.rewards`, so the
  // resolution lines never repeat XP/gold beside it.
  const lines = [
    `🏆 ${battle.enemy.name} is defeated!`,
  ];
  // Every readiness flip this victory causes is collected (#119) — from the
  // drops, the kill, the availability refresh, the dungeon bookkeeping and
  // the first-clear rewards — deduped by quest id and announced ONCE, after
  // all of the victory's mutations have settled. A quest can only flip
  // active→turnIn a single time (refreshProgress is the sole authority), so
  // collection order is announcement order.
  const ready: string[] = [];
  lines.push(...grantXp(player, rewards.xp));
  lines.push(...grantDropRewards(player, rewards.drops));
  // #165: the zone's own contextual resources roll here, exactly once, from
  // the structured origin — in addition to the ordinary enemy rewards. The
  // ONE shared contextual grant site applies the central relevance filter
  // (#2) and routes through the central item path, so collect objectives
  // can complete on the spot like any other gain.
  if (zoneLootEligible(battle.origin)) {
    const originZone = zone(battle.origin.zoneId);
    if (originZone?.lootTable) {
      const contextual = rollDropTable(originZone.lootTable, rng);
      const granted = contextual.filter((drop) => questDropAllowed(player, drop.item));
      if (granted.length > 0) {
        rewards.contextual = granted;
        lines.push(...grantContextualDrops(player, granted).lines);
        ready.push(...onItemGain(player));
      }
    }
  }
  // An ordinary drop can complete a collect objective on the spot.
  ready.push(...onItemGain(player));
  player.stats.kills++;
  player.stats.battlesWon++;
  if (battle.enemy.isBoss) player.stats.bossesSlain++;
  ready.push(...onKill(player, def.id));
  syncAvailability(player);
  // Safety net: if the availability refresh (or anything above) readied a
  // quest no hook claimed, the notice still flows — never a duplicate, since
  // refreshProgress reports each transition exactly once.
  ready.push(...onItemGain(player));
  if (battle.origin.kind === 'dungeon') {
    const dungeonZone = zone(battle.origin.zoneId);
    const dungeon = dungeonZone ? dungeonOf(dungeonZone) : undefined;
    if (
      dungeon && dungeon.id === battle.origin.dungeonId &&
      player.dungeonRun?.dungeonId === dungeon.id &&
      player.dungeonRun.zoneId === battle.origin.zoneId &&
      player.dungeonRun.nextFloor === battle.origin.floor
    ) {
      if (battle.origin.boss) {
        lines.push(...onDungeonVictory(player, dungeon, ready).lines);
        // Location-specific story objectives key on the dungeon clear, never
        // on the enemy id — an overworld echo of the boss can't substitute.
        ready.push(...onDungeonClear(player, dungeon.id));
      } else {
        lines.push(...onDungeonFloorVictory(player, dungeon, battle.origin.floor, ready));
      }
    }
  }
  battle.rewards = rewards;
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
  event: { kind: string; minPlayerLevel?: number; maxPlayerLevel?: number },
  level: number,
): boolean {
  if (event.kind !== 'battle' && event.kind !== 'elite') return true;
  return level >= (event.minPlayerLevel ?? 1) &&
    level <= (event.maxPlayerLevel ?? MAX_EXPLORE_LEVEL);
}

/** True only when the active run has reached its final chamber. */
export function nextDiveIsBoss(player: PlayerState, dungeon: DungeonDef): boolean {
  return nextFloor(player, dungeon) >= dungeon.floors.length + 1;
}

export function explore(
  player: PlayerState,
  rng: Rng = defaultRng,
  now: number = Date.now(),
): ExploreOutcome {
  if (player.dungeonRun) return { kind: 'result', lines: [DUNGEON_BLOCK] };
  const currentZoneDef = zone(player.currentZone);
  // A broken zone reference is a system fault: state it plainly and give
  // the player the working exit (#128 — system text is clear, never coy).
  if (!currentZoneDef) {
    return {
      kind: 'result',
      lines: ['You are far from any road. Send /start to rejoin the world.'],
    };
  }
  if (player.battle) {
    return { kind: 'result', lines: ['⚔️ Finish the fight in front of you first.'] };
  }
  // No exploring mid-crossing (#159/#166): the player is on the road, not
  // in the wilds — the central mutation refuses, not only the handler.
  if (player.journey) return { kind: 'result', lines: [JOURNEY_BLOCK] };

  // Safe havens never spawn battles — and never rest (#211): arrival at a
  // haven already restores both pools fully (arriveAt), so an in-haven rest
  // can only roll against full pools and claim a heal that lands nothing.
  // Content tables should already be battle- and rest-free; this guard keeps
  // them that way regardless of content.
  let pool = currentZoneDef.safeHaven
    ? currentZoneDef.explore.filter((event) =>
      event.kind !== 'battle' && event.kind !== 'elite' && event.kind !== 'rest'
    )
    : currentZoneDef.explore;
  // Authored encounter eligibility (#73, shared with the balance harness
  // #74): battle/elite events only roll for players inside their authored
  // level band — ONE pure rule, so the game and the report can never drift.
  pool = pool.filter((event) => encounterEligible(event, player.level));
  // Safe-haven foraging is finite per REAL-TIME cooldown: a few picks and
  // the caches dry up for hours — leaving and returning can no longer
  // refresh the faucet, so the Emberdawn loop is a 6-hour wait, not four taps.
  const forageKey = `forage_${currentZoneDef.id}`;
  let foraged = typeof player.flags[forageKey] === 'number' ? player.flags[forageKey]! : 0;
  if (currentZoneDef.safeHaven) {
    // The faucet recharges on a REAL-TIME cooldown — walking away and
    // back never refreshes it. `now` is injected so the engine stays deterministic (#3).
    if (foraged >= MAX_FORAGE_CHARGES) {
      const resetAt = player.flags['forageResetAt'];
      if (typeof resetAt === 'number' && now >= resetAt) {
        foraged = 0;
        delete player.flags[forageKey];
        delete player.flags['forageResetAt'];
      }
    }
    if (foraged >= MAX_FORAGE_CHARGES) {
      pool = pool.filter((event) => event.kind !== 'treasure');
    } else {
      const left = foraged + 1;
      player.flags[forageKey] = left;
      if (left >= MAX_FORAGE_CHARGES) {
        // Stamp the recharge the MOMENT the last charge is spent (#3) —
        // never one interaction later, or idle time gets re-charged.
        player.flags['forageResetAt'] = now + FORAGE_COOLDOWN_MS;
      }
    }
  }
  const weights = pool.map((event) => event.weight);
  const idx = weightedIndex(rng, weights);
  const ev = pool[idx];
  if (!ev) {
    return {
      kind: 'result',
      lines: ['🧺 Picked clean for now — the hearth still welcomes you.'],
    };
  }
  return applyExploreEvent(player, currentZoneDef, ev, rng);
}

function applyExploreEvent(
  player: PlayerState,
  zoneDef: ZoneDef,
  ev: ExploreEvent,
  rng: Rng,
): ExploreOutcome {
  switch (ev.kind) {
    case 'battle':
    case 'elite': {
      const started = startBattle(ev.enemy, {
        kind: ev.kind === 'elite' ? 'elite' : 'explore',
        zoneId: zoneDef.id,
      }, { player, rng });
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
      return { kind: 'result', lines: applyQuietEvent(player, ev, rng).lines };
  }
}

// ── Dungeons ────────────────────────────────────────────────────────────

export function dungeonOf(zoneDef: ZoneDef): DungeonDef | undefined {
  return zoneDef.dungeon;
}

function bossKey(dungeon: DungeonDef): string {
  return `dgn_${dungeon.id}_boss`;
}

/** Next floor the player will face (1-based); floors.length+1 = boss. */
function nextFloor(player: PlayerState, dungeon: DungeonDef): number {
  return player.dungeonRun?.dungeonId === dungeon.id ? player.dungeonRun.nextFloor : 1;
}

/** Next floor in this attempt; a fresh entry or rematch always begins at one. */
export function nextDungeonFloor(player: PlayerState, dungeon: DungeonDef): number {
  return nextFloor(player, dungeon);
}

/** Permanent first-clear record, independent of the active descent. */
export function dungeonCleared(player: PlayerState, dungeon: DungeonDef): boolean {
  return player.flags[bossKey(dungeon)] === true;
}

/** Narrative reason the boss floor is sealed, or undefined when open.
 * A `requireDone: false` gate opens while the story quest is active or
 * turn-in-ready (the boss IS the quest target); `done` always opens so
 * rematches keep working after the story moves on. */
export function bossGateBlock(player: PlayerState, dungeon: DungeonDef): string | undefined {
  const gate = dungeon.bossGate;
  if (!gate) return undefined;
  const status = player.quests[gate.quest]?.status;
  const open = status === 'done' ||
    (gate.requireDone === false && (status === 'active' || status === 'turnIn'));
  if (!open) {
    const questDef = quest(gate.quest);
    const how = gate.requireDone === false ? 'begun' : 'completed';
    return questDef
      ? `⛔ Sealed. “${questDef.name}” must be ${how} before the deepest chamber opens.`
      : '⛔ Sealed by powers beyond your understanding.';
  }
  // A keyed gate demands its story key for the first descent — rematches
  // after clearing stay open.
  if (gate.item && !dungeonCleared(player, dungeon) && countOf(player, gate.item) < 1) {
    return '⛔ Sealed. The deepest chamber only opens for its own key.';
  }
  return undefined;
}

/** Starts at floor one, or continues the same uninterrupted descent. */
export function diveDungeon(
  player: PlayerState,
  requested: DungeonDef,
  rng: Rng = defaultRng,
): { ok: boolean; battle?: BattleState; outcome?: BattleOutcome; lines: string[] } {
  if (player.journey) return { ok: false, lines: [JOURNEY_BLOCK] };
  if (player.battle) return { ok: false, lines: ['Finish the current battle first.'] };
  const dungeon = zone(player.currentZone)?.dungeon;
  if (!dungeon || dungeon.id !== requested.id) {
    return { ok: false, lines: ['That dungeon is not here.'] };
  }
  if (
    player.dungeonRun &&
    (player.dungeonRun.zoneId !== player.currentZone || player.dungeonRun.dungeonId !== dungeon.id)
  ) {
    return { ok: false, lines: [DUNGEON_BLOCK] };
  }
  const floor = nextFloor(player, dungeon);
  const boss = floor === dungeon.floors.length + 1;
  if (boss) {
    const block = bossGateBlock(player, dungeon);
    if (block) return { ok: false, lines: [block] };
  }
  const room = dungeon.floors[floor - 1];
  const enemyId = boss ? dungeon.boss : room?.enemies[Math.floor(rng() * room.enemies.length)];
  if (!boss && room?.discovery) {
    player.dungeonRun ??= { zoneId: player.currentZone, dungeonId: dungeon.id, nextFloor: 1 };
    const ready: string[] = [];
    const lines = [
      `${dungeon.emoji} Floor ${floor}: ${room.discovery.name}`,
      room.discovery.text,
      ...onDungeonFloorVictory(player, dungeon, floor, ready),
    ];
    for (const id of [...new Set(ready)]) lines.push(questReadyLine(id));
    return { ok: true, lines };
  }
  if (!enemyId || !enemyDef(enemyId)) {
    return { ok: false, lines: ['This dungeon floor is unavailable.'] };
  }
  player.dungeonRun ??= { zoneId: player.currentZone, dungeonId: dungeon.id, nextFloor: 1 };
  const started = startBattle(enemyId, {
    kind: 'dungeon',
    zoneId: player.currentZone,
    dungeonId: dungeon.id,
    floor,
    boss,
  }, { player, rng });
  if (!started) return { ok: false, lines: ['This dungeon floor is unavailable.'] };
  return {
    ok: true,
    battle: started.battle,
    outcome: started.outcome,
    lines: [
      `${dungeon.emoji} Floor ${floor}: ${enemyDef(enemyId)!.name} (Lv ${
        enemyDef(enemyId)!.level
      }) bars the way.`,
    ],
  };
}

/** Leaving preserves earned loot, but never the next floor. */
export function abandonDungeon(player: PlayerState): { ok: boolean; lines: string[] } {
  if (player.battle || player.journey || !player.dungeonRun) {
    return { ok: false, lines: ['There is no descent you can leave here.'] };
  }
  delete player.dungeonRun;
  return { ok: true, lines: ['You return to the entrance. Your next descent begins at floor 1.'] };
}

/**
 * Victory over a NORMAL dungeon floor: grants that floor's treasure (once)
 * and advances the floor pointer. Fleeing or dying never routes here.
 * Readiness the cache item causes is COLLECTED into `ready` (#119) — the
 * caller announces it once, after all of the victory's mutations settle.
 */
function onDungeonFloorVictory(
  player: PlayerState,
  dungeon: DungeonDef,
  floor: number,
  ready: string[],
): string[] {
  const lines: string[] = [];
  if (floor >= dungeon.floors.length + 1) return lines; // boss victories route elsewhere
  if (
    !player.dungeonRun || player.dungeonRun.dungeonId !== dungeon.id ||
    nextFloor(player, dungeon) !== floor
  ) return lines;
  player.dungeonRun.nextFloor = floor + 1;
  const cacheKey = `dgn_${dungeon.id}_cache_${floor}`;
  if (player.flags[cacheKey]) return lines;
  player.flags[cacheKey] = true;
  const treasure = dungeon.floors[floor - 1]?.treasure;
  if (treasure) {
    if (treasure.gold) {
      player.gold += treasure.gold;
      lines.push(`💰 Floor cache: +${treasure.gold} gold`);
    }
    if (treasure.item) {
      lines.push(`🎁 Floor cache: ${itemName(treasure.item)}`);
      ready.push(...grantItem(player, treasure.item, 1));
    }
  }
  return lines;
}

/** Called after a DUNGEON BOSS battle victory; handles clear/first-clear
 * bookkeeping. First-clear item readiness is COLLECTED into `ready` (#119). */
function onDungeonVictory(
  player: PlayerState,
  dungeon: DungeonDef,
  ready: string[],
): { firstClear: boolean; lines: string[] } {
  const lines: string[] = [];
  const firstClear = !dungeonCleared(player, dungeon);
  player.flags[bossKey(dungeon)] = true;
  delete player.dungeonRun;
  if (firstClear) {
    // A keyed gate's story key is spent by the FIRST VICTORIOUS descent —
    // entry alone never consumes it, so a lost fight stays retryable.
    const key = dungeon.bossGate?.item;
    if (key && removeItem(player, key, 1)) {
      lines.push(`🔑 The ${itemName(key)} dissolves into the seal.`);
    }
  }
  if (firstClear && dungeon.firstClear) {
    const clearRewards = dungeon.firstClear;
    player.gold += clearRewards.gold;
    // The headline is evaluated BEFORE the grant (#40 semantics, #42): a
    // 44→45 clear is a pre-cap reward — nominal XP, no unawarded gold.
    const xpLabel = xpRewardLabel(player.level, clearRewards.xp);
    const xpLines = grantXp(player, clearRewards.xp);
    lines.push(`🏆 First clear of ${dungeon.name}!`);
    lines.push(`💰 +${clearRewards.gold} gold · ${xpLabel}`);
    if (clearRewards.item) {
      lines.push(`🎁 Received: ${itemName(clearRewards.item)}`);
      ready.push(...grantItem(player, clearRewards.item, 1));
    }
    for (const flag of clearRewards.flags ?? []) player.flags[flag] = true;
    for (const zoneId of clearRewards.unlockZones ?? []) {
      if (!player.unlockedZones.includes(zoneId)) {
        player.unlockedZones.push(zoneId);
        lines.push(`🗺️ New area unlocked: ${zone(zoneId)?.name ?? zoneId}`);
      }
    }
    lines.push(...xpLines);
  }
  return { firstClear, lines };
}

export function dungeonProgressLine(player: PlayerState, dungeon: DungeonDef): string {
  if (dungeonCleared(player, dungeon)) return '🏆 Boss defeated — rematch available';
  const floor = nextFloor(player, dungeon);
  return floor > dungeon.floors.length
    ? '☠️ Boss floor ready'
    : `📍 Floor ${floor}/${dungeon.floors.length + 1}`;
}
