/** The level-6 Iron Chunk route remains viable through the Hollow's
 * combat rooms and discovery cache. Leaving to turn in and purchase steel
 * ends that descent; the next attempt must begin at floor one. */

import { assert, assertEquals } from '@std/assert';
import { applyDeath, clampPools, createPlayer, grantXp, statsOf } from '../src/engine/character.ts';
import { xpForNextLevel } from '../src/engine/classes.ts';
import { performAction } from '../src/engine/combat.ts';
import { countOf, removeItem } from '../src/engine/inventory.ts';
import { acceptQuest, onStoryEvent, syncAvailability, turnInQuest } from '../src/engine/quests.ts';
import { buy, resolveStock } from '../src/engine/shops.ts';
import {
  abandonDungeon,
  diveDungeon,
  dungeonOf,
  explore,
  resolveVictory,
} from '../src/engine/world.ts';
import type { BattleState, PlayerState } from '../src/engine/types.ts';
import { CLASS_IDS } from '../src/engine/types.ts';
import { isEquippable, item as itemDef } from '../src/content/items.ts';
import { isDamageSkill, skill as skillDef, skillMaxDamagePower } from '../src/content/skills.ts';
import type { SkillDef } from '../src/content/types.ts';
import { zone as zoneDef } from '../src/content/zones.ts';
import { seeded, travelDirect } from './helpers.ts';

function goto(player: PlayerState, zoneId: string): void {
  if (player.currentZone !== zoneId) travelDirect(player, zoneId);
}

/** A minimal competent fighter: strongest castable offensive skill, heals
 * when it matters (skill first, potion as backup), basics otherwise. */
function fightToConclusion(
  player: PlayerState,
  battle: BattleState,
  rng: () => number,
  tag: string,
): { outcome: 'win' | 'death'; lines: string[] } {
  let rounds = 0;
  let lastSkill = '';
  while (battle.phase === 'active' && rounds++ < 100) {
    const maxHp = statsOf(player).maxHp;
    const castable = player.skills
      .map((id) => skillDef(id))
      .filter((skillDef): skillDef is SkillDef =>
        !!skillDef && skillDef.id !== lastSkill && player.mp >= skillDef.mpCost
      );
    const heal = castable.find((skillDef) => skillDef.type === 'heal');
    const offensive = castable
      .filter(isDamageSkill)
      .sort((leftSkillDef, b2) => skillMaxDamagePower(b2) - skillMaxDamagePower(leftSkillDef))[0];
    if (player.hp < maxHp * 0.5 && (heal || countOf(player, 'c_minor_potion') > 0)) {
      if (heal) {
        lastSkill = heal.id;
        performAction(player, battle, { kind: 'skill', skillId: heal.id }, rng);
      } else {
        performAction(player, battle, { kind: 'item', itemId: 'c_minor_potion' }, rng);
      }
    } else if (offensive) {
      lastSkill = offensive.id;
      performAction(player, battle, { kind: 'skill', skillId: offensive.id }, rng);
    } else {
      performAction(player, battle, { kind: 'attack' }, rng);
    }
    if (battle.enemy.hp <= 0) return { outcome: 'win', lines: resolveVictory(player, battle, rng) };
    if (player.hp <= 0) {
      applyDeath(player); // real death flow: revive at the safe haven
      return { outcome: 'death', lines: [] };
    }
  }
  throw new Error(`${tag}: the fight never ended`);
}

Deno.test('m5_arms: the taught Iron Chunk route works for a real level-6 hero (#73)', () => {
  for (const cid of CLASS_IDS) {
    const rng = seeded(6100 + CLASS_IDS.indexOf(cid) * 97);
    const player = createPlayer(1, 'Test', cid);
    player.tutorial = 'done';
    while (player.level < 6) grantXp(player, xpForNextLevel(player.level) - player.xp);
    assertEquals(player.level, 6, `${cid}: real level-6 hero`);
    assertEquals(countOf(player, 'm_iron_chunk'), 0, `${cid}: zero chunks at the start`);

    // Settle the authored prerequisite honestly, then let Bram offer the
    // quest at the hero's level (6): the route under test opens here.
    player.quests['m4_floors'] = { status: 'done', counts: [] };
    syncAvailability(player);
    goto(player, 'emberdawn');
    onStoryEvent(player, 'heard_bram_reading');
    assert(acceptQuest(player, 'm5_arms', 'npc_bram').ok, `${cid}: accept m5_arms at Bram`);

    // The taught route: earn two chunks in one descent, including its
    // discovery cache. Defeat starts the next attempt at floor one.
    const dungeon = dungeonOf(zoneDef('whisperwood')!)!;
    let cacheText = '';
    let wins = 0;
    let tries = 0;
    while (countOf(player, 'm_iron_chunk') < 2 && tries++ < 12) {
      goto(player, 'whisperwood'); // dive from INSIDE the zone (origin.zoneId must map to the dungeon)
      const res = diveDungeon(player, dungeon, rng);
      assert(res.ok, `${cid}: normal floor dive`);
      if (!res.battle) {
        cacheText += res.lines.join(' ') + '\n';
        continue;
      }
      assert(
        res.ok && res.battle && res.battle.origin.kind === 'dungeon' &&
          !res.battle.origin.boss,
        `${cid}: normal floor dive`,
      );
      const fightResult = fightToConclusion(
        player,
        res.battle!,
        rng,
        `${cid} floor fight ${tries}`,
      );
      cacheText += fightResult.lines.join(' ') + '\n';
      if (fightResult.outcome === 'win') wins++;
    }
    assert(wins >= 1, `${cid}: materials earned through normal floor victories`);
    assert(
      countOf(player, 'm_iron_chunk') >= 2,
      `${cid}: the Hollow yielded both chunks (guaranteed caches + Mycelid iron)`,
    );
    assert(
      (cacheText.match(/Iron Chunk/g)?.length ?? 0) >= 2,
      `${cid}: the floor caches fired (${cacheText.trim()})`,
    );
    assert(player.level < 7, `${cid}: the materials required NO leveling past 6`);

    // Turn in at Bram, on-site (#64) — travel to the finisher first.
    assert(abandonDungeon(player).ok, `${cid}: leave the descent before visiting Bram`);
    const goldBefore = player.gold;
    goto(player, 'emberdawn');
    onStoryEvent(player, 'heard_bram_reading');
    assert(turnInQuest(player, 'm5_arms', 'npc_bram').ok, `${cid}: turn in Steel for the Descent`);
    assertEquals(player.quests['m5_arms']?.status, 'done', `${cid}: quest done`);
    assert(player.gold >= goldBefore + 250, `${cid}: Bram pays the promised coin`);

    // The intended readiness point: level 7 through the chapter's own zone,
    // then Bram's tier-2 rack (tier-2 gear is legal at exactly level 7).
    let fights = 0;
    while (player.level < 7 && fights < 30) {
      goto(player, 'whisperwood');
      const out = explore(player, rng, 0);
      if (out.kind !== 'battle') continue;
      fights++;
      fightToConclusion(player, out.battle!, rng, `${cid} chapter fight ${fights}`);
    }
    assert(player.level >= 7, `${cid}: reached the readiness level (${fights} chapter fights)`);
    assert(fights <= 30, `${cid}: the readiness gap stays modest (${fights})`);
    // Tier-2 steel is legal at exactly level 7 (the catalog's tier law).
    assertEquals(itemDef('w_warrior_2')!.level, 7, `${cid}: tier-2 gear opens at 7`);

    goto(player, 'emberdawn');
    const stock = resolveStock(player).map((offering) => offering.itemId);
    const steel = stock.find((id) =>
      itemDef(id)?.kind === 'weapon' && (itemDef(id)?.tier ?? 0) >= 2 &&
      isEquippable(id, player.classId, player.level).ok
    );
    assert(steel, `${cid}: a tier-2 weapon is on the rack (${stock.join(', ')})`);
    assert(buy(player, steel!).ok, `${cid}: buy the tier-2 weapon`);
    removeItem(player, steel!, 1);
    player.equipment.weapon = steel!;
    clampPools(player);
    assert((itemDef(player.equipment.weapon!)?.tier ?? 0) >= 2, `${cid}: wearing tier-2 steel`);

    // Prepare a fresh full descent at the readiness point: the story gate is active.
    syncAvailability(player);
    onStoryEvent(player, 'heard_bram_reading');
    assert(acceptQuest(player, 'm3_roots', 'npc_bram').ok, `${cid}: accept Root of the Rot`);
    goto(player, 'whisperwood');
    const boss = diveDungeon(player, dungeon, rng);
    assert(boss.ok && boss.battle, `${cid}: the descent opens`);
    assert(
      boss.battle!.origin.kind === 'dungeon' && boss.battle!.origin.floor === 1 &&
        !boss.battle!.origin.boss,
      `${cid}: returning to town requires restarting from floor one`,
    );
    assertEquals(player.dungeonRun?.nextFloor, 1);
  }
});
