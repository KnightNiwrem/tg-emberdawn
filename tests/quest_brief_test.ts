/** Player-visible contracts for the campaign rebase (#189–#191). */
import { assert, assertEquals, assertThrows } from '@std/assert';
import { dialogue, DIALOGUES } from '../src/content/dialogues.ts';
import { item, itemName } from '../src/content/items.ts';
import { quest, questFinisher, QUESTS, zoneOfNpc } from '../src/content/quests.ts';
import { zone, ZONES } from '../src/content/zones.ts';
import {
  assertSupportedSaveVersion,
  createPlayer,
  CURRENT_STATE_VERSION,
  SaveTooOldError,
  xpRewardLabel,
} from '../src/engine/character.ts';
import { startBattle } from '../src/engine/combat.ts';
import { conditionRefs } from '../src/engine/conditions.ts';
import { addItem, countOf } from '../src/engine/inventory.ts';
import { acceptQuest, onKill, questDropAllowed, syncAvailability } from '../src/engine/quests.ts';
import { applyDialogueChoice } from '../src/engine/story.ts';
import { assertResolvablePersistedIds } from '../src/engine/validate.ts';
import { arriveAt, resolveVictory, zoneDescription } from '../src/engine/world.ts';
import { dialogueAction } from '../src/handlers/hub.ts';
import { objectiveSource } from '../src/render/quest_brief.ts';
import {
  renderDialogue,
  renderNpcTopics,
  renderQuestDetail,
  renderZone,
} from '../src/render/views.ts';
import { ferryHero } from './helpers_story.ts';

Deno.test('quest brief: every committing offer and report shows the quest, work, contact and rewards', () => {
  for (const q of QUESTS) {
    for (const stage of ['offer', 'turnIn'] as const) {
      const d = dialogue(stage === 'offer' ? q.offerDialogue : q.turnInDialogue)!;
      const n = d.nodes.find((n) => n.kind === 'choice')!;
      const p = createPlayer(1900, 'Reader', 'mage');
      p.currentZone = zoneOfNpc(d.npcId)!.id;
      p.quests[q.id] = {
        status: stage === 'offer' ? 'available' : 'turnIn',
        counts: q.objectives.map((o) => o.count ?? 1),
      };
      p.scene = { view: 'dialogue', arg: d.id, arg2: n.id };
      for (const o of q.objectives) if (o.kind === 'collect') addItem(p, o.target, o.count ?? 1);
      const before = JSON.stringify(p);
      const view = JSON.stringify(renderDialogue(p));
      assert(view.includes(q.name), q.id);
      assert(view.includes(q.summary), q.id);
      const fin = questFinisher(q.id)!;
      assert(view.includes(`Finish with ${fin.npc.name} — ${fin.zone.name}`), q.id);
      assert(view.includes(xpRewardLabel(p.level, q.rewards.xp)), q.id);
      assert(view.includes(`${q.rewards.gold} gold`), q.id);
      for (const o of q.objectives) {
        assert(objectiveSource(q, o), `${q.id}: usable source for ${o.target}`);
        if (o.kind === 'collect' || o.kind === 'kill') {
          assert(view.includes(`×${o.count ?? 1}`), q.id);
        }
        if (o.kind === 'collect') {
          assert(view.includes(`${itemName(o.target)} ×${o.count ?? 1}`));
          assert(view.includes('These leave your bag.'));
        }
      }
      assertEquals(JSON.stringify(p), before, 'reading a decision never mutates progress');
    }
  }
});

Deno.test('quest brief: iron directions lead to early caches and drones, not the later Aranya reward', () => {
  const p = createPlayer(1901, 'Reader', 'rogue');
  p.quests.m5_arms = { status: 'available', counts: [] };
  p.scene = { view: 'dialogue', arg: 'dlg_m5_arms_offer', arg2: 'oa' };
  const view = JSON.stringify(renderDialogue(p));
  assert(view.includes('Iron Chunk ×2'));
  assert(view.includes('First-visit caches in Rootbound Hollow — Whisperwood'));
  assert(view.includes('Mycelid Drone'));
  assert(!view.includes('Reward from Root of the Rot'));
  assert(view.includes('At completion, hand over: Iron Chunk ×2'));
  const journal = JSON.stringify(renderQuestDetail(p, 'm5_arms'));
  assert(journal.includes('Iron Chunk ×2') && journal.includes('Mycelid Drone'));
  p.quests.m5_arms.status = 'active';
  p.scene = { view: 'npc', arg: 'npc_bram', arg2: 'q:m5_arms' };
  addItem(p, 'm_iron_chunk', 1);
  const reminder = JSON.stringify(renderNpcTopics(p));
  assert(reminder.includes('Iron Chunk ×2 — 1/2'));
  assert(reminder.includes('Blacksmith Bram — Emberdawn Village'));
});

Deno.test('quest brief: delivery explains the reading and shows the exact letter consumed', () => {
  const p = createPlayer(1902, 'Reader', 'cleric');
  p.quests.m2_letter = { status: 'active', counts: [1, 0] };
  addItem(p, 'q_sealed_letter', 1);
  p.scene = { view: 'dialogue', arg: 'dlg_m2_letter_talk', arg2: 'c1' };
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'c2' });
  assertEquals(countOf(p, 'q_sealed_letter'), 1, 'reading retains the letter');
  assertEquals(p.quests.m2_letter.status, 'turnIn');
  p.scene = { view: 'dialogue', arg: 'dlg_m2_letter_turnin', arg2: 'ta' };
  const view = JSON.stringify(renderDialogue(p));
  assert(view.includes('Hear Bram read the letter — 1/1'));
  assert(view.includes('Hand over now: Sealed Letter ×1'));
  assert(applyDialogueChoice(p, { choiceId: 'handover', now: 1 }).ok);
  assertEquals(countOf(p, 'q_sealed_letter'), 0);
});

Deno.test('quest brief: permanent route previews disclose jobs and only the selected confirmation', () => {
  const p = ferryHero(1903);
  p.scene = { view: 'dialogue', arg: 'dlg_ferry_promise', arg2: 'n3' };
  const choices = JSON.stringify(renderDialogue(p));
  assert(choices.includes('Defeat Marsh Wisp ×4'));
  assert(choices.includes('Defeat Marsh Leech ×4'));
  assert(!choices.includes('Your toxin work earns'), 'hidden vouch response stays undisclosed');
  dialogueAction(p, { v: 'dlg', a: 'ch', arg: 'promise' });
  const before = JSON.stringify(p);
  const staged = JSON.stringify(renderDialogue(p));
  assert(staged.includes('Defeat Marsh Wisp ×4'));
  assert(
    !staged.includes('Defeat Marsh Leech ×4'),
    'the other job is not offered on this confirmation',
  );
  assert(staged.includes('Permanently closes: The Water Intake'));
  assertEquals(JSON.stringify(p), before);
});

Deno.test('quest brief: keeping the light grants one real keepsake and none of the normal reward', () => {
  const p = ferryHero(1904);
  p.scene = { view: 'dialogue', arg: 'dlg_ferry_promise', arg2: 'n3', arg3: 'confirm:promise' };
  assert(applyDialogueChoice(p, { choiceId: 'promise', now: 1 }).ok);
  for (let i = 0; i < 4; i++) onKill(p, 'e_wisp');
  p.scene = {
    view: 'dialogue',
    arg: 'dlg_sq_shrine_pact_turnin',
    arg2: 'ta',
    arg3: 'confirm:keep',
  };
  const view = JSON.stringify(renderDialogue(p));
  assert(view.includes('without its normal rewards'));
  assert(view.includes('Receive: Wisp Lantern ×1'));
  assert(
    !view.includes('🎁 Rewards:'),
    'the normal reward is not advertised for keeping the lantern',
  );
  const before = { gold: p.gold, xp: p.xp, stats: item('q_wisp_lantern')!.stats };
  assert(applyDialogueChoice(p, { choiceId: 'keep', now: 2 }).ok);
  assertEquals(countOf(p, 'q_wisp_lantern'), 1);
  assertEquals(p.gold, before.gold);
  assertEquals(p.xp, before.xp);
  assertEquals(before.stats, undefined, 'a keepsake is not equipment');
  assert(applyDialogueChoice(p, { choiceId: 'keep', now: 3 }).ok);
  assertEquals(countOf(p, 'q_wisp_lantern'), 1, 'receipt suppresses duplicate keepsakes');
  assertResolvablePersistedIds(JSON.parse(JSON.stringify(p)));
});

Deno.test('quest brief: Pell receives the locket that actually dropped from a spider', () => {
  const p = createPlayer(1905, 'Reader', 'warrior');
  p.level = 7;
  arriveAt(p, 'whisperwood');
  syncAvailability(p);
  assert(acceptQuest(p, 'sq_locket', 'npc_pell').ok);
  const b = startBattle('e_spider', { kind: 'explore', zoneId: 'whisperwood' }, {
    player: p,
    rng: () => 0.5,
  })!.battle;
  resolveVictory(p, b, () => 0);
  assertEquals(countOf(p, 'q_pells_locket'), 1);
  assertEquals(p.quests.sq_locket.status, 'turnIn');
  assert(!questDropAllowed(p, 'q_pells_locket'), 'no duplicate while held');
  p.scene = { view: 'dialogue', arg: 'dlg_sq_locket_turnin', arg2: 'ta' };
  assert(JSON.stringify(renderDialogue(p)).includes("Hand over now: Pell's Locket ×1"));
  assert(applyDialogueChoice(p, { choiceId: 'handover', now: 1 }).ok);
  assertEquals(countOf(p, 'q_pells_locket'), 0);
  assert(!questDropAllowed(p, 'q_pells_locket'), 'no duplicate after delivery');
  assertResolvablePersistedIds(p);
});

Deno.test('quest brief: boss locations, conversation actions and capped rewards are explicit', () => {
  const p = createPlayer(1906, 'Reader', 'mage');
  p.level = 45;
  p.currentZone = 'sunspire';
  p.scene = { view: 'dialogue', arg: 'dlg_m12_chronolich_offer', arg2: 'oa' };
  const boss = JSON.stringify(renderDialogue(p));
  assert(boss.includes('The Chronolich ×1'));
  assert(boss.includes('Vault of Hours — Sunspire Ruins (boss; recommended Lv 21)'));
  assert(boss.includes(xpRewardLabel(45, quest('m12_chronolich')!.rewards.xp)));
  assert(!boss.includes('✨ +3600 XP'), 'the reward shows conversion instead of an XP grant');
  p.currentZone = 'hollowmere';
  p.scene = { view: 'dialogue', arg: 'dlg_m8_passage_offer', arg2: 'oa' };
  assert(JSON.stringify(renderDialogue(p)).includes('Recorded when you accept this conversation.'));
});

Deno.test('narrative: recovered regions survive reload and agree between arrival and the hub', () => {
  const p = createPlayer(1907, 'Reader', 'warrior');
  p.tutorial = 'done';
  const z = zone('emberdawn')!;
  assertEquals(zoneDescription(p, z), z.desc);
  p.flags.chapter1Done = true;
  const hearth = zoneDescription(p, z);
  assert(hearth.includes('hearth burns steadily'));
  p.flags.crownRestored = true;
  const dawn = zoneDescription(p, z);
  assert(dawn.includes('Sunlight reaches'));
  assert(dawn !== hearth, 'later recovery takes precedence');
  const reloaded = JSON.parse(JSON.stringify(p));
  assert(arriveAt(reloaded, z.id).includes(dawn));
  assert(JSON.stringify(renderZone(reloaded)).includes(dawn));
  assertResolvablePersistedIds(reloaded);
  for (const zone of ZONES) {
    for (const a of zone.aftermath ?? []) {
      const refs = conditionRefs(a.when);
      assert(refs.quests.every((id) => quest(id)));
      for (const f of ('flag' in a.when ? [a.when.flag.id] : [])) {
        assert(
          QUESTS.some((q) => q.rewards.flags?.includes(f)) ||
            ZONES.some((z) => z.dungeon?.firstClear?.flags?.includes(f)),
          `${zone.id}: recovery flag ${f} has a real producer`,
        );
      }
    }
  }
});

Deno.test('campaign checkpoint: all older development versions are refused without a rewrite', () => {
  assertEquals(CURRENT_STATE_VERSION, 13);
  const p = createPlayer(1910, 'Reader', 'rogue');
  assertSupportedSaveVersion(p);
  for (let v = 0; v < 13; v++) {
    p.stateVersion = v;
    const before = JSON.stringify(p);
    assertThrows(() => assertSupportedSaveVersion(p), SaveTooOldError);
    assertEquals(JSON.stringify(p), before);
  }
});

Deno.test('dialogue contract: complete choice screens stay compact even with all shrine responses', () => {
  // A corpus check protects the expanded decision surface from unbounded prose.
  // Count visible text, not JSON entity syntax or callback bytes.
  function visible(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(visible).join('');
    if (!value || typeof value !== 'object') return '';
    return Object.entries(value).filter(([k]) => ['text', 'blocks', 'buttons'].includes(k)).map((
      [, v],
    ) => visible(v)).join('');
  }
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind !== 'choice') continue;
      const p = ferryHero(1911);
      p.quests.m6_toxin = { status: 'done', counts: [4] };
      p.currentZone = zoneOfNpc(d.npcId)!.id;
      p.scene = { view: 'dialogue', arg: d.id, arg2: n.id };
      assert(visible(renderDialogue(p)).length < 4000, `${d.id}:${n.id} is too long to scan`);
    }
  }
});
