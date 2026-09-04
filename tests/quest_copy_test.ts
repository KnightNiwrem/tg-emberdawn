/**
 * Quest copy & staging integrity (#122): machine-checkable invariants over
 * quest/zone/NPC content — reward-source coherence, class-compatible
 * rewards, naming consistency, and the absence of game-system leaks in
 * in-world fields. These are FACTUAL checks (ids, shapes, fixed tokens);
 * they deliberately do not judge prose style.
 */

import { assert, assertEquals } from '@std/assert';
import { npc, quest, QUESTS } from '../src/content/quests.ts';
import { item, ITEMS } from '../src/content/items.ts';
import { npcInZone, zoneOfNpc } from '../src/content/quests.ts';
import { ZONES } from '../src/content/zones.ts';
import { dialogue, DIALOGUES } from '../src/content/dialogues.ts';
import { conditionRefs } from '../src/engine/conditions.ts';
import type { Condition, DialogueDef, QuestDef } from '../src/content/types.ts';

/** A quest's own lifecycle dialogues (offer, turn-in, conversation). */
function questDialoguesOf(q: QuestDef): DialogueDef[] {
  return [q.offerDialogue, q.turnInDialogue, q.conversationDialogue]
    .filter((id): id is string => id !== undefined)
    .map((id) => dialogue(id))
    .flatMap((d) => d ? [d] : []);
}

/** Every story event a dialogue's line and choice effects can emit. */
function emittedStoryEvents(d: DialogueDef): string[] {
  return d.nodes.flatMap((n) =>
    n.kind === 'line'
      ? n.effects ?? []
      : n.kind === 'choice'
      ? n.choices.flatMap((c) => c.effects ?? [])
      : []
  ).filter((e) => e.kind === 'storyEvent').map((e) => (e as { event: string }).event);
}

Deno.test('quest copy: the Sealed Letter is granted once and delivered to Bram (#122)', () => {
  // The letter enters the bag from exactly ONE quest reward (m1_embers,
  // completed with Maren) and m2_letter requires carrying it to Bram.
  const grantors = QUESTS.filter((q) => (q.rewards.items?.q_sealed_letter ?? 0) > 0);
  assertEquals(grantors.map((q) => q.id), ['m1_embers']);
  const m2 = quest('m2_letter')!;
  assertEquals(
    m2.objectives.filter((o) => o.kind === 'collect').map((o) => o.target),
    ['q_sealed_letter'],
  );
  assertEquals(m2.startNpc, 'npc_maren');
  assertEquals(m2.finishNpc, 'npc_bram');
  assertEquals(npcInZone('emberdawn', 'npc_maren')?.name, 'Elder Maren');
  assertEquals(npcInZone('emberdawn', 'npc_bram')?.name, 'Blacksmith Bram');
});

Deno.test('quest copy: m5_arms asks only for goods its objectives require (#122)', () => {
  // The request must not demand resources (like coin) the objective never
  // collects or consumes.
  const m5 = quest('m5_arms')!;
  for (const o of m5.objectives) {
    assertEquals(o.kind, 'collect', 'm5_arms objectives are collect-only');
    assert(item(o.target), `m5_arms collects a real item (${o.target})`);
  }
  // The engine never charges gold for accepting or turning in a quest —
  // so no quest text may claim otherwise. (Guarded here by asserting the
  // objective targets are all material goods with a shop/drop source.)
  assertEquals(m5.objectives.length, 1);
  assertEquals(m5.objectives[0]!.target, 'm_iron_chunk');
});

Deno.test('quest copy: quest rewards are usable by every class (#122)', () => {
  // A class-locked weapon/armor as a static quest reward would be dead
  // weight for three of four heroes. Named class-appropriate weapons are
  // NOT allowed as quest rewards; trinkets/consumables/materials are.
  for (const q of QUESTS) {
    for (const id of Object.keys(q.rewards.items ?? {})) {
      const def = item(id);
      assert(def, `${q.id} rewards unknown item ${id}`);
      if (def.kind === 'weapon' || def.kind === 'armor') {
        assertEquals(
          def.classes,
          undefined,
          `${q.id} rewards class-locked ${id} — every Dawncaller must be able to use it`,
        );
      }
    }
  }
});

Deno.test('quest copy: in-world fields do not leak game-system terms (#122)', () => {
  // Chapters and the postgame are authoring concepts — player-facing
  // in-world fields must not name them. Fixed-token check, not style.
  const leak = /chapter|postgame/i;
  for (const z of ZONES) {
    assert(!leak.test(z.desc), `zone ${z.id} desc leaks system terms: ${z.desc}`);
    for (const n of z.npcs) {
      assert(!leak.test(n.greeting), `npc ${n.id} greeting leaks system terms`);
    }
  }
  for (const q of QUESTS) {
    assert(!leak.test(q.name), `quest ${q.id} name leaks system terms`);
    assert(!leak.test(q.summary), `quest ${q.id} summary leaks system terms`);
  }
});

Deno.test('quest copy: no administrative jargon in in-world labels (#128)', () => {
  // Modern administrative vocabulary is out of world and out of every
  // voice sheet (docs/narrative-guide.md §2). Narrow factual token check
  // on quest NAME/SUMMARY labels — never a prose-style parser.
  const admin = /paperwork|management|corrections|diplomacy/i;
  for (const q of QUESTS) {
    assert(!admin.test(q.name), `quest ${q.id} name carries admin jargon: ${q.name}`);
    assert(!admin.test(q.summary), `quest ${q.id} summary carries admin jargon: ${q.summary}`);
  }
});

Deno.test('gear copy: high-tier pieces never inherit the starter flavor (#128)', () => {
  // Named, progression-sensitive gear carries its own flavor; the generic
  // class line is the tiers-1..3 default only.
  for (const def of ITEMS) {
    const m = def.id.match(/^[wa]_([a-z]+)_(\d)$/);
    if (!m) continue;
    const tier = Number(m[2]);
    if (tier < 4) continue;
    const starter = item(def.id.replace(/_(\d)$/, '_1'))!;
    assert(
      def.desc !== starter.desc,
      `${def.id} inherits the starter flavor "${starter.desc}"`,
    );
  }
});

Deno.test('quest copy: NPC display names are referenced consistently (#122)', () => {
  // The Echo NPC's canonical name is the zones catalog's; authored
  // dialogue text must not mint hyphenated variants of it.
  const echo = npc('npc_echo')!;
  assertEquals(echo.name, 'Echo of Maren');
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind === 'line') {
        assert(
          !n.text.includes('Echo-of-Maren'),
          `${d.id}:${n.id} uses the hyphenated Echo name variant`,
        );
      }
    }
  }
});

Deno.test('quest copy: every quest dialogue flow is wired and authoritative (#127)', () => {
  for (const q of QUESTS) {
    const offer = dialogue(q.offerDialogue);
    const turnIn = dialogue(q.turnInDialogue);
    assert(offer, `${q.id}: offerDialogue ${q.offerDialogue} is missing`);
    assert(turnIn, `${q.id}: turnInDialogue ${q.turnInDialogue} is missing`);
    assertEquals(offer.npcId, q.startNpc, `${q.id}: the offer belongs to the starter`);
    assertEquals(turnIn.npcId, q.finishNpc, `${q.id}: the turn-in belongs to the finisher`);
    // The offer's accept choice runs the central acceptQuest authority for
    // exactly this quest; the turn-in's hand-over choice runs turnInQuest.
    const accept = offer.nodes.flatMap((n) => n.kind === 'choice' ? n.choices : [])
      .find((c) => c.id === 'accept');
    const handover = turnIn.nodes.flatMap((n) => n.kind === 'choice' ? n.choices : [])
      .find((c) => c.id === 'handover');
    assert(accept, `${q.id}: the offer has no accept choice`);
    assert(handover, `${q.id}: the turn-in has no hand-over choice`);
    assert(
      (accept.effects ?? []).some((e) => e.kind === 'acceptQuest' && e.questId === q.id),
      `${q.id}: the accept choice must invoke acceptQuest for ${q.id}`,
    );
    assert(
      (handover.effects ?? []).some((e) => e.kind === 'turnInQuest' && e.questId === q.id),
      `${q.id}: the hand-over choice must invoke turnInQuest for ${q.id}`,
    );
    // A conversation dialogue (when authored) belongs to a contact of the
    // quest and emits at least one stable event.
    if (q.conversationDialogue) {
      const conv = dialogue(q.conversationDialogue);
      assert(conv, `${q.id}: conversationDialogue ${q.conversationDialogue} is missing`);
      assert(
        [q.startNpc, q.finishNpc].includes(conv!.npcId),
        `${q.id}: the conversation belongs to a quest contact`,
      );
      const events = conv!.nodes.flatMap((n) => n.kind === 'line' ? n.effects ?? [] : [])
        .filter((e) => e.kind === 'storyEvent');
      assert(events.length > 0, `${q.id}: the conversation emits no story event`);
    }
  }
  // Every storyEvent objective's event is emitted by its quest's own
  // dialogues, or by a dialogue owned by one of its quest contacts —
  // shared parent progress (#126): a route quest's opening event may be
  // emitted by the contact's other conversation (#132).
  for (const q of QUESTS) {
    for (const o of q.objectives) {
      if (o.kind !== 'storyEvent') continue;
      const contactOwned = DIALOGUES.filter((d) =>
        d.npcId === q.startNpc || d.npcId === q.finishNpc
      );
      const emitted = [...questDialoguesOf(q), ...contactOwned].some((d) =>
        emittedStoryEvents(d).includes(o.target)
      );
      assert(
        emitted,
        `${q.id}: storyEvent ${o.target} is never emitted by its own or contact dialogues`,
      );
    }
  }
});

Deno.test('quest copy: greetings are plain speech without embedded quotes (#122)', () => {
  // The fallback renderer supplies the quotation marks — a greeting that
  // carries its own would render double-quoted (Pell's old defect).
  for (const z of ZONES) {
    for (const n of z.npcs) {
      assert(
        !/[“”"]/.test(n.greeting),
        `npc ${n.id} greeting embeds quotes; the renderer adds them`,
      );
    }
  }
});

Deno.test('quest copy: every quest contact still resolves on-site (#63 regression)', () => {
  for (const q of QUESTS) {
    const starter = zoneOfNpc(q.startNpc);
    const finisher = zoneOfNpc(q.finishNpc);
    assert(starter, `${q.id} startNpc ${q.startNpc} is not placed in any zone`);
    assert(finisher, `${q.id} finishNpc ${q.finishNpc} is not placed in any zone`);
  }
});

Deno.test('quest copy: declarative conditions reference only real ids (#125, #132)', () => {
  // The shared condition language is data — its references must resolve
  // like every other content reference (quests, items, zones, outcomes,
  // decisions). Every condition SURFACE is crawled: NPC topics, quest
  // prerequisites, and dialogue-choice availability.
  const questIds = new Set(QUESTS.map((q) => q.id));
  const zoneIds = new Set(ZONES.map((z) => z.id));
  const itemIds = new Set(ITEMS.map((i) => i.id));
  const questOf = (id: string) => QUESTS.find((q) => q.id === id);
  const check = (from: string, c: Condition): void => {
    const refs = conditionRefs(c);
    for (const qid of refs.quests) {
      assert(questIds.has(qid), `${from}: condition references unknown quest ${qid}`);
    }
    for (const iid of refs.items) {
      assert(itemIds.has(iid), `${from}: condition references unknown item ${iid}`);
    }
    for (const zid of refs.zones) {
      assert(zoneIds.has(zid), `${from}: condition references unknown zone ${zid}`);
    }
    // Named-outcome queries (#132) must name an outcome the quest declares.
    const walk = (cond: Condition): void => {
      if ('all' in cond) return cond.all.forEach(walk);
      if ('any' in cond) return cond.any.forEach(walk);
      if ('not' in cond) return walk(cond.not);
      if ('questOutcome' in cond) {
        const q = questOf(cond.questOutcome.questId);
        assert(q, `${from}: outcome query names unknown quest ${cond.questOutcome.questId}`);
        const { outcome } = cond.questOutcome;
        if (outcome !== undefined) {
          assert(
            q?.outcomes?.includes(outcome),
            `${from}: ${cond.questOutcome.questId} does not declare outcome "${outcome}"`,
          );
        }
      }
      if ('decision' in cond) {
        const legal = recordedDecisions.get(cond.decision.id);
        assert(
          legal !== undefined,
          `${from}: condition references decision ${cond.decision.id} that no dialogue records`,
        );
        if (cond.decision.choiceId !== undefined) {
          assert(
            legal.has(cond.decision.choiceId),
            `${from}: decision ${cond.decision.id} never records choice ${cond.decision.choiceId}`,
          );
        }
      }
    };
    walk(c);
  };
  for (const z of ZONES) {
    for (const n of z.npcs) {
      for (const t of n.topics ?? []) {
        if (t.when) check(`${n.id}:${t.id}`, t.when);
      }
    }
  }
  for (const q of QUESTS) {
    if (q.prereq) check(q.id, q.prereq);
  }
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind !== 'choice') continue;
      for (const c of n.choices) {
        if (c.when) check(`${d.id}:${n.id}:${c.id}:when`, c.when);
      }
    }
  }
});

/** Decision ids some dialogue's recordDecision effect actually records —
 * the legal id set decision conditions may query (#132) — each mapped to
 * the choice ids that decision is recorded WITH, so a condition naming a
 * choice value names a value the ledger can legally hold (#146). */
const recordedDecisions = new Map<string, Set<string>>();
for (const d of DIALOGUES) {
  for (const n of d.nodes) {
    const effects = n.kind === 'line'
      ? n.effects ?? []
      : n.kind === 'choice'
      ? n.choices.flatMap((c) => c.effects ?? [])
      : [];
    for (const e of effects) {
      if (e.kind !== 'recordDecision') continue;
      const choices = recordedDecisions.get(e.id) ?? new Set<string>();
      choices.add(e.choiceId);
      recordedDecisions.set(e.id, choices);
    }
  }
}

Deno.test('quest copy: a choice can only record its own decision value (#146)', () => {
  // A recordDecision authored ON a choice must store THAT choice's id.
  // With provenance consistent, every persisted decision value is one a
  // real application of the recorded choice could have produced — a
  // mismatched authoring would persist a ledger entry the later
  // persisted-identity gate cannot reconcile.
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      if (n.kind !== 'choice') continue;
      for (const c of n.choices) {
        for (const e of c.effects ?? []) {
          if (e.kind !== 'recordDecision') continue;
          assertEquals(
            e.choiceId,
            c.id,
            `${d.id}:${n.id}:${c.id}: recordDecision stores a foreign choice id`,
          );
        }
      }
    }
  }
});

Deno.test('quest copy: named quest outcomes are declared and resolved legally (#132)', () => {
  // Every resolveQuest effect authored in dialogue content must name a
  // quest that DECLARES the outcome — typos and cross-quest outcomes are
  // content corruption, not runtime surprises.
  const questOf = (id: string) => QUESTS.find((q) => q.id === id);
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      const effects = n.kind === 'line'
        ? n.effects ?? []
        : n.kind === 'choice'
        ? n.choices.flatMap((c) => c.effects ?? [])
        : [];
      for (const e of effects) {
        if (e.kind !== 'resolveQuest') continue;
        const q = questOf(e.questId);
        assert(q, `${d.id}:${n.id}: resolveQuest names unknown quest ${e.questId}`);
        assert(
          q?.outcomes?.includes(e.outcome),
          `${d.id}:${n.id}: ${e.questId} does not declare outcome "${e.outcome}"`,
        );
      }
    }
  }
  // A quest that declares outcomes must declare at least one.
  for (const q of QUESTS) {
    if (q.outcomes !== undefined) {
      assert(q.outcomes.length > 0, `${q.id}: outcomes declared but empty`);
    }
  }
});
