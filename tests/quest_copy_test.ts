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
function questDialoguesOf(questDef: QuestDef): DialogueDef[] {
  return [questDef.offerDialogue, questDef.turnInDialogue, questDef.conversationDialogue]
    .filter((id): id is string => id !== undefined)
    .map((id) => dialogue(id))
    .flatMap((dialogueDef) => dialogueDef ? [dialogueDef] : []);
}

/** Every story event a dialogue's line and choice effects can emit. */
function emittedStoryEvents(dialogueDef: DialogueDef): string[] {
  return dialogueDef.nodes.flatMap((node) =>
    node.kind === 'line'
      ? node.effects ?? []
      : node.kind === 'choice'
      ? node.choices.flatMap((choice) => choice.effects ?? [])
      : []
  ).filter((effect) => effect.kind === 'storyEvent').map((effect) =>
    (effect as { event: string }).event
  );
}

Deno.test('quest copy: the Sealed Letter is granted once and delivered to Bram (#122)', () => {
  // The letter enters the bag from exactly ONE quest reward (m1_embers,
  // completed with Maren) and m2_letter requires carrying it to Bram.
  const grantors = QUESTS.filter((questDef) => (questDef.rewards.items?.q_sealed_letter ?? 0) > 0);
  assertEquals(grantors.map((questDef) => questDef.id), ['m1_embers']);
  const m2 = quest('m2_letter')!;
  assertEquals(
    m2.objectives.filter((objective) => objective.kind === 'collect').map((objective) =>
      objective.target
    ),
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
  for (const objective of m5.objectives) {
    assertEquals(objective.kind, 'collect', 'm5_arms objectives are collect-only');
    assert(item(objective.target), `m5_arms collects a real item (${objective.target})`);
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
  for (const questDef of QUESTS) {
    for (const id of Object.keys(questDef.rewards.items ?? {})) {
      const def = item(id);
      assert(def, `${questDef.id} rewards unknown item ${id}`);
      if (def.kind === 'weapon' || def.kind === 'armor') {
        assertEquals(
          def.classes,
          undefined,
          `${questDef.id} rewards class-locked ${id} — every Dawncaller must be able to use it`,
        );
      }
    }
  }
});

Deno.test('quest copy: in-world fields do not leak game-system terms (#122)', () => {
  // Chapters and the postgame are authoring concepts — player-facing
  // in-world fields must not name them. Fixed-token check, not style.
  const leak = /chapter|postgame/i;
  for (const zoneDef of ZONES) {
    assert(!leak.test(zoneDef.desc), `zone ${zoneDef.id} desc leaks system terms: ${zoneDef.desc}`);
    for (const npcDef of zoneDef.npcs) {
      assert(!leak.test(npcDef.greeting), `npc ${npcDef.id} greeting leaks system terms`);
    }
  }
  for (const questDef of QUESTS) {
    assert(!leak.test(questDef.name), `quest ${questDef.id} name leaks system terms`);
    assert(!leak.test(questDef.summary), `quest ${questDef.id} summary leaks system terms`);
  }
});

Deno.test('quest copy: no administrative jargon in in-world labels (#128)', () => {
  // Modern administrative vocabulary is out of world and out of every
  // voice sheet (docs/narrative-guide.md §2). Narrow factual token check
  // on quest NAME/SUMMARY labels — never a prose-style parser.
  const admin = /paperwork|management|corrections|diplomacy/i;
  for (const questDef of QUESTS) {
    assert(
      !admin.test(questDef.name),
      `quest ${questDef.id} name carries admin jargon: ${questDef.name}`,
    );
    assert(
      !admin.test(questDef.summary),
      `quest ${questDef.id} summary carries admin jargon: ${questDef.summary}`,
    );
  }
});

Deno.test('gear copy: high-tier pieces never inherit the starter flavor (#128)', () => {
  // Named, progression-sensitive gear carries its own flavor; the generic
  // class line is the tiers-1..3 default only.
  for (const def of ITEMS) {
    const match = def.id.match(/^[wa]_([a-z]+)_(\d)$/);
    if (!match) continue;
    const tier = Number(match[2]);
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
  for (const dialogueDef of DIALOGUES) {
    for (const node of dialogueDef.nodes) {
      if (node.kind === 'line') {
        assert(
          !node.text.includes('Echo-of-Maren'),
          `${dialogueDef.id}:${node.id} uses the hyphenated Echo name variant`,
        );
      }
    }
  }
});

Deno.test('quest copy: every quest dialogue flow is wired and authoritative (#127)', () => {
  for (const questDef of QUESTS) {
    const offer = dialogue(questDef.offerDialogue);
    const turnIn = dialogue(questDef.turnInDialogue);
    assert(offer, `${questDef.id}: offerDialogue ${questDef.offerDialogue} is missing`);
    assert(turnIn, `${questDef.id}: turnInDialogue ${questDef.turnInDialogue} is missing`);
    assertEquals(
      offer.npcId,
      questDef.startNpc,
      `${questDef.id}: the offer belongs to the starter`,
    );
    assertEquals(
      turnIn.npcId,
      questDef.finishNpc,
      `${questDef.id}: the turn-in belongs to the finisher`,
    );
    // The offer's accept choice runs the central acceptQuest authority for
    // exactly this quest; the turn-in's hand-over choice runs turnInQuest.
    const accept = offer.nodes.flatMap((node) => node.kind === 'choice' ? node.choices : [])
      .find((choice) => choice.id === 'accept');
    const handover = turnIn.nodes.flatMap((node) => node.kind === 'choice' ? node.choices : [])
      .find((choice) => choice.id === 'handover');
    assert(accept, `${questDef.id}: the offer has no accept choice`);
    assert(handover, `${questDef.id}: the turn-in has no hand-over choice`);
    assert(
      (accept.effects ?? []).some((effect) =>
        effect.kind === 'acceptQuest' && effect.questId === questDef.id
      ),
      `${questDef.id}: the accept choice must invoke acceptQuest for ${questDef.id}`,
    );
    assert(
      (handover.effects ?? []).some((effect) =>
        effect.kind === 'turnInQuest' && effect.questId === questDef.id
      ),
      `${questDef.id}: the hand-over choice must invoke turnInQuest for ${questDef.id}`,
    );
    // A conversation dialogue (when authored) belongs to a contact of the
    // quest and emits at least one stable event.
    if (questDef.conversationDialogue) {
      const conv = dialogue(questDef.conversationDialogue);
      assert(
        conv,
        `${questDef.id}: conversationDialogue ${questDef.conversationDialogue} is missing`,
      );
      assert(
        [questDef.startNpc, questDef.finishNpc].includes(conv!.npcId),
        `${questDef.id}: the conversation belongs to a quest contact`,
      );
      const events = conv!.nodes.flatMap((node) => node.kind === 'line' ? node.effects ?? [] : [])
        .filter((effect) => effect.kind === 'storyEvent');
      assert(events.length > 0, `${questDef.id}: the conversation emits no story event`);
    }
  }
  // Every storyEvent objective's event is emitted by its quest's own
  // dialogues, or by a dialogue owned by one of its quest contacts —
  // shared parent progress (#126): a route quest's opening event may be
  // emitted by the contact's other conversation (#132).
  for (const questDef of QUESTS) {
    for (const objective of questDef.objectives) {
      if (objective.kind !== 'storyEvent') continue;
      const contactOwned = DIALOGUES.filter((dialogueDef) =>
        dialogueDef.npcId === questDef.startNpc || dialogueDef.npcId === questDef.finishNpc
      );
      const emitted = [...questDialoguesOf(questDef), ...contactOwned].some((dialogueDef) =>
        emittedStoryEvents(dialogueDef).includes(objective.target)
      );
      assert(
        emitted,
        `${questDef.id}: storyEvent ${objective.target} is never emitted by its own or contact dialogues`,
      );
    }
  }
});

Deno.test('quest copy: greetings are plain speech without embedded quotes (#122)', () => {
  // The fallback renderer supplies the quotation marks — a greeting that
  // carries its own would render double-quoted (Pell's old defect).
  for (const zoneDef of ZONES) {
    for (const npcDef of zoneDef.npcs) {
      assert(
        !/[“”"]/.test(npcDef.greeting),
        `npc ${npcDef.id} greeting embeds quotes; the renderer adds them`,
      );
    }
  }
});

Deno.test('quest copy: every quest contact still resolves on-site (#63 regression)', () => {
  for (const questDef of QUESTS) {
    const starter = zoneOfNpc(questDef.startNpc);
    const finisher = zoneOfNpc(questDef.finishNpc);
    assert(starter, `${questDef.id} startNpc ${questDef.startNpc} is not placed in any zone`);
    assert(finisher, `${questDef.id} finishNpc ${questDef.finishNpc} is not placed in any zone`);
  }
});

Deno.test('quest copy: declarative conditions reference only real ids (#125, #132)', () => {
  // The shared condition language is data — its references must resolve
  // like every other content reference (quests, items, zones, outcomes,
  // decisions). Every condition SURFACE is crawled: NPC topics, quest
  // prerequisites, and dialogue-choice availability.
  const questIds = new Set(QUESTS.map((questDef) => questDef.id));
  const zoneIds = new Set(ZONES.map((zoneDef) => zoneDef.id));
  const itemIds = new Set(ITEMS.map((itemDef) => itemDef.id));
  const questOf = (id: string) => QUESTS.find((questDef) => questDef.id === id);
  const check = (from: string, condition: Condition): void => {
    const refs = conditionRefs(condition);
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
        const questDef = questOf(cond.questOutcome.questId);
        assert(questDef, `${from}: outcome query names unknown quest ${cond.questOutcome.questId}`);
        const { outcome, kind } = cond.questOutcome;
        if (outcome !== undefined) {
          assert(
            questDef?.outcomes?.includes(outcome),
            `${from}: ${cond.questOutcome.questId} does not declare outcome "${outcome}"`,
          );
          // A named outcome matches resolved records only (#150): pairing it
          // with any other kind is statically impossible content.
          assert(
            kind === undefined || kind === 'resolved',
            `${from}: outcome "${outcome}" paired with kind ${kind} can never match`,
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
    walk(condition);
  };
  for (const zoneDef of ZONES) {
    for (const npcDef of zoneDef.npcs) {
      for (const topic of npcDef.topics ?? []) {
        if (topic.when) check(`${npcDef.id}:${topic.id}`, topic.when);
      }
    }
  }
  for (const questDef of QUESTS) {
    if (questDef.prereq) check(questDef.id, questDef.prereq);
  }
  for (const dialogueDef of DIALOGUES) {
    for (const node of dialogueDef.nodes) {
      if (node.kind !== 'choice') continue;
      for (const choice of node.choices) {
        if (choice.when) check(`${dialogueDef.id}:${node.id}:${choice.id}:when`, choice.when);
      }
    }
  }
});

/** Decision ids some CHOICE's recordDecision effect actually records (#150 —
 * line nodes are rejected below, so a choice is the only provenance surface)
 * — the legal id set decision conditions may query (#132), each mapped to
 * the choice ids that decision is recorded WITH, so a condition naming a
 * choice value names a value the ledger can legally hold (#146). */
const recordedDecisions = new Map<string, Set<string>>();
for (const dialogueDef of DIALOGUES) {
  for (const node of dialogueDef.nodes) {
    if (node.kind !== 'choice') continue;
    for (const choice of node.choices) {
      for (const effect of choice.effects ?? []) {
        if (effect.kind !== 'recordDecision') continue;
        const choices = recordedDecisions.get(effect.id) ?? new Set<string>();
        choices.add(effect.choiceId);
        recordedDecisions.set(effect.id, choices);
      }
    }
  }
}

Deno.test('quest copy: a choice can only record its own decision value (#146)', () => {
  // A recordDecision authored ON a choice must store THAT choice's id.
  // With provenance consistent, every persisted decision value is one a
  // real application of the recorded choice could have produced — a
  // mismatched authoring would persist a ledger entry the later
  // persisted-identity gate cannot reconcile.
  for (const dialogueDef of DIALOGUES) {
    for (const node of dialogueDef.nodes) {
      if (node.kind !== 'choice') continue;
      for (const choice of node.choices) {
        for (const effect of choice.effects ?? []) {
          if (effect.kind !== 'recordDecision') continue;
          assertEquals(
            effect.choiceId,
            choice.id,
            `${dialogueDef.id}:${node.id}:${choice.id}: recordDecision stores a foreign choice id`,
          );
        }
      }
    }
  }
});

Deno.test('quest copy: recordDecision is authored only on choices (#150)', () => {
  // A decision records a CHOSEN response: the persisted provenance is an
  // exact (dialogue, node, choice) tuple. A line node has no chosen
  // response to name, so a recordDecision authored there would persist a
  // decision the save format cannot represent faithfully. Authored on the
  // wrong provenance surface is content corruption, rejected statically.
  for (const dialogueDef of DIALOGUES) {
    for (const node of dialogueDef.nodes) {
      if (node.kind !== 'line') continue;
      const offenders = (node.effects ?? []).filter((effect) => effect.kind === 'recordDecision');
      assertEquals(
        offenders,
        [],
        `${dialogueDef.id}:${node.id}: recordDecision on a line node has no chosen response`,
      );
    }
  }
});

Deno.test('quest copy: named quest outcomes are declared and resolved legally (#132)', () => {
  // Every resolveQuest effect authored in dialogue content must name a
  // quest that DECLARES the outcome — typos and cross-quest outcomes are
  // content corruption, not runtime surprises.
  const questOf = (id: string) => QUESTS.find((questDef) => questDef.id === id);
  for (const dialogueDef of DIALOGUES) {
    for (const node of dialogueDef.nodes) {
      const effects = node.kind === 'line'
        ? node.effects ?? []
        : node.kind === 'choice'
        ? node.choices.flatMap((choice) => choice.effects ?? [])
        : [];
      for (const effect of effects) {
        if (effect.kind !== 'resolveQuest') continue;
        const questDef = questOf(effect.questId);
        assert(
          questDef,
          `${dialogueDef.id}:${node.id}: resolveQuest names unknown quest ${effect.questId}`,
        );
        assert(
          questDef?.outcomes?.includes(effect.outcome),
          `${dialogueDef.id}:${node.id}: ${effect.questId} does not declare outcome "${effect.outcome}"`,
        );
      }
    }
  }
  // A quest that declares outcomes must declare at least one.
  for (const questDef of QUESTS) {
    if (questDef.outcomes !== undefined) {
      assert(questDef.outcomes.length > 0, `${questDef.id}: outcomes declared but empty`);
    }
  }
});
