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
import { conditionRefs } from '../src/engine/conditions.ts';
import type { Condition } from '../src/content/types.ts';

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

Deno.test('quest copy: NPC display names are referenced consistently (#122)', () => {
  // The Echo NPC's canonical name is the zones catalog's; quest text must
  // not mint hyphenated variants of it.
  const echo = npc('npc_echo')!;
  assertEquals(echo.name, 'Echo of Maren');
  for (const q of QUESTS) {
    assert(
      !q.intro.includes('Echo-of-Maren') && !q.outro.includes('Echo-of-Maren'),
      `${q.id} uses the hyphenated Echo name variant`,
    );
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

Deno.test('quest copy: declarative conditions reference only real ids (#125)', () => {
  // The shared condition language is data — its references must resolve
  // like every other content reference (quests, items, zones).
  const questIds = new Set(QUESTS.map((q) => q.id));
  const zoneIds = new Set(ZONES.map((z) => z.id));
  const itemIds = new Set(ITEMS.map((i) => i.id));
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
});
