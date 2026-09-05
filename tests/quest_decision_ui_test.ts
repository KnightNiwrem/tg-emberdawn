/** Quest decision hierarchy and informed choices in native Rich Messages (#192). */
import { assert, assertEquals } from '@std/assert';
import type { InputRichBlock } from 'grammy/types';
import { decodeCb } from '../src/codec.ts';
import type { DialogueChoice } from '../src/content/types.ts';
import { dialogue } from '../src/content/dialogues.ts';
import { itemName } from '../src/content/items.ts';
import { quest } from '../src/content/quests.ts';
import { zone } from '../src/content/zones.ts';
import { createPlayer, xpRewardLabel } from '../src/engine/character.ts';
import { dialogueAction } from '../src/handlers/hub.ts';
import { choiceQuestBlocks, objectiveSource, questBriefBlocks } from '../src/render/quest_brief.ts';
import { renderDialogue } from '../src/render/views.ts';
import { ferryHero } from './helpers_story.ts';

/** Text actually visible without expanding details; never callback data or entity syntax. */
function visible(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(visible).join('\n');
  if (!value || typeof value !== 'object') return '';
  if ('type' in value && value.type === 'details') {
    return 'summary' in value ? visible(value.summary) : '';
  }
  return Object.entries(value)
    .filter(([k]) => ['text', 'blocks', 'buttons', 'items'].includes(k))
    .map(([, v]) => visible(v)).join('\n');
}

function rows(blocks: InputRichBlock[]) {
  return blocks.filter((b) => b.type === 'buttons');
}

Deno.test('quest decision UI: first offer highlights work and rewards and pairs Accept with Not now', () => {
  const p = createPlayer(1920, 'Reader', 'mage');
  p.scene = { view: 'dialogue', arg: 'dlg_m1_embers_offer', arg2: 'oa' };
  const before = JSON.stringify(p);
  const blocks = renderDialogue(p).blocks!;
  assertEquals(
    blocks.filter((b) => b.type === 'heading').map((b) => [b.text, b.size]),
    [
      ['🗣️ Elder Maren', 4],
      ['📜 Sparks of Trouble', 3],
      ['🎯 Objectives', 4],
      ['📍 Completion', 4],
      ['🎁 Rewards on completion', 4],
    ],
  );
  const lists = blocks.filter((b) => b.type === 'list');
  assertEquals(lists.length, 2);
  assertEquals(lists[0].items.length, 1);
  assert(visible(lists[0].items[0]).includes('Defeat Ember Rat ×4'));
  assert(visible(lists[0].items[0]).includes('🧭 Emberdawn Outskirts (Explore)'));
  const objective = lists[0].items[0].blocks[0];
  assert(objective.type === 'paragraph' && Array.isArray(objective.text));
  assertEquals(objective.text[0], { type: 'bold', text: 'Defeat Ember Rat ×4' });
  assertEquals(lists[1].items.length, 2, 'currency and item rewards wrap independently');
  const text = visible(blocks);
  for (
    const fact of [
      'Finish with Elder Maren — Emberdawn Village.',
      '✨ +120 XP',
      '80 gold',
      'Sealed Letter ×1',
    ]
  ) assert(text.includes(fact), `${fact} stays expanded`);
  assert(!text.includes(quest('m1_embers')!.summary), 'only repeated narrative is collapsed');
  const context = blocks.filter((b) => b.type === 'details');
  assertEquals(context.length, 1);
  assertEquals(context[0].blocks, [{ type: 'paragraph', text: quest('m1_embers')!.summary }]);
  const [row] = rows(blocks);
  assertEquals(rows(blocks).length, 1);
  assertEquals(row.align, 'left');
  assertEquals(row.buttons.map((b) => b.text), ['🤝 Accept', '✋ Not now']);
  assertEquals(row.buttons.map((b) => b.style), ['primary', undefined]);
  assertEquals(
    row.buttons.map((b) => decodeCb('callback_data' in b ? b.callback_data! : '')),
    [{ v: 'dlg', a: 'ch', arg: 'accept' }, { v: 'dlg', a: 'bk' }],
  );
  assertEquals(blocks.at(-1), row, 'the paired actions follow all decision facts');
  assertEquals(JSON.stringify(p), before);
});

Deno.test('quest decision UI: collection costs, progress, and reward timing stay expanded', () => {
  const p = createPlayer(1921, 'Reader', 'rogue');
  const q = quest('m2_letter')!;
  for (const mode of ['offer', 'progress', 'turnIn'] as const) {
    const blocks = questBriefBlocks(p, q, mode);
    const text = visible(blocks);
    assert(text.includes('Sealed Letter ×1'));
    assert(text.includes('Finish with Blacksmith Bram — Emberdawn Village.'));
    assert(text.includes(mode === 'turnIn' ? 'Hand over now:' : 'At completion, hand over:'));
    assert(text.includes(mode === 'turnIn' ? '🎁 Rewards now' : '🎁 Rewards on completion'));
    if (mode !== 'offer') assert(text.includes('Hear Bram read the letter — 0/1'));
    assert(
      blocks.some((b) =>
        b.type === 'paragraph' && typeof b.text === 'object' && !Array.isArray(b.text) &&
        b.text.type === 'bold' && visible(b).includes('Sealed Letter ×1')
      ),
    );
  }
});

Deno.test('quest decision UI: Six Fewer Rats puts each Explore location on its own line', () => {
  const p = createPlayer(1926, 'Reader', 'mage');
  p.scene = { view: 'dialogue', arg: 'dlg_sq_rats_offer', arg2: 'oa' };
  const blocks = renderDialogue(p).blocks!;
  const objectives = blocks.find((b) => b.type === 'list');
  assert(objectives?.type === 'list');
  assertEquals(objectives.items.length, 1, 'locations are alternatives for one objective');
  const objective = objectives.items[0].blocks[0];
  assert(objective.type === 'paragraph');
  assertEquals(objective.text, [
    { type: 'bold', text: 'Defeat Giant Rat ×6' },
    '\n🧭 Emberdawn Outskirts (Explore)\n🧭 Whisperwood (Explore)',
  ]);
});

Deno.test('quest decision UI: two Explore and three dungeon sources retain all five activity lines', () => {
  const q = quest('sq_rats')!;
  const dungeons = ['whisperwood', 'hollowmere', 'sunspire'].map((id) => zone(id)!.dungeon!);
  const originalEnemies = dungeons.map((d) => d.floors[0].enemies);
  try {
    // Model the requested mixed-source case without changing shipped content.
    for (const d of dungeons) d.floors[0].enemies = [...d.floors[0].enemies, 'e_rat'];
    assertEquals(objectiveSource(q, q.objectives[0]).split('\n'), [
      '🧭 Emberdawn Outskirts (Explore)',
      '🧭 Whisperwood (Explore)',
      '🕸️ Rootbound Hollow — Whisperwood (Dungeon)',
      '🌊 Sunken Shrine — Hollowmere Swamp (Dungeon)',
      '⏳ Vault of Hours — Sunspire Ruins (Dungeon)',
    ]);
  } finally {
    for (const [i, d] of dungeons.entries()) d.floors[0].enemies = originalEnemies[i];
  }
});

Deno.test('quest decision UI: collection directions keep each source activity and boss details together', () => {
  const iron = quest('m5_arms')!;
  assertEquals(objectiveSource(iron, iron.objectives[0]).split('\n'), [
    '🕸️ First-visit caches in Rootbound Hollow — Whisperwood',
    '🕸️ Drops from Mycelid Drone — Rootbound Hollow — Whisperwood (Dungeon) (may take several fights)',
  ]);
  const boss = quest('m12_chronolich')!;
  const source = objectiveSource(boss, boss.objectives[0]);
  assert(source.startsWith('⏳ Vault of Hours — Sunspire Ruins (boss; recommended Lv 21)'));
  assert(source.includes('bring Sunspire Key, consumed on the first boss victory'));
  assertEquals(
    source.split('\n').length,
    1,
    'semicolons inside one location are not list separators',
  );
});

Deno.test('quest decision UI: each branch owns its warning and button, without a preferred route', () => {
  const p = ferryHero(1922);
  p.scene = { view: 'dialogue', arg: 'dlg_ferry_promise', arg2: 'n3' };
  const blocks = renderDialogue(p).blocks!;
  const actionRows = rows(blocks);
  assertEquals(actionRows.length, 3, 'two visible routes and one deferral');
  let start = 0;
  for (const [i, row] of actionRows.slice(0, 2).entries()) {
    assertEquals(row.align, 'left');
    assertEquals(row.buttons.length, 1);
    assertEquals(row.buttons[0].style, undefined, 'neither route is preferred');
    const end = blocks.indexOf(row);
    const section = blocks.slice(start, end);
    const text = visible(section);
    const warning = section.find((b) =>
      b.type === 'blockquote' && visible(b).includes('⚠️ Consequences')
    );
    assert(warning, 'consequences precede their own action');
    assert(visible(warning).includes('Once confirmed, this decision cannot be changed.'));
    assert(
      visible(warning).includes(
        `Permanently closes: ${i === 0 ? 'The Water Intake' : "The Shrine's Beacon"}.`,
      ),
    );
    assert(text.includes(i === 0 ? 'Defeat Marsh Wisp ×4' : 'Defeat Marsh Leech ×4'));
    assert(!text.includes(i === 0 ? 'Defeat Marsh Leech ×4' : 'Defeat Marsh Wisp ×4'));
    start = end + 1;
  }
  assertEquals(actionRows[2].align, 'left');
  assertEquals(actionRows[2].buttons[0].text, '✋ Not now');
  assert(!visible(blocks).includes('Your toxin work earns'), 'hidden response is not disclosed');
});

Deno.test('quest decision UI: lock and failure distinguish lost active progress from unopened branches', () => {
  const p = ferryHero(1923);
  for (const kind of ['lockQuest', 'failQuest'] as const) {
    for (const status of ['unavailable', 'available', 'active', 'turnIn'] as const) {
      p.quests.sq_ledger_debt = { status, counts: [3] };
      const c: DialogueChoice = {
        id: 'test',
        label: 'Choose the beacon',
        irreversible: true,
        effects: [{ kind, questId: 'sq_ledger_debt' }],
      };
      const before = JSON.stringify(p);
      const blocks = choiceQuestBlocks(p, c);
      const warning = blocks.find((b) => b.type === 'blockquote');
      assert(warning);
      const text = visible(warning);
      if (status === 'active' || status === 'turnIn') {
        assert(text.includes('Cancels The Water Intake. Progress is lost;'));
        assert(text.includes('cannot be resumed or rewarded'));
      } else {
        assert(
          text.includes(
            `${
              kind === 'lockQuest' ? 'Permanently closes' : 'Permanently fails'
            }: The Water Intake.`,
          ),
        );
        assert(!text.includes('Cancels'), 'no active work is lost');
      }
      assertEquals(JSON.stringify(p), before, 'preview does not cancel the quest');
    }
  }
});

Deno.test('quest decision UI: confirmation separates the keepsake from exact forfeited rewards', () => {
  const p = ferryHero(1924);
  p.scene = {
    view: 'dialogue',
    arg: 'dlg_sq_shrine_pact_turnin',
    arg2: 'ta',
    arg3: 'confirm:keep',
  };
  const q = quest('sq_shrine_pact')!;
  const before = JSON.stringify(p);
  const blocks = renderDialogue(p).blocks!;
  assert(visible(blocks).includes('Receive: Wisp Lantern ×1.'));
  assert(!visible(blocks).includes('🎁 Rewards now'), 'normal payment is not advertised as a gain');
  assert(
    !visible(blocks).includes('Return the light to the shrine'),
    'only the selected response renders',
  );
  const warning = blocks.find((b) =>
    b.type === 'blockquote' && visible(b).includes('⚠️ Consequences')
  );
  assert(warning);
  const text = visible(warning);
  for (
    const fact of [
      'without its normal rewards',
      'Forgo:',
      xpRewardLabel(p.level, q.rewards.xp),
      `${q.rewards.gold} gold`,
      'no combat effect',
      'the beacon remains unlit',
      ...Object.entries(q.rewards.items ?? {}).map(([id, n]) => `${itemName(id)} ×${n}`),
    ]
  ) assert(text.includes(fact), fact);
  const [row] = rows(blocks);
  assertEquals(rows(blocks).length, 1);
  assertEquals(row.align, 'left');
  assertEquals(row.buttons.map((b) => b.text), ['✅ Confirm choice', '✋ Go back']);
  assertEquals(row.buttons.map((b) => b.style), ['danger', undefined]);
  assertEquals(JSON.stringify(p), before);
  dialogueAction(p, { v: 'dlg', a: 'cc' });
  assertEquals(p.scene.arg3, undefined, 'Go back still only cancels staging');
});

Deno.test('quest decision UI: direct grants, travel unlocks, and item costs disclose their timing', () => {
  const p = createPlayer(1925, 'Reader', 'cleric');
  p.unlockedZones = ['emberdawn'];
  const c: DialogueChoice = {
    id: 'test',
    label: 'Trade',
    effects: [
      { kind: 'grantItem', itemId: 'q_wisp_lantern' },
      { kind: 'unlockZone', zoneId: 'whisperwood' },
      { kind: 'removeItem', itemId: 'q_sealed_letter' },
    ],
  };
  const text = visible(choiceQuestBlocks(p, c));
  assert(text.includes('🎁 Receive now'));
  assert(text.includes('Receive: Wisp Lantern ×1.'));
  assert(text.includes('Opens travel to: Whisperwood.'));
  assert(text.includes('Hand over now: Sealed Letter ×1.'));
  p.unlockedZones.push('whisperwood');
  assert(!visible(choiceQuestBlocks(p, c)).includes('Opens travel to:'));
  p.level = 45;
  const q = quest('m12_chronolich')!;
  assert(visible(questBriefBlocks(p, q)).includes(xpRewardLabel(45, q.rewards.xp)));
  // With the parent no longer active, no response can be chosen; the exit still aligns.
  p.currentZone = 'hollowmere';
  const d = dialogue('dlg_ferry_promise')!;
  p.scene = { view: 'dialogue', arg: d.id, arg2: 'n3' };
  assertEquals(
    rows(renderDialogue(p).blocks!).map((r) => [r.align, r.buttons.map((b) => b.text)]),
    [
      ['left', ['✋ Not now']],
    ],
  );
});
