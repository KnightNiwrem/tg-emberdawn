/** Progression & campaign integrity — drives the FULL main questline m1→m25 through the pure engine,
 * asserts every kill objective is obtainable, and locks in the combat/progression fixes. */

import { assert, assertEquals } from '@std/assert';
import {
  acceptQuest,
  onItemGain,
  onStoryEvent,
  syncAvailability,
  turnInQuest,
} from '../src/engine/quests.ts';
import { quest, QUESTS, zoneOfNpc } from '../src/content/quests.ts';
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
import { applyInstance } from '../src/engine/effects.ts';
import { renderItemMenu } from '../src/render/battle.ts';
import { zone, ZONES } from '../src/content/zones.ts';
import { ENEMIES, enemy } from '../src/content/enemies.ts';
import { shopStock } from '../src/content/items.ts';
import type { BattleState, PlayerState } from '../src/engine/types.ts';
import type { DungeonDef } from '../src/content/types.ts';
import { seeded } from './helpers.ts';

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

/** Dives until the dungeon boss is fought and won (real routing). */
function diveUntilBoss(p: PlayerState, d: DungeonDef, rng: () => number): void {
  for (;;) {
    const res = diveDungeon(p, d, rng);
    assert(res.ok && res.battle, `dive blocked: ${res.lines[0]}`);
    const bossHit = res.battle!.origin.kind === 'dungeon' && res.battle!.origin.boss;
    winBattle(p, res.battle!, rng);
    if (bossHit) break;
  }
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
    // (goods already owned on accept) land straight in 'turnIn'. Physical
    // lifecycle (#64): travel to the FINISHER and complete on-site.
    for (const id of mains) {
      if (p.quests[id]?.status === 'turnIn') {
        const q = quest(id)!;
        goto(p, zoneOfNpc(q.finishNpc)!.id);
        assert(turnInQuest(p, id, q.finishNpc).ok, `turn in ${id}`);
      }
    }
    syncAvailability(p); // completions open the next chapter's quests
    for (const id of mains) {
      if (p.quests[id]?.status === 'available') {
        // Physical lifecycle (#64): travel to the STARTER and accept on-site.
        const q = quest(id)!;
        goto(p, zoneOfNpc(q.startNpc)!.id);
        assert(acceptQuest(p, id, q.startNpc).ok, `accept ${id}`);
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
        case 'storyEvent':
          onStoryEvent(p, obj.target);
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
          diveUntilBoss(p, dz.dungeon!, rng);
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

Deno.test('#98: Smoke Bomb is a pure escape — harmful effects survive the smoke', () => {
  const rng = seeded(9);
  const p = createPlayer(79, 'T', 'rogue');
  addItem(p, 'c_smoke_bomb', 1);
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player: p,
    rng,
  })!.battle;
  p.battle = b;
  // A live removable sap (the shared `sap` slot, as an enemy Howl leaves).
  applyInstance(b, {
    defId: 'sap',
    name: 'Sapped',
    kind: 'statmod',
    side: 'player',
    source: { kind: 'enemyMove', id: 'Howl', name: 'Howl' },
    stat: 'outgoing',
    pct: -0.2,
    tags: ['harmful', 'weaken'],
    stacking: 'strongest',
    duration: 3,
    timing: 'immediate',
    removable: true,
  });
  const res = performAction(p, b, { kind: 'item', itemId: 'c_smoke_bomb' }, rng);
  assertEquals(b.phase, 'fled', 'the bomb still escapes');
  assertEquals(
    b.effectInstances.some((i) => i.defId === 'sap'),
    true,
    'a pure-escape Smoke Bomb leaves harmful effects unchanged (#98)',
  );
  assert(!res.lines.some((l) => l.includes('cleanses')), 'no cleanse is reported either');
});

Deno.test('combat: Smoke Bomb flees non-boss, never bosses, never wasted', () => {
  const rng = seeded(7);
  const p = createPlayer(78, 'T', 'rogue');
  addItem(p, 'c_smoke_bomb', 2);

  const wild = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player: p,
    rng,
  })!.battle;
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
  }, { player: p, rng })!.battle;
  p.battle = boss;
  performAction(p, boss, { kind: 'item', itemId: 'c_smoke_bomb' }, rng);
  assertEquals(boss.phase, 'active', 'no escape from bosses');
  assertEquals(countOf(p, 'c_smoke_bomb'), bombs - 1, 'the bomb is not consumed in vain');
});

Deno.test('combat: Venom Cut poisons the ENEMY, not the rogue', () => {
  const rng = seeded(11);
  const p = createPlayer(79, 'T', 'rogue');
  p.level = 45;
  p.hp = 99999; // #86: survive Jormunis's response — a fallen hero stops the round's bookkeeping
  p.skills.push('sk_venom_cut');
  p.mp = 100;
  // Tanky boss so the strike does not end the fight before the venom lands.
  // Jormunis: a boss with NO poison of its own — a clean fixture.
  const b = startBattle('e_jormunis', {
    kind: 'dungeon',
    zoneId: 'frostpeak',
    dungeonId: 'd_glacier',
    floor: 4,
    boss: true,
  }, { player: p, rng })!.battle;
  b.enemy.hp = 99999; // survive the 125% ATK strike so the venom lands
  b.enemy.maxHp = 99999;
  p.battle = b;
  performAction(p, b, { kind: 'skill', skillId: 'sk_venom_cut' }, rng);
  // #81: the name finally means venom — a real poison instance on the foe.
  const venom = b.effectInstances.find((i) =>
    i.side === 'enemy' && i.kind === 'periodic' && i.defId === 'sk_venom_cut:e1'
  );
  assert(venom, 'the enemy is envenomed');
  assertEquals(venom.perRound, -16);
  assertEquals(venom.remaining, 2); // set for 3; first round-end tick elapsed
  assertEquals(
    b.effectInstances.some((i) =>
      i.side === 'player' && i.kind === 'periodic' && (i.perRound ?? 0) < 0
    ),
    false,
    'the player is NOT poisoned',
  );
});

Deno.test('combat: invalid skill use costs no turn and no enemy phase', () => {
  const rng = seeded(13);
  const p = createPlayer(80, 'T', 'warrior'); // knows sk_cleave (4 MP)
  p.mp = 0;
  const b = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player: p,
    rng,
  })!.battle;
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
  }, { player: p, rng: seeded(80) })!.battle;
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

  // Manual use is refused: no consumption, no turn. (HP restored first —
  // #96 resolves a pre-existing terminal state before validation.)
  p.hp = 10;
  const rng = seeded(17);
  const before = countOf(p, 'c_phoenix_feather');
  const res = performAction(p, b, { kind: 'item', itemId: 'c_phoenix_feather' }, rng);
  assert(res.lines.some((l) => l.includes('Cinder')));
  assertEquals(countOf(p, 'c_phoenix_feather'), before);
  assertEquals(b.round, 1);

  // The battle items menu no longer offers the Cinder by hand (P1-9 UI),
  // and vs a boss the Smoke Bomb renders disabled (#35) instead of
  // promising an escape the handler refuses.
  addItem(p, 'c_smoke_bomb', 1);
  const menu = JSON.stringify(renderItemMenu(p));
  assert(!menu.includes('Use Phoenix Cinder'));
  assert(!menu.includes('Use Smoke Bomb'), 'Smoke Bomb is disabled vs a boss');
  assert(menu.includes('no use here'), 'inapplicable items render disabled');
});

Deno.test('campaign: m25 demands the Endless Seam itself, not an overworld echo', () => {
  const rng = seeded(23);
  const p = createPlayer(82, 'T', 'warrior');
  p.level = 45;
  p.unlockedZones.push('abyss');
  travel(p, 'abyss');
  p.quests['m24_below'] = { status: 'done', counts: [] };
  syncAvailability(p);
  assert(acceptQuest(p, 'm25_silence', 'npc_echo').ok); // the Echo stands in the Abyss
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
  diveUntilBoss(p, seam, rng);
  assertEquals(p.quests['m25_silence'].status, 'turnIn', 'seam clear readies m25');
  assertEquals(dungeonCleared(p, seam), true);
});

// ── authored encounter eligibility (#73) ─────────────────────────────

Deno.test('encounters: authored eligibility protects low-level players (#73)', () => {
  const rng = seeded(303);
  const p = createPlayer(50, 'T', 'warrior');

  // A level-1 player finds NO hostiles in the Whisperwood — and never the
  // level-7 stag: the protection is authored content, not an engine guess.
  p.level = 1;
  assert(travel(p, 'whisperwood').ok);
  for (let i = 0; i < 400; i++) {
    const out = explore(p, rng);
    assert(
      out.kind !== 'battle',
      `level-1 rolled a Whisperwood hostile: ${out.kind === 'battle' ? out.battle.enemy.id : ''}`,
    );
  }

  // At level 4 the ordinary pool is live but the elite is still locked.
  p.level = 4;
  for (let i = 0; i < 600; i++) {
    const out = explore(p, rng);
    assert(
      !(out.kind === 'battle' && out.battle.origin.kind === 'elite'),
      'a level-4 player must not roll the elite',
    );
  }

  // The Outskirts give level-1 heroes a real, level-appropriate pool.
  p.level = 1;
  assert(travel(p, 'outskirts').ok);
  let fights = 0;
  for (let i = 0; i < 300 && fights < 8; i++) {
    const out = explore(p, rng);
    if (out.kind === 'battle') {
      fights++;
      assert(
        enemy(out.battle.enemy.id)!.level <= 3,
        `outskirts hostile too tough for a level-1 hero: ${out.battle.enemy.id}`,
      );
    }
  }
  assert(fights >= 8, 'the outskirts must offer repeatable low-level combat');

  // The bands themselves are authored, sane, and backwards-safe: no max on
  // ordinary enemies (old areas stay farmable end-game), elites opt-in.
  for (const z of ZONES) {
    for (const ev of z.explore) {
      if (ev.kind !== 'battle' && ev.kind !== 'elite') continue;
      const min = ev.minPlayerLevel ?? 1;
      assert(min >= 1, `${z.id}: bad band on ${ev.enemy}`);
      if (ev.maxPlayerLevel !== undefined) assert(ev.maxPlayerLevel >= min, z.id);
    }
  }
  const stag = zone('whisperwood')!.explore.find((e) => e.kind === 'elite');
  assertEquals(stag?.minPlayerLevel, 5);
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
