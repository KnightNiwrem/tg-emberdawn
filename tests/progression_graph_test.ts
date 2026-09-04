/** #162 — progression-aware graph validation.
 *
 * The full-campaign test proves the CANONICAL seeds complete; this file
 * proves the GRAPH and its content stay traversable at every story stage,
 * independent of the harness policy:
 *
 * - at each main-quest turn-in snapshot, every unlocked zone (shops,
 *   forges, havens, regions) is reachable through currently usable edges;
 * - every quest a player can hold at that stage has its starter and
 *   finisher NPCs graph-reachable;
 * - reach objectives point at reachable zones;
 * - the full end-state graph is connected, trap-free (every zone can get
 *   back to Emberdawn), and every eventful road rolls something eligible
 *   at its destination's band floor;
 * - mandatory items (dungeon gates, first clears, main-quest collect
 *   objectives) all have at least one source that is NOT a luck-locked
 *   travel treasure.
 */
import { assert, assertEquals } from '@std/assert';
import { driveQuests, exploreDropZonesFor } from '../src/engine/balance.ts';
import { dungeonOf, encounterEligible } from '../src/engine/world.ts';
import { usableRoutesFrom } from '../src/engine/routes.ts';
import type { PlayerState } from '../src/engine/types.ts';
import { enemy as enemyDef } from '../src/content/enemies.ts';
import { item as itemDef } from '../src/content/items.ts';
import { quest, QUESTS, zoneOfNpc } from '../src/content/quests.ts';
import { ROUTES } from '../src/content/routes.ts';
import { zone as zoneDef, ZONES } from '../src/content/zones.ts';
import { SHOPS } from '../src/content/facilities.ts';

const ALL_MAINS = QUESTS.filter((q) => q.main).map((q) => q.id);
const SEED = 20260902;

/** BFS over currently usable edges from the state's zone. */
function reachable(p: PlayerState): Set<string> {
  const seen = new Set<string>([p.currentZone]);
  const queue = [p.currentZone];
  while (queue.length > 0) {
    const z = queue.shift()!;
    for (const r of usableRoutesFrom({ ...p, currentZone: z })) {
      if (!seen.has(r.to)) {
        seen.add(r.to);
        queue.push(r.to);
      }
    }
  }
  return seen;
}

function npcZone(npcId: string): string | undefined {
  return zoneOfNpc(npcId)?.id;
}

/** Every source for an item that does NOT depend on rolling a specific
 * travel treasure: wild explore tables, dungeon floors, shop shelves,
 * other quests' rewards. */
function nonTravelSources(id: string): string[] {
  const src: string[] = [];
  for (const z of ZONES) {
    if (exploreDropZonesFor(id, [z.id], z.levels[1]).length > 0) src.push(`explore@${z.id}`);
    const d = z.dungeon ? dungeonOf(z) : undefined;
    if (d) src.push(`dungeon@${d.id}`);
  }
  for (const s of SHOPS) {
    if (s.stock.some((r) => r.items.includes(id))) src.push(`shop@${s.id}`);
  }
  for (const q of QUESTS) {
    if (q.rewards.items && q.rewards.items[id] > 0) src.push(`quest@${q.id}`);
  }
  return src;
}

Deno.test('progression: the story graph stays traversable at every turn-in snapshot (#162)', () => {
  const snaps: { questId: string; p: PlayerState }[] = [];
  const rep = driveQuests(
    'warrior',
    SEED,
    ALL_MAINS,
    'm25_silence',
    (p, qid) => snaps.push({ questId: qid, p: structuredClone(p) }),
  );
  assert(rep.campaignDone, 'the snapshot driver completes the campaign');
  assertEquals(
    snaps.length,
    ALL_MAINS.length,
    'every main quest turn-in is observed exactly once',
  );

  let last: PlayerState | undefined;
  for (const { questId, p } of snaps) {
    const ctx = `${questId}@L${p.level}`;
    const seen = reachable(p);
    // 1. No unlocked zone is a dead end: everything the story has opened
    // must be physically walkable from where the hero stands.
    for (const zid of p.unlockedZones) {
      assert(seen.has(zid), `${ctx}: unlocked zone ${zid} is disconnected`);
    }
    // 2. Facilities and havens ride the same rule — called out for the
    // issue's "facilities reachable when required" clause.
    for (const z of ZONES) {
      if (!p.unlockedZones.includes(z.id) || !z.services) continue;
      assert(seen.has(z.id), `${ctx}: facility zone ${z.id} unreachable`);
    }
    // 3. Every quest the player can hold right now has both contacts on
    // the traversable map.
    for (const qid of ALL_MAINS) {
      const st = p.quests[qid]?.status;
      if (st !== 'available' && st !== 'active' && st !== 'turnIn') continue;
      const q = quest(qid);
      assert(q, `${ctx}: tracked quest ${qid} exists`);
      const start = npcZone(q.startNpc);
      const finish = npcZone(q.finishNpc);
      assert(start && seen.has(start), `${ctx}: ${qid} starter zone ${start} unreachable`);
      assert(finish && seen.has(finish), `${ctx}: ${qid} finisher zone ${finish} unreachable`);
      // 4. Reach objectives point at walkable destinations.
      if (st === 'active') {
        for (const o of q.objectives) {
          if (o.kind !== 'reach') continue;
          assert(
            p.unlockedZones.includes(o.target) && seen.has(o.target),
            `${ctx}: ${qid} reach objective ${o.target} unreachable`,
          );
        }
      }
    }
    last = p;
  }
  assert(last, 'at least one snapshot observed');

  // ── End-state graph facts (all zones unlocked, story resolved) ──
  const end = last!;
  const endSeen = reachable({ ...end, currentZone: 'emberdawn' });
  for (const z of ZONES) {
    assert(endSeen.has(z.id), `end state: zone ${z.id} is disconnected from Emberdawn`);
  }
  // One-way traps: every node must be able to reach Emberdawn again.
  for (const z of ZONES) {
    const back = reachable({ ...end, currentZone: z.id });
    assert(back.has('emberdawn'), `end state: ${z.id} is a one-way trap (no road home)`);
  }
});

Deno.test('progression: every eventful road rolls something eligible at its destination band (#162)', () => {
  for (const r of ROUTES) {
    if (r.eventCount <= 0) continue;
    const dest = zoneDef(r.to);
    assert(dest, `${r.id}: destination ${r.to} exists`);
    const floor = dest.levels[0];
    const tables: { label: string; events: NonNullable<typeof r.events> }[] = [];
    if (r.events) tables.push({ label: 'base', events: r.events });
    for (const v of r.variants ?? []) {
      if (v.events) tables.push({ label: v.id, events: v.events });
    }
    assert(tables.length > 0, `${r.id}: eventful road authors a table`);
    for (const { label, events } of tables) {
      const live = events.filter((e) =>
        e.weight > 0 && encounterEligible(e, floor) &&
        (e.kind !== 'battle' || enemyDef(e.enemy) !== undefined) &&
        (e.kind !== 'treasure' || !e.item || itemDef(e.item) !== undefined)
      );
      assert(
        live.length > 0,
        `${r.id}/${label}: no eligible result at ${r.to} band floor L${floor}`,
      );
    }
  }
});

Deno.test('progression: mandatory items never come only from luck-locked travel loot (#162)', () => {
  const mandatory = new Map<string, string>();
  for (const q of QUESTS.filter((q) => q.main)) {
    for (const o of q.objectives) {
      if (o.kind === 'collect') mandatory.set(o.target, `main-quest ${q.id} collect`);
    }
  }
  for (const z of ZONES) {
    const d = z.dungeon ? dungeonOf(z) : undefined;
    if (!d) continue;
    if (d.bossGate?.item) mandatory.set(d.bossGate.item, `${d.id} boss gate key`);
    if (d.firstClear?.item) mandatory.set(d.firstClear.item, `${d.id} first clear`);
  }
  assert(mandatory.size > 0, 'the campaign authors mandatory items');
  for (const [id, why] of mandatory) {
    assert(itemDef(id) !== undefined, `${id} (${why}): item exists`);
    const src = nonTravelSources(id);
    assert(
      src.length > 0,
      `${id} (${why}): no renewable source — only luck-locked travel loot could grant it`,
    );
  }
});
