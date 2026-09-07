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
  abandonDungeon,
  diveDungeon,
  dungeonCleared,
  dungeonOf,
  explore,
  resolveVictory,
} from '../src/engine/world.ts';
import { onLethalHit, performAction, startBattle } from '../src/engine/combat.ts';
import { applyInstance } from '../src/engine/effects.ts';
import { renderItemMenu } from '../src/render/battle.ts';
import { zone, ZONES } from '../src/content/zones.ts';
import { ENEMIES, enemy } from '../src/content/enemies.ts';
import { SHOPS } from '../src/content/facilities.ts';
import type { BattleState, PlayerState } from '../src/engine/types.ts';
import type { DungeonDef } from '../src/content/types.ts';
import { seeded, travelDirect } from './helpers.ts';

// ── content maps: where can each enemy be fought? ─────────────────────────

const BOSS_SPAWN = new Map<string, { zoneId: string; dungeonId: string }>();
const WILDS_ZONES = new Map<string, string[]>();
for (const zoneDef of ZONES) {
  if (zoneDef.dungeon) {
    BOSS_SPAWN.set(zoneDef.dungeon.boss, { zoneId: zoneDef.id, dungeonId: zoneDef.dungeon.id });
  }
  for (const event of zoneDef.explore) {
    if (event.kind === 'battle' || event.kind === 'elite') {
      const list = WILDS_ZONES.get(event.enemy) ?? [];
      if (!list.includes(zoneDef.id)) list.push(zoneDef.id);
      WILDS_ZONES.set(event.enemy, list);
    }
  }
}

function goto(player: PlayerState, zoneId: string): void {
  if (player.currentZone === zoneId) return;
  if (player.dungeonRun) assert(abandonDungeon(player).ok);
  assert(travelDirect(player, zoneId).ok, `travel to ${zoneId} blocked`);
}

/** Defeats a battle through the engine's real victory routing. */
function winBattle(player: PlayerState, battle: BattleState, rng: () => number): void {
  battle.enemy.hp = 0;
  resolveVictory(player, battle, rng);
  player.battle = undefined; // the real flow clears the battle on Continue
}

/** Dives until the dungeon boss is fought and won (real routing). */
function diveUntilBoss(player: PlayerState, dungeon: DungeonDef, rng: () => number): void {
  for (;;) {
    const res = diveDungeon(player, dungeon, rng);
    assert(res.ok, `dive blocked: ${res.lines[0]}`);
    if (!res.battle) continue;
    const bossHit = res.battle!.origin.kind === 'dungeon' && res.battle!.origin.boss;
    winBattle(player, res.battle!, rng);
    if (bossHit) break;
  }
}

/** Kills one instance of `enemyId` wherever it legitimately spawns. */
function killEnemy(player: PlayerState, enemyId: string, rng: () => number): void {
  const boss = BOSS_SPAWN.get(enemyId);
  if (boss) {
    goto(player, boss.zoneId);
    const dungeon = dungeonOf(zone(boss.zoneId)!)!;
    for (let floorAttempt = 0; floorAttempt < 24; floorAttempt++) {
      const res = diveDungeon(player, dungeon, rng);
      assert(res.ok, `dive blocked: ${res.lines[0]}`);
      if (!res.battle) continue;
      const origin = res.battle!.origin;
      const isBoss = origin.kind === 'dungeon' && origin.boss;
      winBattle(player, res.battle!, rng);
      if (isBoss) return;
    }
    throw new Error(`never reached boss ${enemyId} in ${dungeon.id}`);
  }
  const zones = WILDS_ZONES.get(enemyId);
  assert(zones && zones.length > 0, `no wilds spawn defined for ${enemyId}`);
  const zid = zones.find((zoneId) => player.unlockedZones.includes(zoneId));
  assert(zid, `${enemyId} only spawns in zones the player cannot unlock`);
  goto(player, zid);
  for (let exploreAttempt = 0; exploreAttempt < 500; exploreAttempt++) {
    const out = explore(player, rng);
    if (out.kind === 'battle') {
      const match = out.battle.enemy.id === enemyId;
      winBattle(player, out.battle, rng);
      if (match) return;
    }
  }
  throw new Error(`${enemyId} never appeared in ${zid} within 500 explores`);
}

// ── the flagship: full m1→m25 simulation ──────────────────────────────────

Deno.test('campaign: quest graph m1→m25 is traversable (levels/pacing out of scope)', () => {
  const rng = seeded(2026);
  const player = createPlayer(77, 'Dawncaller', 'warrior');
  player.level = 45; // stat pacing is out of scope — the QUEST GRAPH is the subject
  const mains = QUESTS.filter((questDef) => questDef.main).map((questDef) => questDef.id);
  assert(mains.length >= 20, 'main questline must exist');
  assert(mains.includes('m25_silence'), 'the story reaches m25');
  syncAvailability(player); // fresh players have no quest entries until this runs

  let guard = 0;
  while (mains.some((id) => player.quests[id]?.status !== 'done')) {
    if (++guard > 400) {
      throw new Error(
        'stuck: ' + mains.map((id) => `${id}=${player.quests[id]?.status ?? 'none'}`).join(' '),
      );
    }
    // Turn in everything ready first — instantly-complete collect quests
    // (goods already owned on accept) land straight in 'turnIn'. Physical
    // lifecycle (#64): travel to the FINISHER and complete on-site.
    for (const id of mains) {
      if (player.quests[id]?.status === 'turnIn') {
        const questDef = quest(id)!;
        goto(player, zoneOfNpc(questDef.finishNpc)!.id);
        assert(turnInQuest(player, id, questDef.finishNpc).ok, `turn in ${id}`);
      }
    }
    syncAvailability(player); // completions open the next chapter's quests
    for (const id of mains) {
      if (player.quests[id]?.status === 'available') {
        // Physical lifecycle (#64): travel to the STARTER and accept on-site.
        const questDef = quest(id)!;
        goto(player, zoneOfNpc(questDef.startNpc)!.id);
        assert(acceptQuest(player, id, questDef.startNpc).ok, `accept ${id}`);
      }
    }
    const active = QUESTS.find((questDef) =>
      questDef.main && player.quests[questDef.id]?.status === 'active'
    );
    if (!active) {
      if (mains.every((id) => player.quests[id]?.status === 'done')) break; // story complete
      // A freshly accepted quest may have flipped straight to turnIn.
      if (mains.some((id) => player.quests[id]?.status === 'turnIn')) continue;
      throw new Error(
        'no active main: ' +
          mains.map((id) => `${id}=${player.quests[id]?.status ?? 'none'}`).join(' '),
      );
    }
    const questProgress = player.quests[active.id]!;
    for (let objectiveIndex = 0; objectiveIndex < active.objectives.length; objectiveIndex++) {
      const obj = active.objectives[objectiveIndex]!;
      const have = obj.kind === 'collect'
        ? countOf(player, obj.target)
        : (questProgress.counts[objectiveIndex] ?? 0);
      if (have >= (obj.count ?? 1)) continue;
      switch (obj.kind) {
        case 'storyEvent':
          onStoryEvent(player, obj.target);
          break;
        case 'reach':
          goto(player, obj.target); // onZoneEnter progress counts on arrival
          break;
        case 'collect':
          addItem(player, obj.target, (obj.count ?? 1) - countOf(player, obj.target));
          onItemGain(player);
          break;
        case 'kill':
          killEnemy(player, obj.target, rng);
          break;
        case 'dungeon': {
          const dz = ZONES.find((zoneDef) => zoneDef.dungeon?.id === obj.target);
          assert(dz, `dungeon ${obj.target} not found`);
          goto(player, dz.id);
          diveUntilBoss(player, dz.dungeon!, rng);
          break;
        }
        default:
          throw new Error(`unhandled objective kind: ${obj.kind} in ${active.id}`);
      }
    }
    syncAvailability(player);
  }
  for (const id of mains) assertEquals(player.quests[id]?.status, 'done', id);
});

// ── encounter capacity (P0-1 / P0-2 regression) ───────────────────────────

Deno.test('campaign: every kill objective is obtainable (encounter capacity)', () => {
  for (const questDef of QUESTS) {
    for (const obj of questDef.objectives) {
      if (obj.kind !== 'kill') continue;
      const need = obj.count ?? 1;
      const wilds = (WILDS_ZONES.get(obj.target)?.length ?? 0) > 0;
      const boss = BOSS_SPAWN.has(obj.target);
      let floorSlots = 0;
      for (const zoneDef of ZONES) {
        if (!zoneDef.dungeon) continue;
        for (const floor of zoneDef.dungeon.floors) {
          floorSlots += floor.enemies.filter((enemyId) => enemyId === obj.target).length;
        }
      }
      const cap = wilds ? Number.POSITIVE_INFINITY : boss ? (need === 1 ? 1 : 0) : floorSlots;
      assert(
        cap >= need,
        `${questDef.id} needs ${obj.target} ×${need}; capacity ${cap} (wilds=${wilds} boss=${boss} floorSlots=${floorSlots})`,
      );
    }
  }
});

// ── combat semantics regressions ──────────────────────────────────────────

Deno.test('#98: Smoke Bomb is a pure escape — harmful effects survive the smoke', () => {
  const rng = seeded(9);
  const player = createPlayer(79, 'T', 'rogue');
  addItem(player, 'c_smoke_bomb', 1);
  const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player,
    rng,
  })!.battle;
  player.battle = battle;
  // A live removable sap (the shared `sap` slot, as an enemy Howl leaves).
  applyInstance(battle, {
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
  const res = performAction(player, battle, { kind: 'item', itemId: 'c_smoke_bomb' }, rng);
  assertEquals(battle.phase, 'fled', 'the bomb still escapes');
  assertEquals(
    battle.effectInstances.some((instance) => instance.defId === 'sap'),
    true,
    'a pure-escape Smoke Bomb leaves harmful effects unchanged (#98)',
  );
  assert(!res.lines.some((line) => line.includes('cleanses')), 'no cleanse is reported either');
});

Deno.test('combat: Smoke Bomb flees non-boss, never bosses, never wasted', () => {
  const rng = seeded(7);
  const player = createPlayer(78, 'T', 'rogue');
  addItem(player, 'c_smoke_bomb', 2);

  const wild = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player,
    rng,
  })!.battle;
  player.battle = wild;
  const bombs = countOf(player, 'c_smoke_bomb');
  performAction(player, wild, { kind: 'item', itemId: 'c_smoke_bomb' }, rng);
  assertEquals(wild.phase, 'fled', 'smoke bomb escapes normal fights');
  assertEquals(countOf(player, 'c_smoke_bomb'), bombs - 1);

  const boss = startBattle('e_vosk', {
    kind: 'dungeon',
    zoneId: 'hollowmere',
    dungeonId: 'd_sunken',
    floor: 4,
    boss: true,
  }, { player, rng })!.battle;
  player.battle = boss;
  performAction(player, boss, { kind: 'item', itemId: 'c_smoke_bomb' }, rng);
  assertEquals(boss.phase, 'active', 'no escape from bosses');
  assertEquals(countOf(player, 'c_smoke_bomb'), bombs - 1, 'the bomb is not consumed in vain');
});

Deno.test('combat: Venom Cut poisons the ENEMY, not the rogue', () => {
  const rng = seeded(11);
  const player = createPlayer(79, 'T', 'rogue');
  player.level = 45;
  player.hp = 99999; // #86: survive Jormunis's response — a fallen hero stops the round's bookkeeping
  player.skills.push('sk_venom_cut');
  player.mp = 100;
  // Tanky boss so the strike does not end the fight before the venom lands.
  // Jormunis: a boss with NO poison of its own — a clean fixture.
  const battle = startBattle('e_jormunis', {
    kind: 'dungeon',
    zoneId: 'frostpeak',
    dungeonId: 'd_glacier',
    floor: 4,
    boss: true,
  }, { player, rng })!.battle;
  battle.enemy.hp = 99999; // survive the 125% ATK strike so the venom lands
  battle.enemy.maxHp = 99999;
  player.battle = battle;
  performAction(player, battle, { kind: 'skill', skillId: 'sk_venom_cut' }, rng);
  // #81: the name finally means venom — a real poison instance on the foe.
  const venom = battle.effectInstances.find((instance) =>
    instance.side === 'enemy' && instance.kind === 'periodic' &&
    instance.defId === 'sk_venom_cut:e1'
  );
  assert(venom, 'the enemy is envenomed');
  assertEquals(venom.perRound, -16);
  assertEquals(venom.remaining, 2); // set for 3; first round-end tick elapsed
  assertEquals(
    battle.effectInstances.some((instance) =>
      instance.side === 'player' && instance.kind === 'periodic' && (instance.perRound ?? 0) < 0
    ),
    false,
    'the player is NOT poisoned',
  );
});

Deno.test('combat: invalid skill use costs no turn and no enemy phase', () => {
  const rng = seeded(13);
  const player = createPlayer(80, 'T', 'warrior'); // knows sk_cleave (4 MP)
  player.mp = 0;
  const battle = startBattle('e_wolf', { kind: 'explore', zoneId: 'whisperwood' }, {
    player,
    rng,
  })!.battle;
  player.battle = battle;
  const hpBefore = battle.enemy.hp;
  const res = performAction(player, battle, { kind: 'skill', skillId: 'sk_cleave' }, rng);
  assert(res.lines.some((line) => line.includes('MP')));
  assertEquals(battle.enemy.hp, hpBefore, 'enemy never acted on an invalid tap');
  assertEquals(battle.round, 1, 'no turn consumed');

  player.mp = 100;
  battle.cooldowns['sk_cleave'] = 2;
  const res2 = performAction(player, battle, { kind: 'skill', skillId: 'sk_cleave' }, rng);
  assert(res2.lines.some((line) => line.includes('cooldown')));
  assertEquals(battle.round, 1);
  assertEquals(battle.enemy.hp, hpBefore);
});

Deno.test('combat: Phoenix Cinder revives exactly once per battle, never by hand', () => {
  const player = createPlayer(81, 'T', 'warrior');
  addItem(player, 'c_phoenix_feather', 3);
  const battle = startBattle('e_aldric', {
    kind: 'dungeon',
    zoneId: 'umbra',
    dungeonId: 'd_throne',
    floor: 4,
    boss: true,
  }, { player, rng: seeded(80) })!.battle;
  player.battle = battle;

  player.hp = 0;
  const lines = onLethalHit(player, battle);
  assert(lines[0]!.includes('Phoenix'));
  assertEquals(battle.phoenixUsed, true);
  assertEquals(countOf(player, 'c_phoenix_feather'), 2);
  assertEquals(player.hp, Math.floor(statsOf(player).maxHp * 0.5));

  player.hp = 0;
  assertEquals(onLethalHit(player, battle), [], 'second lethal hit is simply defeat');
  assertEquals(countOf(player, 'c_phoenix_feather'), 2);

  // Manual use is refused: no consumption, no turn. (HP restored first —
  // #96 resolves a pre-existing terminal state before validation.)
  player.hp = 10;
  const rng = seeded(17);
  const before = countOf(player, 'c_phoenix_feather');
  const res = performAction(player, battle, { kind: 'item', itemId: 'c_phoenix_feather' }, rng);
  assert(res.lines.some((line) => line.includes('Cinder')));
  assertEquals(countOf(player, 'c_phoenix_feather'), before);
  assertEquals(battle.round, 1);

  // The battle items menu no longer offers the Cinder by hand (P1-9 UI),
  // and vs a boss the Smoke Bomb renders disabled (#35) instead of
  // promising an escape the handler refuses.
  addItem(player, 'c_smoke_bomb', 1);
  const menu = JSON.stringify(renderItemMenu(player));
  assert(!menu.includes('Use Phoenix Cinder'));
  assert(!menu.includes('Use Smoke Bomb'), 'Smoke Bomb is disabled vs a boss');
  assert(menu.includes('no use here'), 'inapplicable items render disabled');
});

Deno.test('campaign: m25 demands the Endless Seam itself, not an overworld echo', () => {
  const rng = seeded(23);
  const player = createPlayer(82, 'T', 'warrior');
  player.level = 45;
  player.unlockedZones.push('abyss');
  travelDirect(player, 'abyss');
  player.quests['m24_below'] = { status: 'done', counts: [] };
  syncAvailability(player);
  assert(acceptQuest(player, 'm25_silence', 'npc_echo').ok); // the Echo stands in the Abyss
  for (let exploreAttempt = 0; exploreAttempt < 2000; exploreAttempt++) {
    const out = explore(player, rng);
    if (out.kind === 'battle') {
      const hit = out.battle.enemy.id === 'e_warden';
      winBattle(player, out.battle, rng);
      if (hit) break;
    }
  }
  const questProgress = player.quests['m25_silence']!;
  assertEquals(questProgress.counts[0], 0, 'an overworld echo must NOT count toward m25');
  const seam = dungeonOf(zone('abyss')!)!;
  assertEquals(dungeonCleared(player, seam), false, 'overworld elite must NOT clear the dungeon');
  // The real fight: clearing the Endless Seam itself readies the finale.
  diveUntilBoss(player, seam, rng);
  assertEquals(player.quests['m25_silence'].status, 'turnIn', 'seam clear readies m25');
  assertEquals(dungeonCleared(player, seam), true);
});

// ── authored encounter eligibility (#73) ─────────────────────────────

Deno.test('encounters: authored eligibility protects low-level players (#73)', () => {
  const rng = seeded(303);
  const player = createPlayer(50, 'T', 'warrior');

  // A level-1 player finds NO hostiles in the Whisperwood — and never the
  // level-7 stag: the protection is authored content, not an engine guess.
  player.level = 1;
  assert(travelDirect(player, 'whisperwood').ok);
  for (let exploreAttempt = 0; exploreAttempt < 400; exploreAttempt++) {
    const out = explore(player, rng);
    assert(
      out.kind !== 'battle',
      `level-1 rolled a Whisperwood hostile: ${out.kind === 'battle' ? out.battle.enemy.id : ''}`,
    );
  }

  // At level 4 the ordinary pool is live but the elite is still locked.
  player.level = 4;
  for (let exploreAttempt = 0; exploreAttempt < 600; exploreAttempt++) {
    const out = explore(player, rng);
    assert(
      !(out.kind === 'battle' && out.battle.origin.kind === 'elite'),
      'a level-4 player must not roll the elite',
    );
  }

  // The Outskirts give level-1 heroes a real, level-appropriate pool.
  player.level = 1;
  assert(travelDirect(player, 'outskirts').ok);
  let fights = 0;
  for (let exploreAttempt = 0; exploreAttempt < 300 && fights < 8; exploreAttempt++) {
    const out = explore(player, rng);
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
  for (const zoneDef of ZONES) {
    for (const event of zoneDef.explore) {
      if (event.kind !== 'battle' && event.kind !== 'elite') continue;
      const min = event.minPlayerLevel ?? 1;
      assert(min >= 1, `${zoneDef.id}: bad band on ${event.enemy}`);
      if (event.maxPlayerLevel !== undefined) assert(event.maxPlayerLevel >= min, zoneDef.id);
    }
  }
  const stag = zone('whisperwood')!.explore.find((event) => event.kind === 'elite');
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
  for (const zoneDef of ZONES) {
    for (const event of zoneDef.explore) {
      if (event.kind === 'battle' || event.kind === 'elite') wilds.add(event.enemy);
      if (event.kind === 'treasure' && event.item) farmableDrops.add(event.item);
    }
    const dungeon = zoneDef.dungeon;
    if (!dungeon) continue;
    floors.add(dungeon.boss); // bosses are always rematchable in their own dungeon
    for (const floor of dungeon.floors) for (const enemyId of floor.enemies) floors.add(enemyId);
  }
  for (const enemyDef of ENEMIES) {
    if (!wilds.has(enemyDef.id) && !floors.has(enemyDef.id)) continue;
    for (const id of Object.keys(enemyDef.drops ?? {})) farmableDrops.add(id);
  }
  const shopItems = new Set<string>();
  // Authored facility stock (#161): every rule of every shop is a
  // reachable source — conditions gate WHEN, never WHETHER.
  for (const shopDef of SHOPS) {
    for (const rule of shopDef.stock) {
      for (const id of rule.items) shopItems.add(id);
    }
  }

  const problems: string[] = [];
  QUESTS.forEach((questDef, qi) => {
    for (const objective of questDef.objectives) {
      if (objective.kind !== 'collect') continue;
      const need = objective.count ?? 1;
      if (farmableDrops.has(objective.target) || shopItems.has(objective.target)) continue;

      // Finite guaranteed supply, from strictly earlier content only —
      // a quest can never source its own goods, and later quests or
      // higher-chapter dungeons can't be relied upon.
      let supply = 0;
      for (const pq of QUESTS.slice(0, qi)) {
        supply += pq.rewards.items?.[objective.target] ?? 0;
      }
      for (const zoneDef of ZONES) {
        if (zoneDef.chapter > questDef.chapter) continue;
        if (zoneDef.dungeon?.firstClear?.item === objective.target) supply += 1;
        for (const floor of zoneDef.dungeon?.floors ?? []) {
          if (floor.treasure?.item === objective.target) supply += 1;
        }
      }
      if (supply < need) {
        problems.push(
          `${questDef.id} needs ${objective.target} ×${need} but no reachable source exists (guaranteed supply before it: ${supply})`,
        );
      }
    }
  });
  assertEquals(problems, [], `unreachable collect sources:\n${problems.join('\n')}`);
});
