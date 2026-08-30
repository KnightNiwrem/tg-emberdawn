/**
 * Progression & campaign integrity — the flagship suite from FINDINGS.md.
 * Drives the FULL main questline m1→m25 through the pure engine with a
 * seeded RNG, asserts every kill objective is obtainable (P0-1/P0-2
 * regression), and locks in the combat semantics fixes (P1-5/6/7/9/10).
 */

import { assert, assertEquals } from '@std/assert';
import {
  acceptQuest,
  onItemGain,
  onTalk,
  syncAvailability,
  turnInQuest,
} from '../src/engine/quests.ts';
import { QUESTS } from '../src/content/quests.ts';
import { addItem, countOf } from '../src/engine/inventory.ts';
import { createPlayer, statsOf } from '../src/engine/character.ts';
import {
  diveDungeon,
  dungeonCleared,
  dungeonOf,
  explore,
  resolveVictory,
  travel,
} from '../src/engine/world.ts';
import { onLethalHit, performAction, startBattle } from '../src/engine/combat.ts';
import { renderItemMenu } from '../src/render/battle.ts';
import { zone, ZONES } from '../src/content/zones.ts';
import { ENEMIES } from '../src/content/enemies.ts';
import { shopStock } from '../src/content/items.ts';
import type { BattleState, PlayerState } from '../src/engine/types.ts';

/** Deterministic RNG (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── content maps: where can each enemy be fought? ─────────────────────────

const BOSS_SPAWN = new Map<string, { zoneId: string; dungeonId: string }>();
const WILDS_ZONES = new Map<string, string[]>();
for (const z of ZONES) {
  if (z.dungeon) BOSS_SPAWN.set(z.dungeon.boss, { zoneId: z.id, dungeonId: z.dungeon.id });
  for (const ev of z.explore) {
    if (ev.kind === 'battle' || ev.kind === 'elite') {
      const list = WILDS_ZONES.get(ev.enemy) ?? [];
      if (!list.includes(z.id)) list.push(z.id);
      WILDS_ZONES.set(ev.enemy, list);
    }
  }
}

function goto(p: PlayerState, zoneId: string): void {
  if (p.currentZone === zoneId) return;
  assert(travel(p, zoneId).ok, `travel to ${zoneId} blocked`);
}

/** Defeats a battle through the engine's real victory routing. */
function winBattle(p: PlayerState, b: BattleState, rng: () => number): void {
  b.enemy.hp = 0;
  resolveVictory(p, b, rng);
  p.battle = undefined; // the real flow clears the battle on Continue
}

/** Kills one instance of `enemyId` wherever it legitimately spawns. */
function killEnemy(p: PlayerState, enemyId: string, rng: () => number): void {
  const boss = BOSS_SPAWN.get(enemyId);
  if (boss) {
    goto(p, boss.zoneId);
    const d = dungeonOf(zone(boss.zoneId)!)!;
    for (let i = 0; i < 24; i++) {
      const res = diveDungeon(p, d, rng);
      assert(res.ok && res.battle, `dive blocked: ${res.lines[0]}`);
      const origin = res.battle!.origin;
      const isBoss = origin.kind === 'dungeon' && origin.boss;
      winBattle(p, res.battle!, rng);
      if (isBoss) return;
    }
    throw new Error(`never reached boss ${enemyId} in ${d.id}`);
  }
  const zones = WILDS_ZONES.get(enemyId);
  assert(zones && zones.length > 0, `no wilds spawn defined for ${enemyId}`);
  const zid = zones.find((z) => p.unlockedZones.includes(z));
  assert(zid, `${enemyId} only spawns in zones the player cannot unlock`);
  goto(p, zid);
  for (let i = 0; i < 500; i++) {
    const out = explore(p, rng);
    if (out.kind === 'battle') {
      const match = out.battle.enemy.id === enemyId;
      winBattle(p, out.battle, rng);
      if (match) return;
    }
  }
  throw new Error(`${enemyId} never appeared in ${zid} within 500 explores`);
}

// ── the flagship: full m1→m25 simulation ──────────────────────────────────

Deno.test('campaign: quest graph m1→m25 is traversable (levels/pacing out of scope)', () => {
  const rng = seeded(2026);
  const p = createPlayer(77, 'Dawncaller', 'warrior');
  p.level = 45; // stat pacing is out of scope — the QUEST GRAPH is the subject
  const mains = QUESTS.filter((q) => q.main).map((q) => q.id);
  assert(mains.length >= 20, 'main questline must exist');
  assert(mains.includes('m25_silence'), 'the story reaches m25');
  syncAvailability(p); // fresh players have no quest entries until this runs

  let guard = 0;
  while (mains.some((id) => p.quests[id]?.status !== 'done')) {
    if (++guard > 400) {
      throw new Error(
        'stuck: ' + mains.map((id) => `${id}=${p.quests[id]?.status ?? 'none'}`).join(' '),
      );
    }
    // Turn in everything ready first — instantly-complete collect quests
    // (goods already owned on accept) land straight in 'turnIn'.
    for (const id of mains) {
      if (p.quests[id]?.status === 'turnIn') assert(turnInQuest(p, id).ok, `turn in ${id}`);
    }
    syncAvailability(p); // completions open the next chapter's quests
    for (const id of mains) {
      if (p.quests[id]?.status === 'available') {
        assert(acceptQuest(p, id).ok, `accept ${id}`);
      }
    }
    const active = QUESTS.find((q) => q.main && p.quests[q.id]?.status === 'active');
    if (!active) {
      if (mains.every((id) => p.quests[id]?.status === 'done')) break; // story complete
      // A freshly accepted quest may have flipped straight to turnIn.
      if (mains.some((id) => p.quests[id]?.status === 'turnIn')) continue;
      throw new Error(
        'no active main: ' +
          mains.map((id) => `${id}=${p.quests[id]?.status ?? 'none'}`).join(' '),
      );
    }
    const qp = p.quests[active.id]!;
    for (let i = 0; i < active.objectives.length; i++) {
      const obj = active.objectives[i]!;
      const have = obj.kind === 'collect' ? countOf(p, obj.target) : (qp.counts[i] ?? 0);
      if (have >= (obj.count ?? 1)) continue;
      switch (obj.kind) {
        case 'talk':
          onTalk(p, obj.target);
          break;
        case 'reach':
          goto(p, obj.target); // onZoneEnter progress counts on arrival
          break;
        case 'collect':
          addItem(p, obj.target, (obj.count ?? 1) - countOf(p, obj.target));
          onItemGain(p);
          break;
        case 'kill':
          killEnemy(p, obj.target, rng);
          break;
        case 'dungeon': {
          const dz = ZONES.find((z) => z.dungeon?.id === obj.target);
          assert(dz, `dungeon ${obj.target} not found`);
          goto(p, dz.id);
          for (;;) {
            const res = diveDungeon(p, dz.dungeon!, rng);
            assert(res.ok && res.battle, `dive blocked: ${res.lines[0]}`);
            const bossHit = res.battle!.origin.kind === 'dungeon' && res.battle!.origin.boss;
            winBattle(p, res.battle!, rng);
            if (bossHit) break;
          }
          break;
        }
        default:
          throw new Error(`unhandled objective kind: ${obj.kind} in ${active.id}`);
      }
    }
    syncAvailability(p);
  }
  for (const id of mains) assertEquals(p.quests[id]?.status, 'done', id);
});

// ── encounter capacity (P0-1 / P0-2 regression) ───────────────────────────

Deno.test('campaign: every kill objective is obtainable (encounter capacity)', () => {
  for (const q of QUESTS) {
    for (const obj of q.objectives) {
      if (obj.kind !== 'kill') continue;
      const need = obj.count ?? 1;
      const wilds = (WILDS_ZONES.get(obj.target)?.length ?? 0) > 0;
      const boss = BOSS_SPAWN.has(obj.target);
      let floorSlots = 0;
      for (const z of ZONES) {
        if (!z.dungeon) continue;
        for (const f of z.dungeon.floors) {
          floorSlots += f.enemies.filter((e) => e === obj.target).length;
        }
      }
      const cap = wilds ? Number.POSITIVE_INFINITY : boss ? (need === 1 ? 1 : 0) : floorSlots;
      assert(
        cap >= need,
        `${q.id} needs ${obj.target} ×${need}; capacity ${cap} (wilds=${wilds} boss=${boss} floorSlots=${floorSlots})`,
      );
    }
  }
});

// ── combat semantics regressions ──────────────────────────────────────────

Deno.test('combat: Smoke Bomb flees non-boss, never bosses, never wasted', () => {
  const rng = seeded(7);
  const p = createPlayer(78, 'T', 'rogue');
  addItem(p, 'c_smoke_bomb', 2);

  const wild = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' })!;
  p.battle = wild;
  const bombs = countOf(p, 'c_smoke_bomb');
  performAction(p, wild, { kind: 'item', itemId: 'c_smoke_bomb' }, rng);
  assertEquals(wild.phase, 'fled', 'smoke bomb escapes normal fights');
  assertEquals(countOf(p, 'c_smoke_bomb'), bombs - 1);

  const boss = startBattle('e_vosk', {
    kind: 'dungeon',
    zoneId: 'hollowmere',
    dungeonId: 'd_sunken',
    floor: 4,
    boss: true,
  })!;
  p.battle = boss;
  performAction(p, boss, { kind: 'item', itemId: 'c_smoke_bomb' }, rng);
  assertEquals(boss.phase, 'active', 'no escape from bosses');
  assertEquals(countOf(p, 'c_smoke_bomb'), bombs - 1, 'the bomb is not consumed in vain');
});

Deno.test('combat: Venom Cut weakens the ENEMY, not the rogue', () => {
  const rng = seeded(11);
  const p = createPlayer(79, 'T', 'rogue');
  p.level = 45;
  p.skills.push('sk_venom_cut');
  p.mp = 100;
  // Tanky boss so the strike does not end the fight before the debuff lands.
  // Jormunis: a boss with NO weaken move of its own — a clean fixture.
  const b = startBattle('e_jormunis', {
    kind: 'dungeon',
    zoneId: 'frostpeak',
    dungeonId: 'd_glacier',
    floor: 4,
    boss: true,
  })!;
  b.enemy.hp = 99999; // survive the 130% ATK strike so the debuff lands
  b.enemy.maxHp = 99999;
  p.battle = b;
  performAction(p, b, { kind: 'skill', skillId: 'sk_venom_cut' }, rng);
  assertEquals(b.buffs.enemyWeakenedPct, 0.25, 'enemy offense is weakened');
  assertEquals(b.buffs.enemyWeakenTurns, 2); // set for 3; first tick elapsed
  assertEquals(b.buffs.weakenedPct, 0, 'the player is NOT self-weakened');
});

Deno.test('combat: invalid skill use costs no turn and no enemy phase', () => {
  const rng = seeded(13);
  const p = createPlayer(80, 'T', 'warrior'); // knows sk_cleave (4 MP)
  p.mp = 0;
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' })!;
  p.battle = b;
  const hpBefore = b.enemy.hp;
  const res = performAction(p, b, { kind: 'skill', skillId: 'sk_cleave' }, rng);
  assert(res.lines.some((l) => l.includes('MP')));
  assertEquals(b.enemy.hp, hpBefore, 'enemy never acted on an invalid tap');
  assertEquals(b.round, 1, 'no turn consumed');

  p.mp = 100;
  b.cooldowns['sk_cleave'] = 2;
  const res2 = performAction(p, b, { kind: 'skill', skillId: 'sk_cleave' }, rng);
  assert(res2.lines.some((l) => l.includes('cooldown')));
  assertEquals(b.round, 1);
  assertEquals(b.enemy.hp, hpBefore);
});

Deno.test('combat: Phoenix Cinder revives exactly once per battle, never by hand', () => {
  const p = createPlayer(81, 'T', 'warrior');
  addItem(p, 'c_phoenix_feather', 3);
  const b = startBattle('e_aldric', {
    kind: 'dungeon',
    zoneId: 'umbra',
    dungeonId: 'd_throne',
    floor: 4,
    boss: true,
  })!;
  p.battle = b;

  p.hp = 0;
  const lines = onLethalHit(p, b);
  assert(lines[0]!.includes('Phoenix'));
  assertEquals(b.phoenixUsed, true);
  assertEquals(countOf(p, 'c_phoenix_feather'), 2);
  assertEquals(p.hp, Math.floor(statsOf(p).maxHp * 0.5));

  p.hp = 0;
  assertEquals(onLethalHit(p, b), [], 'second lethal hit is simply defeat');
  assertEquals(countOf(p, 'c_phoenix_feather'), 2);

  // Manual use is refused: no consumption, no turn.
  const rng = seeded(17);
  const before = countOf(p, 'c_phoenix_feather');
  const res = performAction(p, b, { kind: 'item', itemId: 'c_phoenix_feather' }, rng);
  assert(res.lines.some((l) => l.includes('Cinder')));
  assertEquals(countOf(p, 'c_phoenix_feather'), before);
  assertEquals(b.round, 1);

  // The battle items menu no longer offers the Cinder by hand (P1-9 UI).
  addItem(p, 'c_smoke_bomb', 1);
  const menu = JSON.stringify(renderItemMenu(p));
  assert(!menu.includes('Use Phoenix Cinder'));
  assert(menu.includes('Use Smoke Bomb'));
});

Deno.test('campaign: m25 demands the Endless Seam itself, not an overworld echo', () => {
  const rng = seeded(23);
  const p = createPlayer(82, 'T', 'warrior');
  p.level = 45;
  p.unlockedZones.push('abyss');
  travel(p, 'abyss');
  p.quests['m24_below'] = { status: 'done', counts: [] };
  syncAvailability(p);
  assert(acceptQuest(p, 'm25_silence').ok);
  for (let i = 0; i < 2000; i++) {
    const out = explore(p, rng);
    if (out.kind === 'battle') {
      const hit = out.battle.enemy.id === 'e_warden';
      winBattle(p, out.battle, rng);
      if (hit) break;
    }
  }
  const qp = p.quests['m25_silence']!;
  assertEquals(qp.counts[0], 0, 'an overworld echo must NOT count toward m25');
  const seam = dungeonOf(zone('abyss')!)!;
  assertEquals(dungeonCleared(p, seam), false, 'overworld elite must NOT clear the dungeon');
  // The real fight: clearing the Endless Seam itself readies the finale.
  for (;;) {
    const res = diveDungeon(p, seam, rng);
    assert(res.ok && res.battle, `dive blocked: ${res.lines[0]}`);
    const bossHit = res.battle!.origin.kind === 'dungeon' && res.battle!.origin.boss;
    winBattle(p, res.battle!, rng);
    if (bossHit) break;
  }
  assertEquals(p.quests['m25_silence'].status, 'turnIn', 'seam clear readies m25');
  assertEquals(dungeonCleared(p, seam), true);
});

// ── static collect-source reachability (#9) ─────────────────────────────

Deno.test('campaign: every collect objective has a reachable source (#9)', () => {
  // A drop from a farmable enemy (wilds spawn or any dungeon floor, both
  // infinitely repeatable) is a repeatable source; explore-table treasures
  // re-roll forever; shop stock is repeatable. Only guaranteed finite
  // supplies (quest rewards, first-clears, one-time floor caches) must
  // actually cover the requirement — and only from BEFORE the quest.
  const farmableDrops = new Set<string>();
  const wilds = new Set<string>();
  const floors = new Set<string>();
  for (const z of ZONES) {
    for (const ev of z.explore) {
      if (ev.kind === 'battle' || ev.kind === 'elite') wilds.add(ev.enemy);
      if (ev.kind === 'treasure' && ev.item) farmableDrops.add(ev.item);
    }
    const d = z.dungeon;
    if (!d) continue;
    floors.add(d.boss); // bosses are always rematchable in their own dungeon
    for (const f of d.floors) for (const e of f.enemies) floors.add(e);
  }
  for (const e of ENEMIES) {
    if (!wilds.has(e.id) && !floors.has(e.id)) continue;
    for (const id of Object.keys(e.drops ?? {})) farmableDrops.add(id);
  }
  const shopItems = new Set<string>();
  for (const z of ZONES) {
    for (let t = 1; t <= 8; t++) for (const id of shopStock(z.id, t)) shopItems.add(id);
  }

  const problems: string[] = [];
  QUESTS.forEach((q, qi) => {
    for (const o of q.objectives) {
      if (o.kind !== 'collect') continue;
      const need = o.count ?? 1;
      if (farmableDrops.has(o.target) || shopItems.has(o.target)) continue;

      // Finite guaranteed supply, from strictly earlier content only —
      // a quest can never source its own goods, and later quests or
      // higher-chapter dungeons can't be relied upon.
      let supply = 0;
      for (const pq of QUESTS.slice(0, qi)) {
        supply += pq.rewards.items?.[o.target] ?? 0;
      }
      for (const z of ZONES) {
        if (z.chapter > q.chapter) continue;
        if (z.dungeon?.firstClear?.item === o.target) supply += 1;
        for (const f of z.dungeon?.floors ?? []) {
          if (f.treasure?.item === o.target) supply += 1;
        }
      }
      if (supply < need) {
        problems.push(
          `${q.id} needs ${o.target} ×${need} but no reachable source exists (guaranteed supply before it: ${supply})`,
        );
      }
    }
  });
  assertEquals(problems, [], `unreachable collect sources:\n${problems.join('\n')}`);
});
