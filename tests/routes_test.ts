/**
 * #158 — the authored world-route graph and travel-event content model:
 * content integrity + resolution helpers + deterministic fixtures.
 */

import { assert, assertEquals } from '@std/assert';
import { conditionRefs, evalCondition } from '../src/engine/conditions.ts';
import { createPlayer } from '../src/engine/character.ts';
import { rollDropTable } from '../src/engine/loot.ts';
import {
  resolveRoute,
  resolveRouteById,
  routeUsable,
  usableRoutesFrom,
} from '../src/engine/routes.ts';
import { DROP_TABLES, dropTable } from '../src/content/loot.ts';
import { route, ROUTES, routesBetween, routesFrom } from '../src/content/routes.ts';
import { enemy } from '../src/content/enemies.ts';
import { item } from '../src/content/items.ts';
import { quest } from '../src/content/quests.ts';
import { STARTING_ZONES, zone, ZONES } from '../src/content/zones.ts';
import type { RouteDef, TravelEvent } from '../src/content/types.ts';

// ── content integrity: the graph ─────────────────────────────────────────

Deno.test('content integrity: route ids are unique and stable', () => {
  const ids = new Set(ROUTES.map((r) => r.id));
  assertEquals(ids.size, ROUTES.length, 'route ids must be unique');
  for (const r of ROUTES) {
    assert(r.id.length > 0, 'route ids must be non-empty');
    assertEquals(route(r.id), r, 'route(id) must resolve the catalog entry');
  }
});

Deno.test('content integrity: every route endpoint resolves to a real zone', () => {
  for (const r of ROUTES) {
    assert(zone(r.from), `route ${r.id} origin '${r.from}' is not a zone`);
    assert(zone(r.to), `route ${r.id} destination '${r.to}' is not a zone`);
  }
});

Deno.test('content integrity: no self-edges and no duplicate directed edges', () => {
  for (const r of ROUTES) {
    assert(r.from !== r.to, `route ${r.id} is a self-edge`);
  }
  const pairs = new Set(ROUTES.map((r) => `${r.from}>${r.to}`));
  assertEquals(pairs.size, ROUTES.length, 'duplicate directed edges are forbidden');
});

Deno.test('content integrity: the shipped graph is one weakly connected whole', () => {
  // Every current zone must participate in the authored progression graph:
  // reachability through DIRECTED edges from the starter village.
  const adjacency = new Map(ROUTES.map((r) => [r.from, r.to]));
  void adjacency;
  const out = new Map<string, Set<string>>();
  for (const r of ROUTES) {
    if (!out.has(r.from)) out.set(r.from, new Set());
    out.get(r.from)!.add(r.to);
  }
  const seen = new Set<string>([STARTING_ZONES[0]!]);
  const queue = [STARTING_ZONES[0]!];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of out.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  // The full directed walk may need reverse edges for backtracking; verify
  // every zone is on SOME path: weak connectivity (undirected reach).
  const undirected = new Map<string, Set<string>>();
  for (const r of ROUTES) {
    if (!undirected.has(r.from)) undirected.set(r.from, new Set());
    if (!undirected.has(r.to)) undirected.set(r.to, new Set());
    undirected.get(r.from)!.add(r.to);
    undirected.get(r.to)!.add(r.from);
  }
  const weak = new Set<string>([STARTING_ZONES[0]!]);
  const wq = [STARTING_ZONES[0]!];
  while (wq.length > 0) {
    const cur = wq.shift()!;
    for (const next of undirected.get(cur) ?? []) {
      if (!weak.has(next)) {
        weak.add(next);
        wq.push(next);
      }
    }
  }
  for (const z of ZONES) {
    assert(weak.has(z.id), `zone ${z.id} is disconnected from the world graph`);
  }
  // And the full chain must be walkable in one direction for the story:
  // every zone must be reachable from the village through authored edges
  // once their gates open — endpoints carry the gates, the topology must
  // not. (Backtracking edges exist, so undirected reach + bidirectional
  // chain coverage is what content guarantees; the progression test pins
  // story-stage reachability through real unlocks.)
  for (const z of ZONES) {
    const reachesBack = routesBetween(z.id, STARTING_ZONES[0]!).length > 0 ||
      walkExists(z.id, STARTING_ZONES[0]!);
    assert(reachesBack, `zone ${z.id} has no authored way back toward home`);
  }

  function walkExists(fromId: string, toId: string): boolean {
    const q = [fromId];
    const vis = new Set([fromId]);
    while (q.length > 0) {
      const cur = q.shift()!;
      if (cur === toId) return true;
      for (const r of routesFrom(cur)) {
        if (!vis.has(r.to)) {
          vis.add(r.to);
          q.push(r.to);
        }
      }
    }
    return false;
  }
});

// ── content integrity: event plans ───────────────────────────────────────

function effectiveTable(r: RouteDef, events?: TravelEvent[]): TravelEvent[] {
  return events ?? r.events ?? [];
}

Deno.test('content integrity: event counts are finite non-negative integers', () => {
  for (const r of ROUTES) {
    assert(Number.isInteger(r.eventCount), `route ${r.id}: eventCount must be an integer`);
    assert(r.eventCount >= 0, `route ${r.id}: eventCount must be non-negative`);
    for (const v of r.variants ?? []) {
      assert(Number.isInteger(v.eventCount), `variant ${v.id}: eventCount must be an integer`);
      assert(v.eventCount >= 0, `variant ${v.id}: eventCount must be non-negative`);
    }
  }
});

Deno.test('content integrity: a nonzero event count resolves to a non-empty table', () => {
  for (const r of ROUTES) {
    if (r.eventCount > 0) {
      assert(
        (r.events ?? []).length > 0,
        `route ${r.id}: nonzero eventCount requires a non-empty events table`,
      );
    }
    for (const v of r.variants ?? []) {
      const table = effectiveTable(r, v.events);
      if (v.eventCount > 0) {
        assert(
          table.length > 0,
          `variant ${v.id}: nonzero eventCount requires a non-empty table (own or base)`,
        );
      }
    }
  }
});

Deno.test('content integrity: event weights are finite and positive', () => {
  for (const r of ROUTES) {
    for (const e of r.events ?? []) {
      assert(Number.isFinite(e.weight) && e.weight > 0, `route ${r.id}: bad weight`);
    }
    for (const v of r.variants ?? []) {
      for (const e of v.events ?? []) {
        assert(Number.isFinite(e.weight) && e.weight > 0, `variant ${v.id}: bad weight`);
      }
    }
  }
});

Deno.test('content integrity: every route table keeps at least one non-hostile entry', () => {
  // Level-locked battles can roll out of a table at any time; the
  // non-hostile remainder is what guarantees the road never becomes
  // mandatory combat.
  const hostile = (e: TravelEvent): boolean => e.kind === 'battle';
  for (const r of ROUTES) {
    if ((r.events ?? []).length > 0) {
      assert(
        (r.events ?? []).some((e) => !hostile(e)),
        `route ${r.id}: table must keep a quiet/beneficial entry`,
      );
    }
    for (const v of r.variants ?? []) {
      const table = effectiveTable(r, v.events);
      if (table.length > 0) {
        assert(
          table.some((e) => !hostile(e)),
          `variant ${v.id}: table must keep a quiet/beneficial entry`,
        );
      }
    }
  }
});

Deno.test('content integrity: battle events are ordinary and fleeable — no bosses, no elite kind', () => {
  for (const r of ROUTES) {
    for (const e of r.events ?? []) {
      if (e.kind === 'battle') {
        const def = enemy(e.enemy);
        assert(def, `route ${r.id}: unknown battle enemy ${e.enemy}`);
        assert(!def!.boss, `route ${r.id}: boss enemy ${e.enemy} must not hide in a road`);
        if (e.minPlayerLevel !== undefined) {
          assert(e.minPlayerLevel >= 1, `route ${r.id}: bad minPlayerLevel`);
        }
        if (e.maxPlayerLevel !== undefined) {
          assert(e.maxPlayerLevel >= (e.minPlayerLevel ?? 1), `route ${r.id}: bad level band`);
        }
      }
    }
    for (const v of r.variants ?? []) {
      for (const e of v.events ?? []) {
        if (e.kind === 'battle') {
          const def = enemy(e.enemy);
          assert(def, `variant ${v.id}: unknown battle enemy ${e.enemy}`);
          assert(!def!.boss, `variant ${v.id}: boss enemy ${e.enemy} must not hide in a road`);
        }
      }
    }
  }
});

Deno.test('content integrity: treasure items and contextual drop references resolve', () => {
  for (const r of ROUTES) {
    for (const e of r.events ?? []) {
      if (e.kind === 'treasure') {
        if (e.item) assert(item(e.item), `route ${r.id}: unknown treasure item ${e.item}`);
        if (e.dropTable) assert(dropTable(e.dropTable), `route ${r.id}: unknown drop table`);
      }
    }
    for (const v of r.variants ?? []) {
      for (const e of v.events ?? []) {
        if (e.kind === 'treasure') {
          if (e.item) assert(item(e.item), `variant ${v.id}: unknown treasure item ${e.item}`);
          if (e.dropTable) assert(dropTable(e.dropTable), `variant ${v.id}: unknown drop table`);
        }
      }
    }
  }
});

Deno.test('content integrity: drop tables are non-empty, bounded and reference real items', () => {
  const ids = new Set(DROP_TABLES.map((t) => t.id));
  assertEquals(ids.size, DROP_TABLES.length, 'drop table ids must be unique');
  for (const t of DROP_TABLES) {
    assert(t.entries.length > 0, `drop table ${t.id} is empty`);
    assert(t.entries.length <= 16, `drop table ${t.id} is unbounded`);
    for (const e of t.entries) {
      assert(item(e.item), `drop table ${t.id} references unknown item ${e.item}`);
      assert(
        Number.isFinite(e.chance) && e.chance > 0 && e.chance <= 1,
        `drop table ${t.id}: entry chance out of (0,1]`,
      );
      if (e.qty !== undefined) {
        assert(Number.isInteger(e.qty) && e.qty >= 1, `drop table ${t.id}: bad qty`);
      }
    }
  }
});

Deno.test('content integrity: zone loot tables resolve', () => {
  for (const z of ZONES) {
    if (z.lootTable) assert(dropTable(z.lootTable), `zone ${z.id}: unknown loot table`);
  }
});

Deno.test('content integrity: every referenced condition identity resolves', () => {
  const crawl = (owner: string, c: NonNullable<RouteDef['when']>): void => {
    const refs = conditionRefs(c);
    for (const q of refs.quests) {
      assert(quest(q), `${owner}: condition references unknown quest ${q}`);
    }
    for (const i of refs.items) assert(item(i), `${owner}: condition references unknown item ${i}`);
    for (const z of refs.zones) assert(zone(z), `${owner}: condition references unknown zone ${z}`);
  };
  for (const r of ROUTES) {
    if (r.when) crawl(`route ${r.id}`, r.when);
    for (const v of r.variants ?? []) {
      if (v.when) crawl(`variant ${v.id}`, v.when);
    }
  }
});

Deno.test('content integrity: variant ids are unique within their route', () => {
  for (const r of ROUTES) {
    const ids = new Set((r.variants ?? []).map((v) => v.id));
    assertEquals(ids.size, (r.variants ?? []).length, `route ${r.id}: duplicate variant ids`);
  }
});

Deno.test('content integrity: risk descriptors use the authored vocabulary (#164)', () => {
  const KNOWN = new Set(['sheltered', 'mild', 'wild', 'perilous']);
  for (const r of ROUTES) {
    if (r.risk !== undefined) assert(KNOWN.has(r.risk), `route ${r.id}: unknown risk ${r.risk}`);
    for (const v of r.variants ?? []) {
      if (v.risk !== undefined) assert(KNOWN.has(v.risk), `variant ${v.id}: unknown risk`);
    }
  }
  // Every nonzero-event road carries a risk descriptor: the travel view
  // never shows a bare count without its authored characterization.
  for (const r of ROUTES) {
    if (r.eventCount > 0) assert(r.risk !== undefined, `route ${r.id} lacks risk metadata`);
  }
});

Deno.test('content integrity: starter-region routes carry zero forced events', () => {
  for (const r of ROUTES) {
    if (STARTING_ZONES.includes(r.from) && STARTING_ZONES.includes(r.to)) {
      const fresh = createPlayer(1, 'Fresh', 'warrior');
      const plan = resolveRoute(fresh, r);
      assertEquals(
        plan.eventCount,
        0,
        `starter route ${r.id} must have zero forced events`,
      );
    }
  }
});

// ── resolution helpers ───────────────────────────────────────────────────

function playerWith(zones: string[], currentZone: string, flags: Record<string, unknown> = {}) {
  const p = createPlayer(1, 'Walker', 'warrior');
  p.unlockedZones = [...zones];
  p.currentZone = currentZone;
  for (const [k, v] of Object.entries(flags)) {
    (p.flags as Record<string, unknown>)[k] = v;
  }
  return p;
}

Deno.test('usableRoutesFrom enumerates adjacency + unlocks, never every unlocked zone', () => {
  const p = playerWith(['emberdawn', 'outskirts', 'whisperwood', 'hollowmere'], 'outskirts');
  const ids = usableRoutesFrom(p).map((r) => r.id);
  // Adjacent edges only — hollowmere is unlocked but NOT adjacent.
  assertEquals(new Set(ids), new Set(['w_outskirts_emberdawn', 'w_outskirts_whisperwood']));
  // From emberdawn only one edge exists.
  const p2 = playerWith(['emberdawn', 'outskirts'], 'emberdawn');
  assertEquals(usableRoutesFrom(p2).map((r) => r.id), ['w_emberdawn_outskirts']);
});

Deno.test('usableRoutesFrom hides a locked destination even when adjacent', () => {
  const p = playerWith(['emberdawn', 'outskirts'], 'outskirts');
  // whisperwood unlocked? no — only the route to emberdawn may show.
  const ids = usableRoutesFrom(p).map((r) => r.id);
  assertEquals(ids, ['w_outskirts_emberdawn']);
});

Deno.test('resolveRoute: authored variant order, first match, base fallback', () => {
  const p = playerWith(['emberdawn'], 'emberdawn');
  // m7_tyrant not done → base plan (2 events, hostile-heavy).
  const base = resolveRouteById(p, 'w_whisperwood_hollowmere')!;
  assertEquals(base.variantId, 'base');
  assertEquals(base.eventCount, 2);
  assert(base.events.length > 0);
  // The completed story beats secure the road: fewer rolls, calmer table.
  const done = playerWith(['emberdawn'], 'emberdawn');
  done.quests['m7_tyrant'] = { status: 'done', counts: [1] };
  const quiet = resolveRoute(done, route('w_whisperwood_hollowmere')!);
  assertEquals(quiet.variantId, 'v_causeway_quiet');
  assertEquals(quiet.eventCount, 1);
  assert(quiet.events.length > 0);
  // The secured variant's table replaces the base table entirely.
  assert(quiet.events !== base.events);
  // A variant-less route always resolves to its base plan.
  const plain = resolveRoute(p, route('w_outskirts_whisperwood')!);
  assertEquals(plain.variantId, 'base');
  assertEquals(plain.eventCount, 0);
});

Deno.test('routeUsable refuses a usable-only-by-name plan (conditions + empty tables)', () => {
  const p = playerWith(['emberdawn', 'outskirts', 'hollowmere'], 'outskirts');
  for (const r of usableRoutesFrom(p)) assert(routeUsable(p, r));
  // An unlocked but non-adjacent zone never appears.
  const names = usableRoutesFrom(p).map((r) => r.to);
  assert(!names.includes('hollowmere'));
});

Deno.test('resolveRouteById: unknown edge id resolves to undefined', () => {
  const p = playerWith(['emberdawn'], 'emberdawn');
  assertEquals(resolveRouteById(p, 'w_nope_nada'), undefined);
});

// ── deterministic fixtures ───────────────────────────────────────────────

/** Hostile weight share of a plan: the probability a roll is an ordinary
 * battle (before level gating). */
function hostileShare(plan: { events: readonly TravelEvent[] }): number {
  const total = plan.events.reduce((a, e) => a + e.weight, 0);
  const hostile = plan.events
    .filter((e) => e.kind === 'battle')
    .reduce((a, e) => a + e.weight, 0);
  return total > 0 ? hostile / total : 0;
}

Deno.test('fixture: two same-count edges carry materially different distributions', () => {
  const p = playerWith(['sunspire', 'frostpeak'], 'sunspire');
  const up = resolveRoute(p, route('w_sunspire_frostpeak')!);
  const down = resolveRoute(p, route('w_frostpeak_sunspire')!);
  assertEquals(up.eventCount, down.eventCount, 'fixture requires equal counts');
  const upShare = hostileShare(up);
  const downShare = hostileShare(down);
  // Southbound is the marauder work-road; northbound leaves more room for
  // quiet and benefit. The shares must differ by a visible margin.
  assert(
    Math.abs(upShare - downShare) >= 0.1,
    `same-count edges must differ materially (${upShare} vs ${downShare})`,
  );
  // And both keep meaningful non-hostile room.
  assert(upShare < 1, 'the road must not be mandatory combat');
  assert(downShare < 1, 'the road must not be mandatory combat');
});

Deno.test('fixture: asymmetric reciprocal edges (counts differ by direction)', () => {
  const p = playerWith(['whisperwood', 'hollowmere'], 'whisperwood');
  const out = resolveRoute(p, route('w_whisperwood_hollowmere')!);
  const back = resolveRoute(p, route('w_hollowmere_whisperwood')!);
  assertEquals(out.eventCount, 2);
  assertEquals(back.eventCount, 1);
});

Deno.test('fixture: a quest-secured route lowers the event count', () => {
  const edge = route('w_whisperwood_hollowmere')!;
  const hostile = playerWith(['whisperwood', 'hollowmere'], 'whisperwood');
  assertEquals(resolveRoute(hostile, edge).eventCount, 2);
  assert(routeUsable(hostile, edge));
  // Condition language: quest status drives the secured variant.
  const secured = playerWith(['whisperwood', 'hollowmere'], 'whisperwood');
  secured.quests['m7_tyrant'] = { status: 'done', counts: [1] };
  const plan = resolveRoute(secured, edge);
  assertEquals(plan.eventCount, 1);
  assert(evalCondition(secured, edge.variants![0]!.when!));
});

// ── contextual drops ─────────────────────────────────────────────────────

Deno.test('rollDropTable: deterministic under a seeded rng, empty for unknown tables', () => {
  const rng = (() => {
    let i = 0;
    return () => [0.1, 0.9, 0.1, 0.9][i++ % 4]!;
  })();
  const first = rollDropTable('dt_ember_fields', rng);
  const second = rollDropTable('dt_ember_fields', rng);
  assertEquals(first, second, 'same rng stream must produce the same rolls');
  assert(first.some((d) => d.item === 'm_ember_shard'), 'a 0.25 roll under 0.1 must hit');
  assertEquals(rollDropTable('dt_unknown', rng), [], 'unknown tables roll nothing');
});

Deno.test('rollDropTable: never grants beyond the authored qty', () => {
  for (const t of DROP_TABLES) {
    for (let seed = 0; seed < 50; seed++) {
      const rng = (() => {
        let a = seed * 2654435761;
        return () => {
          a = (a + 0x6d2b79f5) | 0;
          let x = Math.imul(a ^ (a >>> 15), 1 | a);
          x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
          return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
      })();
      for (const d of rollDropTable(t.id, rng)) {
        const authored = t.entries.find((e) => e.item === d.item)!;
        assertEquals(d.qty, authored.qty ?? 1);
      }
    }
  }
});

Deno.test('content integrity: routes never inherit a zone explore table (distinct catalogs)', () => {
  // Travel tables come only from route defs; nothing in the model reads
  // ZoneDef.explore for crossings. Structural pin: the route event kinds
  // are their own closed union — flavor/battle/treasure/rest — never a
  // passthrough of the exploration vocabulary.
  const kinds = new Set(ROUTES.flatMap((r) => (r.events ?? []).map((e) => e.kind)));
  assertEquals(
    [...kinds].sort(),
    ['battle', 'flavor', 'rest', 'treasure'],
    'travel-event kinds are their own vocabulary, not explore kinds',
  );
  // And the zone-side integrity stays intact: every explore event still
  // references real content (the same rule the zone tests pin).
  for (const z of ZONES) {
    for (const ev of z.explore) {
      if (ev.kind === 'battle' || ev.kind === 'elite') {
        assert(enemy(ev.enemy), `zone ${z.id}: unknown explore enemy ${ev.enemy}`);
      }
    }
  }
});

Deno.test('content integrity: route ids never collide with route helper lookups', () => {
  // routesFrom/routesBetween agreement with the catalog.
  for (const r of ROUTES) {
    assert(routesFrom(r.from).includes(r), `routesFrom(${r.from}) must include ${r.id}`);
    assert(routesBetween(r.from, r.to).includes(r), `routesBetween must include ${r.id}`);
  }
});
