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
import { syncAvailability } from '../src/engine/quests.ts';
import { applyDialogueChoice } from '../src/engine/story.ts';
import { renderDialogue } from '../src/render/views.ts';
import type { PlayerState } from '../src/engine/types.ts';

const ATTRIBUTION_ONLY =
  /^(?:the |ranger |elder |curator |echo of )?\w+(?: of \w+)? (?:says|whispers|mutters|notes)[.,]?$/i;

function questDialogues() {
  const ids = new Set(
    QUESTS.flatMap((q) =>
      [q.offerDialogue, q.turnInDialogue, q.conversationDialogue].filter(
        (id): id is string => id !== undefined,
      )
    ),
  );
  return DIALOGUES.filter((d) => ids.has(d.id));
}

function heroAt(d: NonNullable<ReturnType<typeof dialogue>>, nodeId?: string): PlayerState {
  const p = createPlayer(1800, 'T', 'warrior');
  syncAvailability(p);
  const zone = zoneOfNpc(d.npcId)!;
  p.currentZone = zone.id;
  p.unlockedZones.push(zone.id);
  p.flags[`zone_${zone.id}`] = true;
  p.scene = { view: 'dialogue', arg: d.id, arg2: nodeId ?? d.start };
  return p;
}

// ── punctuation ownership ─────────────────────────────────────────────────

Deno.test('copy: prompts and labels carry no authored quotation marks (#133)', () => {
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind === 'choice') {
        assert(
          !n.prompt.startsWith('“') && !n.prompt.endsWith('”'),
          `${d.id}:${n.id}: the prompt carries the renderer's quotation marks`,
        );
        for (const c of n.choices) {
          assert(
            !c.label.startsWith('“') && !c.label.endsWith('”'),
            `${d.id}:${n.id}:${c.id}: the label carries the renderer's quotation marks`,
          );
        }
      }
      if (n.kind === 'line' && n.speaker !== 'narrator') {
        assert(
          !n.text.startsWith('“') && !n.text.endsWith('”'),
          `${d.id}:${n.id}: ${n.speaker} speech is quoted by the renderer, not authored`,
        );
      }
    }
  }
});

Deno.test('copy: rendering never doubles quotation marks (#133)', () => {
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind === 'end') continue;
      const p = heroAt(d, n.id);
      const view = JSON.stringify(renderDialogue(p));
      assert(
        !view.includes('““') && !view.includes('””') && !view.includes('“”'),
        `${d.id}:${n.id}: doubled quotation marks on screen`,
      );
      if (n.kind === 'choice') {
        const staged = { ...p, scene: { ...p.scene, arg3: `confirm:${n.choices[0]!.id}` } };
        const panel = JSON.stringify(renderDialogue(staged));
        assert(
          !panel.includes('““') && !panel.includes('””') && !panel.includes('“”'),
          `${d.id}:${n.id}: doubled quotation marks on the confirmation panel`,
        );
      }
    }
  }
});

// ── one deferral mechanism ────────────────────────────────────────────────

Deno.test('copy: no authored duplicate deferral on any choice node (#133)', () => {
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind !== 'choice') continue;
      for (const c of n.choices) {
        assert(
          c.id !== 'notyet' && !/not (yet|now)/i.test(c.label),
          `${d.id}:${n.id}:${c.id}: the renderer's "Not now" is the ONE deferral`,
        );
      }
    }
  }
});

Deno.test('copy: every rendered choice screen shows exactly one deferral (#133)', () => {
  for (const d of questDialogues()) {
    for (const n of d.nodes) {
      if (n.kind !== 'choice') continue;
      const p = heroAt(d, n.id);
      const view = JSON.stringify(renderDialogue(p));
      const deferrals = view.split('✋ Not now').length - 1;
      assertEquals(
        deferrals,
        1,
        `${d.id}:${n.id}: exactly one non-mutating exit, rendered`,
      );
    }
  }
});

// ── semantic turn-in labels ───────────────────────────────────────────────

Deno.test('copy: turn-in labels describe the actual transaction (#133)', () => {
  for (const q of QUESTS) {
    const d = dialogue(q.turnInDialogue)!;
    const handover = d.nodes
      .flatMap((n) => n.kind === 'choice' ? n.choices : [])
      .find((c) => c.id === 'handover')!;
    const collects = q.objectives.filter((o) => o.kind === 'collect');
    assert(
      !handover.label.includes('Hand it over'),
      `${q.id}: the retired universal "Hand it over" label is back`,
    );
    if (collects.length > 0) {
      assert(
        /hand over/i.test(handover.label),
        `${q.id}: goods change hands here — the label must say so (${handover.label})`,
      );
    } else {
      assert(
        !/hand (it |them )?over/i.test(handover.label),
        `${q.id}: nothing is surrendered here — the label invents a handover (${handover.label})`,
      );
    }
  }
});

// ── beats: no attribution fragments ──────────────────────────────────────

Deno.test('copy: one node per beat — attribution fragments are merged (#133)', () => {
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind !== 'line') continue;
      assert(
        !ATTRIBUTION_ONLY.test(n.text),
        `${d.id}:${n.id}: a bare "says" attribution is not a beat: ${n.text}`,
      );
      if (n.speaker !== 'narrator') {
        assert(
          !n.text.endsWith(','),
          `${d.id}:${n.id}: dangling clause split across nodes: ${n.text}`,
        );
      }
    }
  }
});

// ── transactional staging ─────────────────────────────────────────────────

Deno.test('copy: no narration asserts the handover before the committing choice (#133)', () => {
  for (const d of questDialogues()) {
    // Follow the FLOW from the start node; everything reachable before the
    // committing choice is pre-commit narration.
    const preCommit: string[] = [];
    let cursor: string | undefined = d.start;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const n = dialogueNode(d, cursor);
      if (!n || n.kind === 'choice' || n.kind === 'end') break;
      preCommit.push(`${n.id}: ${n.text}`);
      cursor = n.next;
    }
    for (const text of preCommit) {
      assert(
        !/into your hands/.test(text),
        `${d.id}: pre-commit narration asserts the transfer: ${text}`,
      );
    }
  }
});

Deno.test('copy: the m1 letter is offered before, handed after the commit (#133)', () => {
  // The #122 regression this guards: the reward was narrated into the
  // player's hands before they chose to complete the quest.
  const q = QUESTS.find((x) => x.id === 'm1_embers')!;
  const d = dialogue(q.turnInDialogue)!;
  const p = heroAt(d, 't2');
  // The beat before the choice: the letter is OFFERED, not handed over.
  const offered = JSON.stringify(renderDialogue(p));
  assert(offered.includes('holds out a wax-sealed letter'), 'the letter is OFFERED');
  assert(!offered.includes('into your hands'), 'nothing is asserted as handed over yet');
  // At the choice screen nothing claims the transfer either.
  p.scene = { view: 'dialogue', arg: d.id, arg2: 'ta' };
  const atChoice = JSON.stringify(renderDialogue(p));
  assert(!atChoice.includes('into your hands'), 'the choice screen asserts no handover');
  // Commit: the letter changes hands only after the choice applies.
  p.quests['m1_embers'] = { status: 'turnIn', counts: [4] };
  const r = applyDialogueChoice(p, { choiceId: 'handover', now: 1 });
  assert(r.ok);
  assertEquals(p.quests['m1_embers']?.status, 'done');
  assertEquals(r.nextNodeId, 't3');
  p.scene = { view: 'dialogue', arg: d.id, arg2: 't3' };
  const after = JSON.stringify(renderDialogue(p));
  assert(after.includes('into your hands'), 'the handover is narrated only post-commit');
});
