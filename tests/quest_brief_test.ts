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
  for (const questDef of QUESTS) {
    for (const stage of ['offer', 'turnIn'] as const) {
      const dialogueDef = dialogue(
        stage === 'offer' ? questDef.offerDialogue : questDef.turnInDialogue,
      )!;
      const node = dialogueDef.nodes.find((node) => node.kind === 'choice')!;
      const player = createPlayer(1900, 'Reader', 'mage');
      player.currentZone = zoneOfNpc(dialogueDef.npcId)!.id;
      player.quests[questDef.id] = {
        status: stage === 'offer' ? 'available' : 'turnIn',
        counts: questDef.objectives.map((objective) => objective.count ?? 1),
      };
      player.scene = { view: 'dialogue', arg: dialogueDef.id, arg2: node.id };
      for (const objective of questDef.objectives) {
        if (objective.kind === 'collect') addItem(player, objective.target, objective.count ?? 1);
      }
      const before = JSON.stringify(player);
      const view = JSON.stringify(renderDialogue(player));
      assert(view.includes(questDef.name), questDef.id);
      assert(view.includes(questDef.summary), questDef.id);
      const fin = questFinisher(questDef.id)!;
      assert(view.includes(`Finish with ${fin.npc.name} — ${fin.zone.name}`), questDef.id);
      assert(view.includes(xpRewardLabel(player.level, questDef.rewards.xp)), questDef.id);
      assert(view.includes(`${questDef.rewards.gold} gold`), questDef.id);
      for (const objective of questDef.objectives) {
        assert(
          objectiveSource(questDef, objective),
          `${questDef.id}: usable source for ${objective.target}`,
        );
        if (objective.kind === 'collect' || objective.kind === 'kill') {
          assert(view.includes(`×${objective.count ?? 1}`), questDef.id);
        }
        if (objective.kind === 'collect') {
          assert(view.includes(`${itemName(objective.target)} ×${objective.count ?? 1}`));
          assert(view.includes(stage === 'offer' ? 'At completion, hand over:' : 'Hand over now:'));
        }
      }
      assertEquals(JSON.stringify(player), before, 'reading a decision never mutates progress');
    }
  }
});

Deno.test('quest brief: iron directions lead to early caches and drones, not the later Aranya reward', () => {
  const player = createPlayer(1901, 'Reader', 'rogue');
  player.quests.m5_arms = { status: 'available', counts: [] };
  player.scene = { view: 'dialogue', arg: 'dlg_m5_arms_offer', arg2: 'oa' };
  const view = JSON.stringify(renderDialogue(player));
  assert(view.includes('Iron Chunk ×2'));
  assert(view.includes('First-visit caches in Rootbound Hollow — Whisperwood'));
  assert(view.includes('Mycelid Drone'));
  assert(view.includes('Mine in Emberdawn Outskirts; bring Pickaxe'));
  assert(!view.includes('Reward from Root of the Rot'));
  assert(view.includes('At completion, hand over: Iron Chunk ×2'));
  const journal = JSON.stringify(renderQuestDetail(player, 'm5_arms'));
  assert(journal.includes('Iron Chunk ×2') && journal.includes('Mycelid Drone'));
  player.quests.m5_arms.status = 'active';
  player.scene = { view: 'npc', arg: 'npc_bram', arg2: 'q:m5_arms' };
  addItem(player, 'm_iron_chunk', 1);
  const reminder = JSON.stringify(renderNpcTopics(player));
  assert(reminder.includes('Iron Chunk ×2 — 1/2'));
  assert(reminder.includes('Blacksmith Bram — Emberdawn Village'));
});

Deno.test('quest brief: delivery explains the reading and shows the exact letter consumed', () => {
  const player = createPlayer(1902, 'Reader', 'cleric');
  player.quests.m2_letter = { status: 'active', counts: [1, 0] };
  addItem(player, 'q_sealed_letter', 1);
  player.scene = { view: 'dialogue', arg: 'dlg_m2_letter_talk', arg2: 'c1' };
  dialogueAction(player, { v: 'dlg', a: 'nx', arg: 'c2' });
  assertEquals(countOf(player, 'q_sealed_letter'), 1, 'reading retains the letter');
  assertEquals(player.quests.m2_letter.status, 'turnIn');
  player.scene = { view: 'dialogue', arg: 'dlg_m2_letter_turnin', arg2: 'ta' };
  const view = JSON.stringify(renderDialogue(player));
  assert(view.includes('Hear Bram read the letter — 1/1'));
  assert(view.includes('Hand over now: Sealed Letter ×1'));
  assert(applyDialogueChoice(player, { choiceId: 'handover', now: 1 }).ok);
  assertEquals(countOf(player, 'q_sealed_letter'), 0);
});

Deno.test('quest brief: permanent route previews disclose jobs and only the selected confirmation', () => {
  const player = ferryHero(1903);
  player.scene = { view: 'dialogue', arg: 'dlg_ferry_promise', arg2: 'n3' };
  const choices = JSON.stringify(renderDialogue(player));
  assert(choices.includes('Defeat Marsh Wisp ×4'));
  assert(choices.includes('Defeat Marsh Leech ×4'));
  assert(!choices.includes('Your toxin work earns'), 'hidden vouch response stays undisclosed');
  dialogueAction(player, { v: 'dlg', a: 'ch', arg: 'promise' });
  const before = JSON.stringify(player);
  const staged = JSON.stringify(renderDialogue(player));
  assert(staged.includes('Defeat Marsh Wisp ×4'));
  assert(
    !staged.includes('Defeat Marsh Leech ×4'),
    'the other job is not offered on this confirmation',
  );
  assert(staged.includes('Permanently closes: The Water Intake'));
  assertEquals(JSON.stringify(player), before);
});

Deno.test('quest brief: keeping the light grants one real keepsake and none of the normal reward', () => {
  const player = ferryHero(1904);
  player.scene = {
    view: 'dialogue',
    arg: 'dlg_ferry_promise',
    arg2: 'n3',
    arg3: 'confirm:promise',
  };
  assert(applyDialogueChoice(player, { choiceId: 'promise', now: 1 }).ok);
  for (let i = 0; i < 4; i++) onKill(player, 'e_wisp');
  player.scene = {
    view: 'dialogue',
    arg: 'dlg_sq_shrine_pact_turnin',
    arg2: 'ta',
    arg3: 'confirm:keep',
  };
  const view = JSON.stringify(renderDialogue(player));
  assert(view.includes('without its normal rewards'));
  assert(view.includes('Receive: Wisp Lantern ×1'));
  assert(
    !view.includes('🎁 Rewards now'),
    'the normal reward is not advertised for keeping the lantern',
  );
  const before = { gold: player.gold, xp: player.xp, stats: item('q_wisp_lantern')!.stats };
  assert(applyDialogueChoice(player, { choiceId: 'keep', now: 2 }).ok);
  assertEquals(countOf(player, 'q_wisp_lantern'), 1);
  assertEquals(player.gold, before.gold);
  assertEquals(player.xp, before.xp);
  assertEquals(before.stats, undefined, 'a keepsake is not equipment');
  assert(applyDialogueChoice(player, { choiceId: 'keep', now: 3 }).ok);
  assertEquals(countOf(player, 'q_wisp_lantern'), 1, 'receipt suppresses duplicate keepsakes');
  assertResolvablePersistedIds(JSON.parse(JSON.stringify(player)));
});

Deno.test('quest brief: Pell receives the locket that actually dropped from a spider', () => {
  const player = createPlayer(1905, 'Reader', 'warrior');
  player.level = 7;
  arriveAt(player, 'whisperwood');
  syncAvailability(player);
  assert(acceptQuest(player, 'sq_locket', 'npc_pell').ok);
  const battle = startBattle('e_spider', { kind: 'explore', zoneId: 'whisperwood' }, {
    player,
    rng: () => 0.5,
  })!.battle;
  resolveVictory(player, battle, () => 0);
  assertEquals(countOf(player, 'q_pells_locket'), 1);
  assertEquals(player.quests.sq_locket.status, 'turnIn');
  assert(!questDropAllowed(player, 'q_pells_locket'), 'no duplicate while held');
  player.scene = { view: 'dialogue', arg: 'dlg_sq_locket_turnin', arg2: 'ta' };
  assert(JSON.stringify(renderDialogue(player)).includes("Hand over now: Pell's Locket ×1"));
  assert(applyDialogueChoice(player, { choiceId: 'handover', now: 1 }).ok);
  assertEquals(countOf(player, 'q_pells_locket'), 0);
  assert(!questDropAllowed(player, 'q_pells_locket'), 'no duplicate after delivery');
  assertResolvablePersistedIds(player);
});

Deno.test('quest brief: boss locations, conversation actions and capped rewards are explicit', () => {
  const player = createPlayer(1906, 'Reader', 'mage');
  player.level = 45;
  player.currentZone = 'sunspire';
  player.scene = { view: 'dialogue', arg: 'dlg_m12_chronolich_offer', arg2: 'oa' };
  const boss = JSON.stringify(renderDialogue(player));
  assert(boss.includes('The Chronolich ×1'));
  assert(boss.includes('Vault of Hours — Sunspire Ruins (boss; recommended Lv 21)'));
  assert(boss.includes(xpRewardLabel(45, quest('m12_chronolich')!.rewards.xp)));
  assert(!boss.includes('✨ +3600 XP'), 'the reward shows conversion instead of an XP grant');
  player.currentZone = 'hollowmere';
  player.scene = { view: 'dialogue', arg: 'dlg_m8_passage_offer', arg2: 'oa' };
  assert(
    JSON.stringify(renderDialogue(player)).includes('Recorded when you accept this conversation.'),
  );
});

Deno.test('narrative: recovered regions survive reload and agree between arrival and the hub', () => {
  const player = createPlayer(1907, 'Reader', 'warrior');
  player.tutorial = 'done';
  const zoneDef = zone('emberdawn')!;
  assertEquals(zoneDescription(player, zoneDef), zoneDef.desc);
  player.flags.chapter1Done = true;
  const hearth = zoneDescription(player, zoneDef);
  assert(hearth.includes('hearth burns steadily'));
  player.flags.crownRestored = true;
  const dawn = zoneDescription(player, zoneDef);
  assert(dawn.includes('Sunlight reaches'));
  assert(dawn !== hearth, 'later recovery takes precedence');
  const reloaded = JSON.parse(JSON.stringify(player));
  assert(arriveAt(reloaded, zoneDef.id).includes(dawn));
  assert(JSON.stringify(renderZone(reloaded)).includes(dawn));
  assertResolvablePersistedIds(reloaded);
  for (const zone of ZONES) {
    for (const aftermath of zone.aftermath ?? []) {
      const refs = conditionRefs(aftermath.when);
      assert(refs.quests.every((id) => quest(id)));
      for (const flagId of ('flag' in aftermath.when ? [aftermath.when.flag.id] : [])) {
        assert(
          QUESTS.some((questDef) => questDef.rewards.flags?.includes(flagId)) ||
            ZONES.some((zoneDef) => zoneDef.dungeon?.firstClear?.flags?.includes(flagId)),
          `${zone.id}: recovery flag ${flagId} has a real producer`,
        );
      }
    }
  }
});

Deno.test('campaign checkpoint: all older development versions are refused without a rewrite', () => {
  assertEquals(CURRENT_STATE_VERSION, 15);
  const player = createPlayer(1910, 'Reader', 'rogue');
  assertSupportedSaveVersion(player);
  for (let stateVersion = 0; stateVersion < CURRENT_STATE_VERSION; stateVersion++) {
    player.stateVersion = stateVersion;
    const before = JSON.stringify(player);
    assertThrows(() => assertSupportedSaveVersion(player), SaveTooOldError);
    assertEquals(JSON.stringify(player), before);
  }
});

Deno.test('dialogue contract: complete choice screens stay compact even with all shrine responses', () => {
  // A corpus check protects the expanded decision surface from unbounded prose.
  // Count visible text, not JSON entity syntax or callback bytes.
  function visible(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(visible).join('');
    if (!value || typeof value !== 'object') return '';
    return Object.entries(value).filter(([key]) =>
      ['text', 'blocks', 'buttons', 'items', 'summary'].includes(key)
    ).map((
      [, value],
    ) => visible(value)).join('');
  }
  for (const dialogueDef of DIALOGUES) {
    for (const node of dialogueDef.nodes) {
      if (node.kind !== 'choice') continue;
      const player = ferryHero(1911);
      player.quests.m6_toxin = { status: 'done', counts: [4] };
      player.currentZone = zoneOfNpc(dialogueDef.npcId)!.id;
      player.scene = { view: 'dialogue', arg: dialogueDef.id, arg2: node.id };
      assert(
        visible(renderDialogue(player)).length < 4000,
        `${dialogueDef.id}:${node.id} is too long to scan`,
      );
    }
  }
});
