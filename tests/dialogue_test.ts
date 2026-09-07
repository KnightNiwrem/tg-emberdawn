/**
 * Multi-node dialogue conversations (#124): authored linear dialogue with
 * explicit speakers, Continue advancing exactly one node in the live
 * message, persisted scene state that rerenders faithfully, and hostile
 * callbacks that never mutate. Also the dialogue content-integrity gate.
 */

import { assert, assertEquals } from '@std/assert';
import { dialogue, dialogueNode, DIALOGUES } from '../src/content/dialogues.ts';
import { npc } from '../src/content/quests.ts';
import { QUESTS } from '../src/content/quests.ts';
import { ZONES } from '../src/content/zones.ts';
import { ITEMS } from '../src/content/items.ts';
import { decodeCb, encodeCb, withRev } from '../src/codec.ts';
import { createPlayer } from '../src/engine/character.ts';
import { syncAvailability } from '../src/engine/quests.ts';
import { npcTopics } from '../src/engine/npc.ts';
import { conditionRefs } from '../src/engine/conditions.ts';
import { storyEffectRefs } from './helpers_story.ts';
import type {
  DialogueChoice,
  DialogueDef,
  DialogueNode,
  StoryEffect,
} from '../src/content/types.ts';
import { dialogueAction, npcAction } from '../src/handlers/hub.ts';
import { renderDialogue } from '../src/render/views.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { fakeCtx } from './helpers.ts';
import type { PlayerState } from '../src/engine/types.ts';

const QUEST_IDS = QUESTS.map((questDef) => questDef.id);
const ITEM_IDS = ITEMS.map((itemDef) => itemDef.id);
const questIds = new Set(QUEST_IDS);
const zoneIds = new Set(ZONES.map((zoneDef) => zoneDef.id));
const itemIds = new Set(ITEM_IDS);

/** Obvious incompatible bundles are statically rejected (#132, #146): one
 * effect surface — a choice's list or a line node's list — may not
 * start/accept AND lock/fail the SAME quest. The runtime refuses the same
 * combination as contradictory content (#145); this keeps authored content
 * from ever shipping it. */
function assertNoIncompatibleBundle(
  from: string,
  effects: readonly StoryEffect[],
): void {
  const started = new Set(
    effects
      .filter((effect) => effect.kind === 'startQuest' || effect.kind === 'acceptQuest')
      .map((effect) => (effect as { questId: string }).questId),
  );
  for (const effect of effects) {
    if (effect.kind === 'lockQuest' || effect.kind === 'failQuest') {
      assert(
        !started.has(effect.questId),
        `${from}: starts and ${effect.kind}s ${effect.questId} in one bundle`,
      );
    }
  }
}

// ── content integrity ────────────────────────────────────────────────────

Deno.test('dialogue integrity: ids, references, reachability, terminals (#124, #126)', () => {
  const ids = new Set(DIALOGUES.map((dialogueDef) => dialogueDef.id));
  assertEquals(ids.size, DIALOGUES.length, 'dialogue ids are unique');
  const placedNpcs = new Set(ZONES.flatMap((zoneDef) => zoneDef.npcs.map((npcDef) => npcDef.id)));
  for (const dialogueDef of DIALOGUES) {
    assert(
      placedNpcs.has(dialogueDef.npcId),
      `${dialogueDef.id}: npc ${dialogueDef.npcId} is not placed in any zone`,
    );
    assert(dialogueDef.nodes.length > 0, `${dialogueDef.id}: no nodes`);
    const nodeIds = new Set(dialogueDef.nodes.map((node) => node.id));
    assertEquals(
      nodeIds.size,
      dialogueDef.nodes.length,
      `${dialogueDef.id}: node ids must be unique`,
    );
    assert(nodeIds.has(dialogueDef.start), `${dialogueDef.id}: start node missing`);
    for (const node of dialogueDef.nodes) {
      if (node.kind === 'line') {
        assert(node.text.length > 0, `${dialogueDef.id}:${node.id}: empty line node`);
        if (node.next !== undefined) {
          assert(
            nodeIds.has(node.next),
            `${dialogueDef.id}:${node.id}: missing next target ${node.next}`,
          );
        }
        // Line-entry effects resolve too (#132): every effect surface is
        // crawled, not only choices.
        assertEffectReferences(dialogueDef.id, node.effects ?? []);
        // Line bundles get the same incompatible-bundle gate as choices
        // (#146): no effect surface may start/accept AND lock/fail the
        // SAME quest — the runtime refuses that as contradictory content.
        assertNoIncompatibleBundle(`${dialogueDef.id}:${node.id}`, node.effects ?? []);
      } else if (node.kind === 'choice') {
        assert(node.prompt.length > 0, `${dialogueDef.id}:${node.id}: empty choice prompt`);
        // A choice node always offers a real branch: either multiple
        // responses, or a single response while the structural deferral
        // ("Not now") remains available as the non-mutating exit (#132).
        assert(
          node.choices.length >= 2 || (node.choices.length >= 1 && node.allowDeferral !== false),
          `${dialogueDef.id}:${node.id}: a choice node offers a real branch`,
        );
        const choiceIds = new Set(node.choices.map((choice) => choice.id));
        assertEquals(
          choiceIds.size,
          node.choices.length,
          `${dialogueDef.id}:${node.id}: choice ids unique`,
        );
        for (const choice of node.choices) {
          assertDialogueChoice(dialogueDef, node, choice, nodeIds);
        }
      } else {
        assertEquals(
          (node as { next?: string }).next,
          undefined,
          `${dialogueDef.id}:${node.id}: end nodes carry no next`,
        );
      }
      // Callback budget: dlg:nx:<rev4>:<nodeId> must stay under 64 bytes.
      if (node.kind === 'line' && node.next) {
        const wire = withRev(9999, encodeCb({ v: 'dlg', a: 'nx', arg: node.next }));
        assert(
          wire.length <= 64,
          `${dialogueDef.id}:${node.id} wire form too long (${wire.length})`,
        );
      }
    }
    assertDialogueGraph(dialogueDef);
  }
});

const DECISION_CHOICES = new Map<string, { choiceId: string; from: string }>();

function assertKnownReferences(
  from: string,
  refs: { quests: string[]; items: string[]; zones: string[] },
): void {
  for (const qid of refs.quests) assert(questIds.has(qid), `${from}: unknown quest ${qid}`);
  for (const iid of refs.items) assert(itemIds.has(iid), `${from}: unknown item ${iid}`);
  for (const zid of refs.zones) assert(zoneIds.has(zid), `${from}: unknown zone ${zid}`);
}

function assertEffectReferences(from: string, effects: readonly StoryEffect[]): void {
  for (const effect of effects) assertKnownReferences(from, storyEffectRefs(effect));
}

function assertDialogueChoice(
  dialogueDef: DialogueDef,
  node: Extract<DialogueNode, { kind: 'choice' }>,
  choice: DialogueChoice,
  nodeIds: Set<string>,
): void {
  assert(choice.label.length > 0, `${dialogueDef.id}:${node.id}:${choice.id}: empty label`);
  if (choice.next !== undefined) {
    assert(
      nodeIds.has(choice.next),
      `${dialogueDef.id}:${node.id}:${choice.id}: missing next ${choice.next}`,
    );
  }
  // Availability conditions resolve (#132): choice `when` gates are
  // crawled like every other condition surface.
  if (choice.when) {
    assertKnownReferences(`${dialogueDef.id}:${node.id}:${choice.id}`, conditionRefs(choice.when));
  }
  // Effect references resolve (quests, items, zones) and decision
  // ids never collide with incompatible option sets.
  assertEffectReferences(dialogueDef.id, choice.effects ?? []);
  // Obvious incompatible bundles are statically rejected (#132,
  // #146 — for choice AND line effect surfaces alike).
  assertNoIncompatibleBundle(`${dialogueDef.id}:${node.id}:${choice.id}`, choice.effects ?? []);
  const dec = (choice.effects ?? []).find((effect) => effect.kind === 'recordDecision');
  if (dec && dec.kind === 'recordDecision') {
    const prior = DECISION_CHOICES.get(dec.id);
    if (prior) {
      assert(
        prior.choiceId !== dec.choiceId,
        `${dialogueDef.id}:${node.id}: decision ${dec.id} reused with duplicate option`,
      );
    }
    DECISION_CHOICES.set(dec.id, {
      choiceId: dec.choiceId,
      from: `${dialogueDef.id}:${choice.id}`,
    });
  }
  // Callback budget for choice selection + confirmation.
  for (const action of ['ch', 'cf'] as const) {
    const wire = withRev(9999, encodeCb({ v: 'dlg', a: action, arg: choice.id }));
    assert(
      wire.length <= 64,
      `${dialogueDef.id}:${node.id}:${choice.id} wire form too long (${wire.length})`,
    );
  }
}

function assertDialogueGraph(dialogueDef: DialogueDef): void {
  // Reachability: every node is visited from start via next links.
  const seen = new Set<string>();
  let cursor: string | undefined = dialogueDef.start;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = dialogueNode(dialogueDef, cursor);
    if (!node) break;
    if (node.kind === 'line') cursor = node.next;
    else if (node.kind === 'choice') {
      // Follow every branch.
      for (const choice of node.choices) if (choice.next) walkFrom(dialogueDef, choice.next, seen);
      cursor = undefined;
    } else cursor = undefined;
  }
  for (const node of dialogueDef.nodes) {
    assert(seen.has(node.id), `${dialogueDef.id}:${node.id}: unreachable node`);
  }
  // Terminals: every branch path terminates — on an explicit end node or
  // on a final line that omits `next`, or on a choice without next.
  assert(
    dWalkTerminates(dialogueDef, dialogueDef.start, new Set()),
    `${dialogueDef.id}: every path terminates`,
  );
  // The dialogue is opened by an NPC topic OR by a quest flow
  // (offer/turn-in/conversation) owned by the same NPC (#127).
  const offered = ZONES.flatMap((zoneDef) => zoneDef.npcs).some((npcDef) =>
    npcDef.id === dialogueDef.npcId &&
    (npcDef.topics ?? []).some((topic) => topic.dialogue === dialogueDef.id)
  );
  const questWired = QUESTS.some((questDef) =>
    [questDef.offerDialogue, questDef.turnInDialogue, questDef.conversationDialogue].includes(
      dialogueDef.id,
    )
  );
  assert(offered || questWired, `${dialogueDef.id}: nothing opens this dialogue`);
}

function walkFrom(
  dialogueDef: NonNullable<ReturnType<typeof dialogue>>,
  nodeId: string,
  seen: Set<string>,
): void {
  let cursor: string | undefined = nodeId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = dialogueNode(dialogueDef, cursor);
    if (!node) break;
    if (node.kind === 'line') cursor = node.next;
    else if (node.kind === 'choice') {
      for (const choice of node.choices) if (choice.next) walkFrom(dialogueDef, choice.next, seen);
      cursor = undefined;
    } else cursor = undefined;
  }
}

function dWalkTerminates(
  dialogueDef: NonNullable<ReturnType<typeof dialogue>>,
  nodeId: string,
  visiting: Set<string>,
): boolean {
  if (visiting.has(nodeId)) return false; // cycle
  const node = dialogueNode(dialogueDef, nodeId);
  if (!node) return false;
  if (node.kind === 'end') return true;
  if (node.kind === 'line') {
    return node.next === undefined || dWalkTerminates(dialogueDef, node.next, visiting);
  }
  return node.choices.every((choice) =>
    choice.next === undefined || dWalkTerminates(dialogueDef, choice.next, visiting)
  );
}

Deno.test('dialogue integrity: topic shapes are complete (#124)', () => {
  for (const zoneDef of ZONES) {
    for (const npcDef of zoneDef.npcs) {
      for (const topic of npcDef.topics ?? []) {
        if (topic.dialogue !== undefined) {
          assert(
            dialogue(topic.dialogue),
            `${npcDef.id}:${topic.id}: unknown dialogue ${topic.dialogue}`,
          );
          assertEquals(
            dialogue(topic.dialogue)!.npcId,
            npcDef.id,
            `${npcDef.id}:${topic.id}: dialogue belongs to another NPC`,
          );
        } else {
          assert(topic.text, `${npcDef.id}:${topic.id}: static topic needs text`);
        }
      }
    }
  }
});

// ── scene flow ───────────────────────────────────────────────────────────

function hero(id: number): PlayerState {
  const player = createPlayer(id, 'T', 'warrior');
  syncAvailability(player);
  return player;
}

Deno.test('dialogue: selecting a dialogue topic opens the scene at the start node (#124)', () => {
  const player = hero(1200);
  player.scene = { view: 'npc', arg: 'npc_maren' };
  npcAction(player, { v: 'npc', a: 'lore', arg: 'maren_flame' });
  assertEquals(player.scene.view, 'dialogue');
  assertEquals(player.scene.arg, 'dlg_maren_flame');
  assertEquals(player.scene.arg2, 'n1');
});

Deno.test('dialogue: Continue advances exactly one node; End returns to topics (#124)', () => {
  const player = hero(1201);
  player.scene = { view: 'npc', arg: 'npc_maren' };
  npcAction(player, { v: 'npc', a: 'lore', arg: 'maren_flame' });
  dialogueAction(player, { v: 'dlg', a: 'nx', arg: 'n2' });
  assertEquals(player.scene.arg2, 'n2');
  dialogueAction(player, { v: 'dlg', a: 'nx', arg: 'n3' });
  dialogueAction(player, { v: 'dlg', a: 'nx', arg: 'n4' });
  dialogueAction(player, { v: 'dlg', a: 'nx', arg: 'n5' });
  assertEquals(player.scene.arg2, 'n5');
  // n5 is the final line (no next): there is nothing to continue to.
  const last = dialogueNode(dialogue('dlg_maren_flame')!, 'n5')!;
  assertEquals(last.kind === 'line' ? last.next : undefined, undefined);
  // End/back returns to the owning NPC's topic menu.
  dialogueAction(player, { v: 'dlg', a: 'bk' });
  assertEquals(player.scene.view, 'npc');
  assertEquals(player.scene.arg, 'npc_maren');
});

Deno.test('dialogue: hostile callbacks are non-mutating (#124)', () => {
  const player = hero(1202);
  player.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' };
  // Wrong next target (forged): refused.
  dialogueAction(player, { v: 'dlg', a: 'nx', arg: 'n5' });
  assertEquals(player.scene.arg2, 'n1', 'a forged skip is refused');
  // Wrong node: the callback targets a node that is not current.next.
  dialogueAction(player, { v: 'dlg', a: 'nx', arg: 'n1' });
  assertEquals(player.scene.arg2, 'n1', 'self-advance refused');
  // Wrong dialogue: the scene names a different conversation.
  player.scene = { view: 'dialogue', arg: 'dlg_bram_forge', arg2: 'n1' };
  dialogueAction(player, { v: 'dlg', a: 'nx', arg: 'n2' }); // valid for THIS scene
  assertEquals(player.scene.arg, 'dlg_bram_forge');
  assertEquals(player.scene.arg2, 'n2');
  // No live scene: refusal.
  player.scene = { view: 'zone' };
  dialogueAction(player, { v: 'dlg', a: 'nx', arg: 'n2' });
  assertEquals(player.scene.view, 'zone', 'nothing opened');
  // Wrong zone: Maren is not in the Whisperwood.
  player.currentZone = 'whisperwood';
  player.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' };
  dialogueAction(player, { v: 'dlg', a: 'nx', arg: 'n2' });
  assertEquals(player.scene.arg2, 'n1', 'off-site dialogue cannot advance');
});

Deno.test('dialogue: rerender reproduces the current node (#124)', () => {
  const player = hero(1203);
  player.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n3' };
  const firstRender = JSON.stringify(renderDialogue(player));
  const secondRender = JSON.stringify(renderDialogue(player));
  assertEquals(firstRender, secondRender, 'rendering is pure and position-stable');
  assert(firstRender.includes('Elder Maren'), 'the same beat renders');
});

Deno.test('dialogue: the representative conversation distinguishes all speakers (#124)', () => {
  const heroState = hero(1204);
  heroState.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n2' }; // narrator
  const narrator = JSON.stringify(renderDialogue(heroState));
  assert(!narrator.includes('“'), 'narration is not quoted as speech');
  heroState.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' }; // npc
  const npcSpeech = JSON.stringify(renderDialogue(heroState));
  assert(npcSpeech.includes('“'), 'NPC speech renders quoted');
  assert(npcSpeech.includes('Elder Maren'), 'the speaker is named');
  assert(npcSpeech.includes('dlg:nx:n2'), 'Continue carries the next node');
  heroState.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n4' }; // player
  const player = JSON.stringify(renderDialogue(heroState));
  assert(player.includes('You — “'), 'authored player speech is attributed');
  // The final beat offers End, not Continue.
  heroState.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n5' };
  const final = JSON.stringify(renderDialogue(heroState));
  assert(final.includes('End conversation'), 'the last beat offers the exit');
  assert(!final.includes('dlg:nx'), 'no Continue past the final line');
});

Deno.test('dialogue: full router — one message, deterministic advance, replay-safe (#124)', async () => {
  const store = new MemoryStore();
  const player = hero(1205);
  player.messageId = 200;
  player.scene = { view: 'npc', arg: 'npc_maren' };
  await store.set(1205, player);
  let cur = (await store.get(1205))!;
  // Topic → dialogue scene.
  await handleCallback(fakeCtx(1205, 200, withRev(cur.uiRev ?? 0, 'npc:lore:maren_flame')), store);
  cur = (await store.get(1205))!;
  assertEquals(cur.scene.view, 'dialogue');
  assertEquals(cur.scene.arg2, 'n1');
  const rev = cur.uiRev ?? 0;
  // Continue n1 → n2.
  await handleCallback(fakeCtx(1205, 200, withRev(rev, 'dlg:nx:n2')), store);
  cur = (await store.get(1205))!;
  assertEquals(cur.scene.arg2, 'n2');
  // Replay of the SAME callback (same revision): rejected by the rev guard.
  await handleCallback(fakeCtx(1205, 200, withRev(rev, 'dlg:nx:n2')), store);
  cur = (await store.get(1205))!;
  assertEquals(cur.scene.arg2, 'n2', 'replay is a no-op');
  // Decoded wire sanity.
  assert(decodeCb('dlg:1234:nx:n2'), 'dlg wire form decodes');
});

Deno.test('dialogue: topics still resolve for every NPC (#123 parity)', () => {
  for (const zoneDef of ZONES) {
    for (const npcDef of zoneDef.npcs) {
      assert(npc(npcDef.id), `${npcDef.id} resolves`);
      void npcTopics(
        {
          quests: {},
          decisions: {},
          flags: {},
          storyEvents: [],
          questOutcomes: {},
        } as unknown as PlayerState,
        npcDef.id,
      );
    }
  }
});
