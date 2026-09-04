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
import type { StoryEffect } from '../src/content/types.ts';
import { dialogueAction, npcAction } from '../src/handlers/hub.ts';
import { renderDialogue } from '../src/render/views.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';
import { fakeCtx } from './helpers.ts';
import type { PlayerState } from '../src/engine/types.ts';

const QUEST_IDS = QUESTS.map((q) => q.id);
const ITEM_IDS = ITEMS.map((i) => i.id);

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
      .filter((e) => e.kind === 'startQuest' || e.kind === 'acceptQuest')
      .map((e) => (e as { questId: string }).questId),
  );
  for (const e of effects) {
    if (e.kind === 'lockQuest' || e.kind === 'failQuest') {
      assert(
        !started.has(e.questId),
        `${from}: starts and ${e.kind}s ${e.questId} in one bundle`,
      );
    }
  }
}

// ── content integrity ────────────────────────────────────────────────────

Deno.test('dialogue integrity: ids, references, reachability, terminals (#124, #126)', () => {
  const ids = new Set(DIALOGUES.map((d) => d.id));
  assertEquals(ids.size, DIALOGUES.length, 'dialogue ids are unique');
  const placedNpcs = new Set(ZONES.flatMap((z) => z.npcs.map((n) => n.id)));
  const questIds = new Set(QUEST_IDS);
  const zoneIds = new Set(ZONES.map((z) => z.id));
  const itemIds = new Set(ITEM_IDS);
  for (const d of DIALOGUES) {
    assert(placedNpcs.has(d.npcId), `${d.id}: npc ${d.npcId} is not placed in any zone`);
    assert(d.nodes.length > 0, `${d.id}: no nodes`);
    const nodeIds = new Set(d.nodes.map((n) => n.id));
    assertEquals(nodeIds.size, d.nodes.length, `${d.id}: node ids must be unique`);
    assert(nodeIds.has(d.start), `${d.id}: start node missing`);
    for (const n of d.nodes) {
      if (n.kind === 'line') {
        assert(n.text.length > 0, `${d.id}:${n.id}: empty line node`);
        if (n.next !== undefined) {
          assert(nodeIds.has(n.next), `${d.id}:${n.id}: missing next target ${n.next}`);
        }
        // Line-entry effects resolve too (#132): every effect surface is
        // crawled, not only choices.
        for (const e of n.effects ?? []) {
          const r = storyEffectRefs(e);
          for (const qid of r.quests) assert(questIds.has(qid), `${d.id}: unknown quest ${qid}`);
          for (const iid of r.items) assert(itemIds.has(iid), `${d.id}: unknown item ${iid}`);
          for (const zid of r.zones) assert(zoneIds.has(zid), `${d.id}: unknown zone ${zid}`);
        }
        // Line bundles get the same incompatible-bundle gate as choices
        // (#146): no effect surface may start/accept AND lock/fail the
        // SAME quest — the runtime refuses that as contradictory content.
        assertNoIncompatibleBundle(`${d.id}:${n.id}`, n.effects ?? []);
      } else if (n.kind === 'choice') {
        assert(n.prompt.length > 0, `${d.id}:${n.id}: empty choice prompt`);
        // A choice node always offers a real branch: either multiple
        // responses, or a single response while the structural deferral
        // ("Not now") remains available as the non-mutating exit (#132).
        assert(
          n.choices.length >= 2 || (n.choices.length >= 1 && n.allowDeferral !== false),
          `${d.id}:${n.id}: a choice node offers a real branch`,
        );
        const choiceIds = new Set(n.choices.map((c) => c.id));
        assertEquals(choiceIds.size, n.choices.length, `${d.id}:${n.id}: choice ids unique`);
        for (const c of n.choices) {
          assert(c.label.length > 0, `${d.id}:${n.id}:${c.id}: empty label`);
          if (c.next !== undefined) {
            assert(nodeIds.has(c.next), `${d.id}:${n.id}:${c.id}: missing next ${c.next}`);
          }
          // Availability conditions resolve (#132): choice `when` gates are
          // crawled like every other condition surface.
          if (c.when) {
            const r = conditionRefs(c.when);
            for (const qid of r.quests) {
              assert(questIds.has(qid), `${d.id}:${n.id}:${c.id}: unknown quest ${qid}`);
            }
            for (const iid of r.items) {
              assert(itemIds.has(iid), `${d.id}:${n.id}:${c.id}: unknown item ${iid}`);
            }
            for (const zid of r.zones) {
              assert(zoneIds.has(zid), `${d.id}:${n.id}:${c.id}: unknown zone ${zid}`);
            }
          }
          // Effect references resolve (quests, items, zones) and decision
          // ids never collide with incompatible option sets.
          for (const e of c.effects ?? []) {
            const r = storyEffectRefs(e);
            for (const qid of r.quests) assert(questIds.has(qid), `${d.id}: unknown quest ${qid}`);
            for (const iid of r.items) assert(itemIds.has(iid), `${d.id}: unknown item ${iid}`);
            for (const zid of r.zones) assert(zoneIds.has(zid), `${d.id}: unknown zone ${zid}`);
          }
          // Obvious incompatible bundles are statically rejected (#132,
          // #146 — for choice AND line effect surfaces alike).
          assertNoIncompatibleBundle(`${d.id}:${n.id}:${c.id}`, c.effects ?? []);
          const dec = (c.effects ?? []).find((e) => e.kind === 'recordDecision');
          if (dec && dec.kind === 'recordDecision') {
            const prior = DECISION_CHOICES.get(dec.id);
            if (prior) {
              assert(
                prior.choiceId !== dec.choiceId,
                `${d.id}:${n.id}: decision ${dec.id} reused with duplicate option`,
              );
            }
            DECISION_CHOICES.set(dec.id, { choiceId: dec.choiceId, from: `${d.id}:${c.id}` });
          }
          // Callback budget for choice selection + confirmation.
          for (const action of ['ch', 'cf'] as const) {
            const wire = withRev(9999, encodeCb({ v: 'dlg', a: action, arg: c.id }));
            assert(
              wire.length <= 64,
              `${d.id}:${n.id}:${c.id} wire form too long (${wire.length})`,
            );
          }
        }
      } else {
        assertEquals(
          (n as { next?: string }).next,
          undefined,
          `${d.id}:${n.id}: end nodes carry no next`,
        );
      }
      // Callback budget: dlg:nx:<rev4>:<nodeId> must stay under 64 bytes.
      if (n.kind === 'line' && n.next) {
        const wire = withRev(9999, encodeCb({ v: 'dlg', a: 'nx', arg: n.next }));
        assert(wire.length <= 64, `${d.id}:${n.id} wire form too long (${wire.length})`);
      }
    }
    // Reachability: every node is visited from start via next links.
    const seen = new Set<string>();
    let cursor: string | undefined = d.start;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const n = dialogueNode(d, cursor);
      if (!n) break;
      if (n.kind === 'line') cursor = n.next;
      else if (n.kind === 'choice') {
        // Follow every branch.
        for (const c of n.choices) if (c.next) walkFrom(d, c.next, seen);
        cursor = undefined;
      } else cursor = undefined;
    }
    for (const n of d.nodes) {
      assert(seen.has(n.id), `${d.id}:${n.id}: unreachable node`);
    }
    // Terminals: every branch path terminates — on an explicit end node or
    // on a final line that omits `next`, or on a choice without next.
    assert(dWalkTerminates(d, d.start, new Set()), `${d.id}: every path terminates`);
    // The dialogue is opened by an NPC topic OR by a quest flow
    // (offer/turn-in/conversation) owned by the same NPC (#127).
    const offered = ZONES.flatMap((z) => z.npcs).some((n) =>
      n.id === d.npcId && (n.topics ?? []).some((t) => t.dialogue === d.id)
    );
    const questWired = QUESTS.some((q) =>
      [q.offerDialogue, q.turnInDialogue, q.conversationDialogue].includes(d.id)
    );
    assert(offered || questWired, `${d.id}: nothing opens this dialogue`);
  }
});

const DECISION_CHOICES = new Map<string, { choiceId: string; from: string }>();

function walkFrom(
  d: NonNullable<ReturnType<typeof dialogue>>,
  nodeId: string,
  seen: Set<string>,
): void {
  let cursor: string | undefined = nodeId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const n = dialogueNode(d, cursor);
    if (!n) break;
    if (n.kind === 'line') cursor = n.next;
    else if (n.kind === 'choice') {
      for (const c of n.choices) if (c.next) walkFrom(d, c.next, seen);
      cursor = undefined;
    } else cursor = undefined;
  }
}

function dWalkTerminates(
  d: NonNullable<ReturnType<typeof dialogue>>,
  nodeId: string,
  visiting: Set<string>,
): boolean {
  if (visiting.has(nodeId)) return false; // cycle
  const n = dialogueNode(d, nodeId);
  if (!n) return false;
  if (n.kind === 'end') return true;
  if (n.kind === 'line') return n.next === undefined || dWalkTerminates(d, n.next, visiting);
  return n.choices.every((c) => c.next === undefined || dWalkTerminates(d, c.next, visiting));
}

Deno.test('dialogue integrity: topic shapes are complete (#124)', () => {
  for (const z of ZONES) {
    for (const n of z.npcs) {
      for (const t of n.topics ?? []) {
        if (t.dialogue !== undefined) {
          assert(dialogue(t.dialogue), `${n.id}:${t.id}: unknown dialogue ${t.dialogue}`);
          assertEquals(
            dialogue(t.dialogue)!.npcId,
            n.id,
            `${n.id}:${t.id}: dialogue belongs to another NPC`,
          );
        } else {
          assert(t.text, `${n.id}:${t.id}: static topic needs text`);
        }
      }
    }
  }
});

// ── scene flow ───────────────────────────────────────────────────────────

function hero(id: number): PlayerState {
  const p = createPlayer(id, 'T', 'warrior');
  syncAvailability(p);
  return p;
}

Deno.test('dialogue: selecting a dialogue topic opens the scene at the start node (#124)', () => {
  const p = hero(1200);
  p.scene = { view: 'npc', arg: 'npc_maren' };
  npcAction(p, { v: 'npc', a: 'lore', arg: 'maren_flame' });
  assertEquals(p.scene.view, 'dialogue');
  assertEquals(p.scene.arg, 'dlg_maren_flame');
  assertEquals(p.scene.arg2, 'n1');
});

Deno.test('dialogue: Continue advances exactly one node; End returns to topics (#124)', () => {
  const p = hero(1201);
  p.scene = { view: 'npc', arg: 'npc_maren' };
  npcAction(p, { v: 'npc', a: 'lore', arg: 'maren_flame' });
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n2' });
  assertEquals(p.scene.arg2, 'n2');
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n3' });
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n4' });
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n5' });
  assertEquals(p.scene.arg2, 'n5');
  // n5 is the final line (no next): there is nothing to continue to.
  const last = dialogueNode(dialogue('dlg_maren_flame')!, 'n5')!;
  assertEquals(last.kind === 'line' ? last.next : undefined, undefined);
  // End/back returns to the owning NPC's topic menu.
  dialogueAction(p, { v: 'dlg', a: 'bk' });
  assertEquals(p.scene.view, 'npc');
  assertEquals(p.scene.arg, 'npc_maren');
});

Deno.test('dialogue: hostile callbacks are non-mutating (#124)', () => {
  const p = hero(1202);
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' };
  // Wrong next target (forged): refused.
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n5' });
  assertEquals(p.scene.arg2, 'n1', 'a forged skip is refused');
  // Wrong node: the callback targets a node that is not current.next.
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n1' });
  assertEquals(p.scene.arg2, 'n1', 'self-advance refused');
  // Wrong dialogue: the scene names a different conversation.
  p.scene = { view: 'dialogue', arg: 'dlg_bram_forge', arg2: 'n1' };
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n2' }); // valid for THIS scene
  assertEquals(p.scene.arg, 'dlg_bram_forge');
  assertEquals(p.scene.arg2, 'n2');
  // No live scene: refusal.
  p.scene = { view: 'zone' };
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n2' });
  assertEquals(p.scene.view, 'zone', 'nothing opened');
  // Wrong zone: Maren is not in the Whisperwood.
  p.currentZone = 'whisperwood';
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' };
  dialogueAction(p, { v: 'dlg', a: 'nx', arg: 'n2' });
  assertEquals(p.scene.arg2, 'n1', 'off-site dialogue cannot advance');
});

Deno.test('dialogue: rerender reproduces the current node (#124)', () => {
  const p = hero(1203);
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n3' };
  const a = JSON.stringify(renderDialogue(p));
  const b = JSON.stringify(renderDialogue(p));
  assertEquals(a, b, 'rendering is pure and position-stable');
  assert(a.includes('Elder Maren'), 'the same beat renders');
});

Deno.test('dialogue: the representative conversation distinguishes all speakers (#124)', () => {
  const p = hero(1204);
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n2' }; // narrator
  const narrator = JSON.stringify(renderDialogue(p));
  assert(!narrator.includes('“'), 'narration is not quoted as speech');
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n1' }; // npc
  const npcSpeech = JSON.stringify(renderDialogue(p));
  assert(npcSpeech.includes('“'), 'NPC speech renders quoted');
  assert(npcSpeech.includes('Elder Maren'), 'the speaker is named');
  assert(npcSpeech.includes('dlg:nx:n2'), 'Continue carries the next node');
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n4' }; // player
  const player = JSON.stringify(renderDialogue(p));
  assert(player.includes('You — “'), 'authored player speech is attributed');
  // The final beat offers End, not Continue.
  p.scene = { view: 'dialogue', arg: 'dlg_maren_flame', arg2: 'n5' };
  const final = JSON.stringify(renderDialogue(p));
  assert(final.includes('End conversation'), 'the last beat offers the exit');
  assert(!final.includes('dlg:nx'), 'no Continue past the final line');
});

Deno.test('dialogue: full router — one message, deterministic advance, replay-safe (#124)', async () => {
  const store = new MemoryStore();
  const p = hero(1205);
  p.messageId = 200;
  p.scene = { view: 'npc', arg: 'npc_maren' };
  await store.set(1205, p);
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
  for (const z of ZONES) {
    for (const n of z.npcs) {
      assert(npc(n.id), `${n.id} resolves`);
      void npcTopics(
        {
          quests: {},
          decisions: {},
          flags: {},
          storyEvents: [],
          questOutcomes: {},
        } as unknown as PlayerState,
        n.id,
      );
    }
  }
});
