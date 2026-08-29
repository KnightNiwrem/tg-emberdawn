/**
 * World interaction: travel, exploration events and dungeon dives.
 * Battles returned from here are stored on the player by the caller.
 */

import type { BattleState, PlayerState } from './types.ts';
import type { DungeonDef, ExploreEvent, ZoneDef } from '../content/types.ts';
import { zone } from '../content/zones.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { addItem } from './inventory.ts';
import { startBattle } from './combat.ts';
import { grantXp, statsOf } from './character.ts';
import { onZoneEnter } from './quests.ts';
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
    lines.push('🔥 A safe haven. HP and MP fully restored.');
  }
  onZoneEnter(p, zoneId);
  return { ok: true, lines };
}

export type ExploreOutcome =
  | { kind: 'battle'; battle: BattleState; buffsNeeded: true; line: string }
  | { kind: 'result'; lines: string[] };

export function explore(
  p: PlayerState,
  rng: Rng = defaultRng,
): ExploreOutcome {
  const z = zone(p.currentZone);
  if (!z) return { kind: 'result', lines: ['You are nowhere. Somehow.'] };
  if (p.battle) return { kind: 'result', lines: ['⚔️ Finish the fight in front of you first.'] };

  // Safe havens never spawn battles — content tables should already be
  // battle-free; this guard keeps them that way regardless of content.
  const pool = z.safeHaven
    ? z.explore.filter((e) => e.kind !== 'battle' && e.kind !== 'elite')
    : z.explore;
  const weights = pool.map((e) => e.weight);
  const idx = weightedIndex(rng, weights);
  const ev = pool[idx];
  if (!ev) return { kind: 'result', lines: ['Nothing stirs. The world holds its breath.'] };
  return applyExploreEvent(p, z, ev, rng);
}

function applyExploreEvent(p: PlayerState, z: ZoneDef, ev: ExploreEvent, rng: Rng): ExploreOutcome {
  switch (ev.kind) {
    case 'battle':
    case 'elite': {
      const battle = startBattle(ev.enemy, z.id);
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
        addItem(p, ev.item, 1);
        lines.push(`🎁 Found: ${itemName(ev.item)}`);
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

/** Next floor the player will face (1-based); floors.length+1 = boss. */
function nextFloor(p: PlayerState, d: DungeonDef): number {
  const f = p.flags[floorKey(d)];
  return typeof f === 'number' ? f : 1;
}

export function diveDungeon(
  p: PlayerState,
  d: DungeonDef,
  rng: Rng = defaultRng,
): { ok: boolean; battle?: BattleState; lines: string[] } {
  const bossFloor = d.floors.length + 1;
  const floor = nextFloor(p, d);
  if (floor > bossFloor) {
    return {
      ok: false,
      lines: [
        "You've already bested this place. Its boss may be re-fought from the dungeon screen.",
      ],
    };
  }

  const isBoss = floor === bossFloor;
  const pool = isBoss ? [d.boss] : (d.floors[floor - 1]?.enemies ?? [d.boss]);
  const enemyId = pool[Math.floor(rng() * pool.length)] ?? d.boss;
  const battle = startBattle(enemyId, p.currentZone);
  if (!battle) {
    return { ok: false, lines: ['The way is blocked by nothing at all, which is somehow worse.'] };
  }

  p.flags[floorKey(d)] = floor + 1;
  const line = isBoss
    ? `${d.emoji} You descend to the deepest chamber. ${enemyDef(d.boss)?.name ?? d.boss} awaits.`
    : `${d.emoji} Floor ${floor}: ${enemyDef(enemyId)?.name ?? enemyId} bars the way.`;
  return { ok: true, battle, lines: [line] };
}

/** Called after a dungeon battle victory; handles floor/boss bookkeeping. */
export function onDungeonVictory(
  p: PlayerState,
  d: DungeonDef,
): { firstClear: boolean; lines: string[] } {
  const bossKey = `dgn_${d.id}_boss`;
  const lines: string[] = [];
  const firstClear = p.flags[bossKey] === undefined;
  p.flags[bossKey] = true;
  p.flags[floorKey(d)] = d.floors.length + 2; // allow repeat boss fights
  if (firstClear && d.firstClear) {
    const fc = d.firstClear;
    p.gold += fc.gold;
    const xpLines = grantXp(p, fc.xp);
    lines.push(`🏆 First clear of ${d.name}!`);
    lines.push(`💰 +${fc.gold} gold · ✨ +${fc.xp} XP`);
    if (fc.item) {
      addItem(p, fc.item, 1);
      lines.push(`🎁 Received: ${itemName(fc.item)}`);
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
  const bossKey = `dgn_${d.id}_boss`;
  if (p.flags[bossKey]) return '🏆 Boss defeated — re-challenge available';
  const floor = nextFloor(p, d);
  return floor > d.floors.length
    ? '☠️ Boss floor ready'
    : `📍 Floor ${floor}/${d.floors.length + 1}`;
}
