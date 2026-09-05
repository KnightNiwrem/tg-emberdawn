/** m5_arms material-path regression (#73): the quest teaches "Mycelids
 * carry good iron in their husks — bring me two chunks". A real level-6
 * hero with zero chunks must earn both Iron Chunks through LEGAL
 * dungeon-floor victories alone — no unrelated level grinding, no
 * resetting dungeon progress — then turn in, gear up with tier-2 steel,
 * and face Aranya at the intended readiness point. */

import { assert, assertEquals } from '@std/assert';
import { applyDeath, clampPools, createPlayer, grantXp, statsOf } from '../src/engine/character.ts';
import { xpForNextLevel } from '../src/engine/classes.ts';
import { performAction } from '../src/engine/combat.ts';
import { countOf, removeItem } from '../src/engine/inventory.ts';
import { acceptQuest, onStoryEvent, syncAvailability, turnInQuest } from '../src/engine/quests.ts';
import { buy, resolveStock } from '../src/engine/shops.ts';
import {
  diveDungeon,
  dungeonOf,
  explore,
  nextDiveIsBoss,
  resolveVictory,
} from '../src/engine/world.ts';
import type { BattleState, PlayerState } from '../src/engine/types.ts';
import { CLASS_IDS } from '../src/engine/types.ts';
import { isEquippable, item as itemDef } from '../src/content/items.ts';
import { isDamageSkill, skill as skillDef, skillMaxDamagePower } from '../src/content/skills.ts';
import type { SkillDef } from '../src/content/types.ts';
import { zone as zoneDef } from '../src/content/zones.ts';
import { seeded, travelDirect } from './helpers.ts';

function goto(p: PlayerState, zoneId: string): void {
  if (p.currentZone !== zoneId) travelDirect(p, zoneId);
}

/** A minimal competent fighter: strongest castable offensive skill, heals
 * when it matters (skill first, potion as backup), basics otherwise. */
function fightToConclusion(
  p: PlayerState,
  b: BattleState,
  rng: () => number,
  tag: string,
): { outcome: 'win' | 'death'; lines: string[] } {
  let rounds = 0;
  let lastSkill = '';
  while (b.phase === 'active' && rounds++ < 100) {
    const maxHp = statsOf(p).maxHp;
    const castable = p.skills
      .map((id) => skillDef(id))
      .filter((s): s is SkillDef => !!s && s.id !== lastSkill && p.mp >= s.mpCost);
    const heal = castable.find((s) => s.type === 'heal');
    const offensive = castable
      .filter(isDamageSkill)
      .sort((a, b2) => skillMaxDamagePower(b2) - skillMaxDamagePower(a))[0];
    if (p.hp < maxHp * 0.5 && (heal || countOf(p, 'c_minor_potion') > 0)) {
      if (heal) {
        lastSkill = heal.id;
        performAction(p, b, { kind: 'skill', skillId: heal.id }, rng);
      } else {
        performAction(p, b, { kind: 'item', itemId: 'c_minor_potion' }, rng);
      }
    } else if (offensive) {
      lastSkill = offensive.id;
      performAction(p, b, { kind: 'skill', skillId: offensive.id }, rng);
    } else {
      performAction(p, b, { kind: 'attack' }, rng);
    }
    if (b.enemy.hp <= 0) return { outcome: 'win', lines: resolveVictory(p, b, rng) };
    if (p.hp <= 0) {
      applyDeath(p); // real death flow: revive at the safe haven
      return { outcome: 'death', lines: [] };
    }
  }
  throw new Error(`${tag}: the fight never ended`);
}

Deno.test('m5_arms: the taught Iron Chunk route works for a real level-6 hero (#73)', () => {
  for (const cid of CLASS_IDS) {
    const rng = seeded(6100 + CLASS_IDS.indexOf(cid) * 97);
    const p = createPlayer(1, 'Test', cid);
    p.tutorial = 'done';
    while (p.level < 6) grantXp(p, xpForNextLevel(p.level) - p.xp);
    assertEquals(p.level, 6, `${cid}: real level-6 hero`);
    assertEquals(countOf(p, 'm_iron_chunk'), 0, `${cid}: zero chunks at the start`);

    // Settle the authored prerequisite honestly, then let Bram offer the
    // quest at the hero's level (6): the route under test opens here.
    p.quests['m4_floors'] = { status: 'done', counts: [] };
    syncAvailability(p);
    goto(p, 'emberdawn');
    onStoryEvent(p, 'heard_bram_reading');
    assert(acceptQuest(p, 'm5_arms', 'npc_bram').ok, `${cid}: accept m5_arms at Bram`);

    // The taught route: dive the Rootbound Hollow's NORMAL floors. Each
    // victory advances the pointer once — no resets, no rerolls. Losses
    // simply leave the floor pending for an honest retry.
    const d = dungeonOf(zoneDef('whisperwood')!)!;
    let cacheText = '';
    let wins = 0;
    let tries = 0;
    while (!nextDiveIsBoss(p, d) && tries++ < 12) {
      goto(p, 'whisperwood'); // dive from INSIDE the zone (origin.zoneId must map to the dungeon)
      const res = diveDungeon(p, d, rng);
      assert(
        res.ok && res.battle && res.battle.origin.kind === 'dungeon' &&
          !res.battle.origin.boss,
        `${cid}: normal floor dive`,
      );
      const r = fightToConclusion(p, res.battle!, rng, `${cid} floor fight ${tries}`);
      cacheText += r.lines.join(' ') + '\n';
      if (r.outcome === 'win') wins++;
    }
    assertEquals(wins, 3, `${cid}: three normal floors cleared`);
    assert(nextDiveIsBoss(p, d), `${cid}: pointer reached the boss floor honestly`);
    assert(
      countOf(p, 'm_iron_chunk') >= 2,
      `${cid}: the Hollow yielded both chunks (guaranteed caches + Mycelid iron)`,
    );
    assert(
      (cacheText.match(/Iron Chunk/g)?.length ?? 0) >= 2,
      `${cid}: the floor caches fired (${cacheText.trim()})`,
    );
    assert(p.level < 7, `${cid}: the materials required NO leveling past 6`);

    // Turn in at Bram, on-site (#64) — travel to the finisher first.
    const goldBefore = p.gold;
    goto(p, 'emberdawn');
    onStoryEvent(p, 'heard_bram_reading');
    assert(turnInQuest(p, 'm5_arms', 'npc_bram').ok, `${cid}: turn in Steel for the Descent`);
    assertEquals(p.quests['m5_arms']?.status, 'done', `${cid}: quest done`);
    assert(p.gold >= goldBefore + 250, `${cid}: Bram pays the promised coin`);

    // The intended readiness point: level 7 through the chapter's own zone,
    // then Bram's tier-2 rack (tier-2 gear is legal at exactly level 7).
    let fights = 0;
    while (p.level < 7 && fights < 30) {
      goto(p, 'whisperwood');
      const out = explore(p, rng, 0);
      if (out.kind !== 'battle') continue;
      fights++;
      fightToConclusion(p, out.battle!, rng, `${cid} chapter fight ${fights}`);
    }
    assert(p.level >= 7, `${cid}: reached the readiness level (${fights} chapter fights)`);
    assert(fights <= 30, `${cid}: the readiness gap stays modest (${fights})`);
    // Tier-2 steel is legal at exactly level 7 (the catalog's tier law).
    assertEquals(itemDef('w_warrior_2')!.level, 7, `${cid}: tier-2 gear opens at 7`);

    goto(p, 'emberdawn');
    const stock = resolveStock(p).map((o) => o.itemId);
    const steel = stock.find((id) =>
      itemDef(id)?.kind === 'weapon' && (itemDef(id)?.tier ?? 0) >= 2 &&
      isEquippable(id, p.classId, p.level).ok
    );
    assert(steel, `${cid}: a tier-2 weapon is on the rack (${stock.join(', ')})`);
    assert(buy(p, steel!).ok, `${cid}: buy the tier-2 weapon`);
    removeItem(p, steel!, 1);
    p.equipment.weapon = steel!;
    clampPools(p);
    assert((itemDef(p.equipment.weapon!)?.tier ?? 0) >= 2, `${cid}: wearing tier-2 steel`);

    // Meet Aranya at the readiness point: story gate active, boss floor open.
    syncAvailability(p);
    onStoryEvent(p, 'heard_bram_reading');
    assert(acceptQuest(p, 'm3_roots', 'npc_bram').ok, `${cid}: accept Root of the Rot`);
    goto(p, 'whisperwood');
    const boss = diveDungeon(p, d, rng);
    assert(boss.ok && boss.battle, `${cid}: the descent opens`);
    assert(
      boss.battle!.origin.kind === 'dungeon' && boss.battle!.origin.boss === true,
      `${cid}: the boss floor is the boss`,
    );
    assert(boss.lines.join(' ').includes('Aranya'), `${cid}: Aranya awaits`);
  }
});
