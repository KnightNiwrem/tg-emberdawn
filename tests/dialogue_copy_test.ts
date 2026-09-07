/**
 * Quest dialogue copy contract (#133): the renderer owns speech
 * presentation — content stores prompts, labels and lines WITHOUT
 * surrounding quotation marks; every choice node exposes exactly one
 * non-mutating deferral; turn-in labels describe the actual transaction;
 * and no narration before a committing choice asserts that choice's
 * effects (post-commit narration hangs off choice.next).
 */

import { assert, assertEquals } from '@std/assert';
import { dialogue, dialogueNode, DIALOGUES } from '../src/content/dialogues.ts';
import { QUESTS } from '../src/content/quests.ts';
import { zoneOfNpc } from '../src/content/quests.ts';
import { createPlayer } from '../src/engine/character.ts';
import { addItem, countOf } from '../src/engine/inventory.ts';
import { syncAvailability } from '../src/engine/quests.ts';
import { applyDialogueChoice } from '../src/engine/story.ts';
import { dialogueAction } from '../src/handlers/hub.ts';
import { renderDialogue } from '../src/render/views.ts';
import type { PlayerState } from '../src/engine/types.ts';

const ATTRIBUTION_ONLY =
  /^(?:the |ranger |elder |curator |echo of )?\w+(?: of \w+)? (?:says|whispers|mutters|notes)[.,]?$/i;

function questDialogues() {
  const ids = new Set(
    QUESTS.flatMap((questDef) =>
      [questDef.offerDialogue, questDef.turnInDialogue, questDef.conversationDialogue].filter(
        (id): id is string => id !== undefined,
      )
    ),
  );
  return DIALOGUES.filter((dialogueDef) => ids.has(dialogueDef.id));
}

function heroAt(
  dialogueDef: NonNullable<ReturnType<typeof dialogue>>,
  nodeId?: string,
): PlayerState {
  const player = createPlayer(1800, 'T', 'warrior');
  syncAvailability(player);
  const zone = zoneOfNpc(dialogueDef.npcId)!;
  player.currentZone = zone.id;
  player.unlockedZones.push(zone.id);
  player.flags[`zone_${zone.id}`] = true;
  player.scene = {
    view: 'dialogue',
    dialogueId: dialogueDef.id,
    nodeId: nodeId ?? dialogueDef.start,
  };
  return player;
}

// ── punctuation ownership ─────────────────────────────────────────────────

Deno.test('copy: prompts and labels carry no authored quotation marks (#133)', () => {
  for (const dialogueDef of DIALOGUES) {
    for (const node of dialogueDef.nodes) {
      if (node.kind === 'choice') {
        assert(
          !node.prompt.startsWith('“') && !node.prompt.endsWith('”'),
          `${dialogueDef.id}:${node.id}: the prompt carries the renderer's quotation marks`,
        );
        for (const choice of node.choices) {
          assert(
            !choice.label.startsWith('“') && !choice.label.endsWith('”'),
            `${dialogueDef.id}:${node.id}:${choice.id}: the label carries the renderer's quotation marks`,
          );
        }
      }
      if (node.kind === 'line' && node.speaker !== 'narrator') {
        assert(
          !node.text.startsWith('“') && !node.text.endsWith('”'),
          `${dialogueDef.id}:${node.id}: ${node.speaker} speech is quoted by the renderer, not authored`,
        );
      }
    }
  }
});

Deno.test('copy: rendering never doubles quotation marks (#133)', () => {
  for (const dialogueDef of DIALOGUES) {
    for (const node of dialogueDef.nodes) {
      if (node.kind === 'end') continue;
      const player = heroAt(dialogueDef, node.id);
      const view = JSON.stringify(renderDialogue(player));
      assert(
        !view.includes('““') && !view.includes('””') && !view.includes('“”'),
        `${dialogueDef.id}:${node.id}: doubled quotation marks on screen`,
      );
      if (node.kind === 'choice') {
        const staged = {
          ...player,
          scene: { ...player.scene, confirmation: node.choices[0]!.id },
        };
        const panel = JSON.stringify(renderDialogue(staged));
        assert(
          !panel.includes('““') && !panel.includes('””') && !panel.includes('“”'),
          `${dialogueDef.id}:${node.id}: doubled quotation marks on the confirmation panel`,
        );
      }
    }
  }
});

// ── one deferral mechanism ────────────────────────────────────────────────

Deno.test('copy: no authored duplicate deferral on any choice node (#133)', () => {
  for (const dialogueDef of DIALOGUES) {
    for (const node of dialogueDef.nodes) {
      if (node.kind !== 'choice') continue;
      for (const choice of node.choices) {
        assert(
          choice.id !== 'notyet' && !/not (yet|now)/i.test(choice.label),
          `${dialogueDef.id}:${node.id}:${choice.id}: the renderer's "Not now" is the ONE deferral`,
        );
      }
    }
  }
});

Deno.test('copy: every rendered choice screen shows exactly one deferral (#133)', () => {
  for (const dialogueDef of questDialogues()) {
    for (const node of dialogueDef.nodes) {
      if (node.kind !== 'choice') continue;
      const player = heroAt(dialogueDef, node.id);
      const view = JSON.stringify(renderDialogue(player));
      const deferrals = view.split('✋ Not now').length - 1;
      assertEquals(
        deferrals,
        1,
        `${dialogueDef.id}:${node.id}: exactly one non-mutating exit, rendered`,
      );
    }
  }
});

// ── semantic turn-in labels ───────────────────────────────────────────────

Deno.test('copy: turn-in labels describe the actual transaction (#133)', () => {
  for (const questDef of QUESTS) {
    const dialogueDef = dialogue(questDef.turnInDialogue)!;
    const handover = dialogueDef.nodes
      .flatMap((node) => node.kind === 'choice' ? node.choices : [])
      .find((choice) => choice.id === 'handover')!;
    const collects = questDef.objectives.filter((objective) => objective.kind === 'collect');
    assert(
      !handover.label.includes('Hand it over'),
      `${questDef.id}: the retired universal "Hand it over" label is back`,
    );
    if (collects.length > 0) {
      assert(
        /hand over/i.test(handover.label),
        `${questDef.id}: goods change hands here — the label must say so (${handover.label})`,
      );
    } else {
      assert(
        !/hand (it |them )?over/i.test(handover.label),
        `${questDef.id}: nothing is surrendered here — the label invents a handover (${handover.label})`,
      );
    }
  }
});

// ── beats: no attribution fragments ──────────────────────────────────────

Deno.test('copy: one node per beat — attribution fragments are merged (#133)', () => {
  for (const dialogueDef of DIALOGUES) {
    for (const node of dialogueDef.nodes) {
      if (node.kind !== 'line') continue;
      assert(
        !ATTRIBUTION_ONLY.test(node.text),
        `${dialogueDef.id}:${node.id}: a bare "says" attribution is not a beat: ${node.text}`,
      );
      if (node.speaker !== 'narrator') {
        assert(
          !node.text.endsWith(','),
          `${dialogueDef.id}:${node.id}: dangling clause split across nodes: ${node.text}`,
        );
      }
    }
  }
});

// ── transactional staging ─────────────────────────────────────────────────

Deno.test('copy: no narration asserts the handover before the committing choice (#133)', () => {
  for (const dialogueDef of questDialogues()) {
    // Follow the FLOW from the start node; everything reachable before the
    // committing choice is pre-commit narration.
    const preCommit: string[] = [];
    let cursor: string | undefined = dialogueDef.start;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node = dialogueNode(dialogueDef, cursor);
      if (!node || node.kind === 'choice' || node.kind === 'end') break;
      preCommit.push(`${node.id}: ${node.text}`);
      cursor = node.next;
    }
    for (const text of preCommit) {
      assert(
        !/into your hands/.test(text),
        `${dialogueDef.id}: pre-commit narration asserts the transfer: ${text}`,
      );
    }
  }
});

Deno.test('copy: the m1 letter is offered before, handed after the commit (#133)', () => {
  // The #122 regression this guards: the reward was narrated into the
  // player's hands before they chose to complete the quest.
  const questDef = QUESTS.find((questDef) => questDef.id === 'm1_embers')!;
  const dialogueDef = dialogue(questDef.turnInDialogue)!;
  const player = heroAt(dialogueDef, 't2');
  // The beat before the choice: the letter is OFFERED, not handed over.
  const offered = JSON.stringify(renderDialogue(player));
  assert(offered.includes('holds out a wax-sealed letter'), 'the letter is OFFERED');
  assert(!offered.includes('into your hands'), 'nothing is asserted as handed over yet');
  // At the choice screen nothing claims the transfer either.
  player.scene = { view: 'dialogue', dialogueId: dialogueDef.id, nodeId: 'ta' };
  const atChoice = JSON.stringify(renderDialogue(player));
  assert(!atChoice.includes('into your hands'), 'the choice screen asserts no handover');
  // Commit: the letter changes hands only after the choice applies.
  player.quests['m1_embers'] = { status: 'turnIn', counts: [4] };
  const result = applyDialogueChoice(player, { choiceId: 'handover', now: 1 });
  assert(result.ok);
  assertEquals(player.quests['m1_embers']?.status, 'done');
  assertEquals(result.nextNodeId, 't3');
  player.scene = { view: 'dialogue', dialogueId: dialogueDef.id, nodeId: 't3' };
  const after = JSON.stringify(renderDialogue(player));
  assert(after.includes('into your hands'), 'the handover is narrated only post-commit');
});

Deno.test('copy: m5_arms requests the iron before the commit and forges only after it (#148)', () => {
  // The pre-transaction contradiction this flow carried: the offer opened
  // with Bram weighing chunks the player did not own, and the turn-in
  // started the forge and announced steel on the rack before the hand-over
  // choice. With zero inventory the flow must REQUEST the goods and stage
  // nothing it has not received; receipt/use/completion narration is
  // reachable only after the committing choice applies.
  const questDef = QUESTS.find((questDef) => questDef.id === 'm5_arms')!;
  const offer = dialogue(questDef.offerDialogue)!;
  const turnIn = dialogue(questDef.turnInDialogue)!;

  // Zero-chunk hero opens the offer: the staging shows the EMPTY bin —
  // Bram holds nothing of the player's — and the request beat stays
  // concrete (two chunks, no coin).
  const player = heroAt(offer, 'o1');
  assertEquals(countOf(player, 'm_iron_chunk'), 0, 'fixture: zero iron in the bag');
  const offerView = JSON.stringify(renderDialogue(player));
  assert(offerView.includes('empty ore bin'), 'the staging shows an empty bin, not held goods');
  assert(
    !offerView.includes('weighs the chunks'),
    'Bram never narrates holding the player\u2019s iron',
  );
  player.scene = { view: 'dialogue', dialogueId: offer.id, nodeId: 'o2' };
  const request = JSON.stringify(renderDialogue(player));
  assert(request.includes('bring me two chunks'), 'the offer asks for exactly two chunks');
  // Deferring from the offer mutates nothing.
  const before = JSON.stringify({ q: player.quests, i: player.inventory });
  dialogueAction(player, { v: 'dlg', a: 'bk' });
  assertEquals(player.scene.view, 'npc', 'the deferral leaves to the topic menu');
  assertEquals(JSON.stringify({ q: player.quests, i: player.inventory }), before);

  // Turn-in: only the request is staged; the forge and the steel exist
  // only after the hand-over commits.
  const p2 = heroAt(turnIn, 't1');
  p2.quests['m5_arms'] = { status: 'turnIn', counts: [2] };
  addItem(p2, 'm_iron_chunk', 2);
  const staged = JSON.stringify(renderDialogue(p2));
  assert(staged.includes('holds out both scarred hands'), 'the iron is requested, not received');
  assert(
    !staged.includes('forge roaring') && !staged.includes('on my rack'),
    'no receipt, use or completion narration before the commit',
  );
  // Deferring from the turn-in preserves the quest status and both chunks.
  const held = JSON.stringify({ q: p2.quests, i: p2.inventory });
  dialogueAction(p2, { v: 'dlg', a: 'bk' });
  assertEquals(JSON.stringify({ q: p2.quests, i: p2.inventory }), held);
  p2.scene = { view: 'dialogue', dialogueId: turnIn.id, nodeId: 'ta' };

  // Confirming consumes exactly two chunks through the central authority.
  const result = applyDialogueChoice(p2, { choiceId: 'handover', now: 1 });
  assert(result.ok);
  assertEquals(p2.quests['m5_arms']?.status, 'done');
  assertEquals(countOf(p2, 'm_iron_chunk'), 0, 'exactly the two chunks are consumed');
  assertEquals(result.nextNodeId, 't2', 'the receipt narration hangs off the committing choice');

  // The post-commit beats survive rerender and a save/reload round-trip,
  // and the recorded receipt makes a replayed hand-over a reward-free no-op.
  p2.scene = { view: 'dialogue', dialogueId: turnIn.id, nodeId: 't2' };
  const forge = JSON.stringify(renderDialogue(p2));
  assert(forge.includes('forge roaring'), 'the forge work is narrated only post-commit');
  p2.scene = { view: 'dialogue', dialogueId: turnIn.id, nodeId: 't3' };
  const steel = JSON.stringify(renderDialogue(p2));
  assert(steel.includes('on my rack'), 'the steel is announced only post-commit');
  const reloaded = JSON.parse(JSON.stringify(p2)) as PlayerState;
  assertEquals(
    JSON.stringify(renderDialogue(reloaded)),
    steel,
    'rerender/reload stability',
  );
  const gold = p2.gold;
  p2.scene = { view: 'dialogue', dialogueId: turnIn.id, nodeId: 'ta' };
  const replay = applyDialogueChoice(p2, { choiceId: 'handover', now: 2 });
  assertEquals(replay.ok, true, 'the replay routes cleanly…');
  assertEquals(p2.gold, gold, '…and grants nothing twice');
});
