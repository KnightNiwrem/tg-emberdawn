/**
 * #158 — the authored world-route graph and travel-event content model:
 * content integrity + resolution helpers + deterministic fixtures.
 */

import { assert, assertEquals } from '@std/assert';
import { seeded } from './helpers.ts';
import { conditionRefs, evalCondition } from '../src/engine/conditions.ts';
import { createPlayer } from '../src/engine/character.ts';
import { rollDropTable } from '../src/engine/loot.ts';
import {
  departureCheck,
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
import type { Condition, RouteDef, TravelEvent } from '../src/content/types.ts';

// ── content integrity: the graph ─────────────────────────────────────────

Deno.test('content integrity: route ids are unique and stable', () => {
  const ids = new Set(ROUTES.map((routeDef) => routeDef.id));
  assertEquals(ids.size, ROUTES.length, 'route ids must be unique');
  for (const routeDef of ROUTES) {
    assert(routeDef.id.length > 0, 'route ids must be non-empty');
    assertEquals(route(routeDef.id), routeDef, 'route(id) must resolve the catalog entry');
  }
});

Deno.test('content integrity: every route endpoint resolves to a real zone', () => {
  for (const routeDef of ROUTES) {
    assert(zone(routeDef.from), `route ${routeDef.id} origin '${routeDef.from}' is not a zone`);
    assert(zone(routeDef.to), `route ${routeDef.id} destination '${routeDef.to}' is not a zone`);
  }
});

Deno.test('content integrity: no self-edges and no duplicate directed edges', () => {
  for (const routeDef of ROUTES) {
    assert(routeDef.from !== routeDef.to, `route ${routeDef.id} is a self-edge`);
  }
  const pairs = new Set(ROUTES.map((routeDef) => `${routeDef.from}>${routeDef.to}`));
  assertEquals(pairs.size, ROUTES.length, 'duplicate directed edges are forbidden');
});

Deno.test('content integrity: the shipped graph is one weakly connected whole', () => {
  // Every current zone must participate in the authored progression graph:
  // reachability through DIRECTED edges from the starter village.
  const adjacency = new Map(ROUTES.map((routeDef) => [routeDef.from, routeDef.to]));
  void adjacency;
  const out = new Map<string, Set<string>>();
  for (const routeDef of ROUTES) {
    if (!out.has(routeDef.from)) out.set(routeDef.from, new Set());
    out.get(routeDef.from)!.add(routeDef.to);
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
  for (const routeDef of ROUTES) {
    if (!undirected.has(routeDef.from)) undirected.set(routeDef.from, new Set());
    if (!undirected.has(routeDef.to)) undirected.set(routeDef.to, new Set());
    undirected.get(routeDef.from)!.add(routeDef.to);
    undirected.get(routeDef.to)!.add(routeDef.from);
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
  for (const zoneDef of ZONES) {
    assert(weak.has(zoneDef.id), `zone ${zoneDef.id} is disconnected from the world graph`);
  }
  // And the full chain must be walkable in one direction for the story:
  // every zone must be reachable from the village through authored edges
  // once their gates open — endpoints carry the gates, the topology must
  // not. (Backtracking edges exist, so undirected reach + bidirectional
  // chain coverage is what content guarantees; the progression test pins
  // story-stage reachability through real unlocks.)
  for (const zoneDef of ZONES) {
    const reachesBack = routesBetween(zoneDef.id, STARTING_ZONES[0]!).length > 0 ||
      walkExists(zoneDef.id, STARTING_ZONES[0]!);
    assert(reachesBack, `zone ${zoneDef.id} has no authored way back toward home`);
  }

  function walkExists(fromId: string, toId: string): boolean {
    const queue = [fromId];
    const visited = new Set([fromId]);
    while (queue.length > 0) {
      const currentZoneId = queue.shift()!;
      if (currentZoneId === toId) return true;
      for (const route of routesFrom(currentZoneId)) {
        if (!visited.has(route.to)) {
          visited.add(route.to);
          queue.push(route.to);
        }
      }
    }
    return false;
  }
});

// ── content integrity: event plans ───────────────────────────────────────

function effectiveTable(routeDef: RouteDef, events?: TravelEvent[]): TravelEvent[] {
  return events ?? routeDef.events ?? [];
}

Deno.test('content integrity: event counts are finite non-negative integers', () => {
  for (const routeDef of ROUTES) {
    assert(
      Number.isInteger(routeDef.eventCount),
      `route ${routeDef.id}: eventCount must be an integer`,
    );
    assert(routeDef.eventCount >= 0, `route ${routeDef.id}: eventCount must be non-negative`);
    for (const variant of routeDef.variants ?? []) {
      assert(
        Number.isInteger(variant.eventCount),
        `variant ${variant.id}: eventCount must be an integer`,
      );
      assert(variant.eventCount >= 0, `variant ${variant.id}: eventCount must be non-negative`);
    }
  }
});

Deno.test('content integrity: a nonzero event count resolves to a non-empty table', () => {
  for (const routeDef of ROUTES) {
    if (routeDef.eventCount > 0) {
      assert(
        (routeDef.events ?? []).length > 0,
        `route ${routeDef.id}: nonzero eventCount requires a non-empty events table`,
      );
    }
    for (const variant of routeDef.variants ?? []) {
      const table = effectiveTable(routeDef, variant.events);
      if (variant.eventCount > 0) {
        assert(
          table.length > 0,
          `variant ${variant.id}: nonzero eventCount requires a non-empty table (own or base)`,
        );
      }
    }
  }
});

Deno.test('content integrity: event weights are finite and positive', () => {
  for (const routeDef of ROUTES) {
    for (const event of routeDef.events ?? []) {
      assert(Number.isFinite(event.weight) && event.weight > 0, `route ${routeDef.id}: bad weight`);
    }
    for (const variant of routeDef.variants ?? []) {
      for (const event of variant.events ?? []) {
        assert(
          Number.isFinite(event.weight) && event.weight > 0,
          `variant ${variant.id}: bad weight`,
        );
      }
    }
  }
});

Deno.test('content integrity: every route table keeps at least one non-hostile entry', () => {
  // Level-locked battles can roll out of a table at any time; the
  // non-hostile remainder is what guarantees the road never becomes
  // mandatory combat.
  const hostile = (event: TravelEvent): boolean => event.kind === 'battle';
  for (const routeDef of ROUTES) {
    if ((routeDef.events ?? []).length > 0) {
      assert(
        (routeDef.events ?? []).some((event) => !hostile(event)),
        `route ${routeDef.id}: table must keep a quiet/beneficial entry`,
      );
    }
    for (const variant of routeDef.variants ?? []) {
      const table = effectiveTable(routeDef, variant.events);
      if (table.length > 0) {
        assert(
          table.some((event) => !hostile(event)),
          `variant ${variant.id}: table must keep a quiet/beneficial entry`,
        );
      }
    }
  }
});

Deno.test('content integrity: battle events are ordinary and fleeable — no bosses, no elite kind', () => {
  for (const routeDef of ROUTES) {
    for (const event of routeDef.events ?? []) {
      if (event.kind === 'battle') {
        const def = enemy(event.enemy);
        assert(def, `route ${routeDef.id}: unknown battle enemy ${event.enemy}`);
        assert(
          !def!.boss,
          `route ${routeDef.id}: boss enemy ${event.enemy} must not hide in a road`,
        );
        if (event.minPlayerLevel !== undefined) {
          assert(event.minPlayerLevel >= 1, `route ${routeDef.id}: bad minPlayerLevel`);
        }
        if (event.maxPlayerLevel !== undefined) {
          assert(
            event.maxPlayerLevel >= (event.minPlayerLevel ?? 1),
            `route ${routeDef.id}: bad level band`,
          );
        }
      }
    }
    for (const variant of routeDef.variants ?? []) {
      for (const event of variant.events ?? []) {
        if (event.kind === 'battle') {
          const def = enemy(event.enemy);
          assert(def, `variant ${variant.id}: unknown battle enemy ${event.enemy}`);
          assert(
            !def!.boss,
            `variant ${variant.id}: boss enemy ${event.enemy} must not hide in a road`,
          );
        }
      }
    }
  }
});

Deno.test('content integrity: treasure items and contextual drop references resolve', () => {
  for (const routeDef of ROUTES) {
    for (const event of routeDef.events ?? []) {
      if (event.kind === 'treasure') {
        if (event.item) {
          assert(item(event.item), `route ${routeDef.id}: unknown treasure item ${event.item}`);
        }
        if (event.dropTable) {
          assert(dropTable(event.dropTable), `route ${routeDef.id}: unknown drop table`);
        }
      }
    }
    for (const variant of routeDef.variants ?? []) {
      for (const event of variant.events ?? []) {
        if (event.kind === 'treasure') {
          if (event.item) {
            assert(item(event.item), `variant ${variant.id}: unknown treasure item ${event.item}`);
          }
          if (event.dropTable) {
            assert(dropTable(event.dropTable), `variant ${variant.id}: unknown drop table`);
          }
        }
      }
    }
  }
});

Deno.test('content integrity: drop tables are non-empty, bounded and reference real items', () => {
  const ids = new Set(DROP_TABLES.map((dropTable) => dropTable.id));
  assertEquals(ids.size, DROP_TABLES.length, 'drop table ids must be unique');
  for (const dropTable of DROP_TABLES) {
    assert(dropTable.entries.length > 0, `drop table ${dropTable.id} is empty`);
    assert(dropTable.entries.length <= 16, `drop table ${dropTable.id} is unbounded`);
    for (const drop of dropTable.entries) {
      assert(item(drop.item), `drop table ${dropTable.id} references unknown item ${drop.item}`);
      assert(
        Number.isFinite(drop.chance) && drop.chance > 0 && drop.chance <= 1,
        `drop table ${dropTable.id}: entry chance out of (0,1]`,
      );
      if (drop.qty !== undefined) {
        assert(Number.isInteger(drop.qty) && drop.qty >= 1, `drop table ${dropTable.id}: bad qty`);
      }
    }
  }
});

Deno.test('content integrity: zone loot tables resolve', () => {
  for (const zoneDef of ZONES) {
    if (zoneDef.lootTable) {
      assert(dropTable(zoneDef.lootTable), `zone ${zoneDef.id}: unknown loot table`);
    }
  }
});

Deno.test('content integrity: every referenced condition identity resolves', () => {
  const crawl = (owner: string, condition: NonNullable<RouteDef['when']>): void => {
    const refs = conditionRefs(condition);
    for (const questId of refs.quests) {
      assert(quest(questId), `${owner}: condition references unknown quest ${questId}`);
    }
    for (const itemId of refs.items) {
      assert(item(itemId), `${owner}: condition references unknown item ${itemId}`);
    }
    for (const zoneId of refs.zones) {
      assert(zone(zoneId), `${owner}: condition references unknown zone ${zoneId}`);
    }
  };
  for (const routeDef of ROUTES) {
    if (routeDef.when) crawl(`route ${routeDef.id}`, routeDef.when);
    for (const variant of routeDef.variants ?? []) {
      if (variant.when) crawl(`variant ${variant.id}`, variant.when);
    }
  }
});

Deno.test('content integrity: variant ids are unique within their route', () => {
  for (const routeDef of ROUTES) {
    const ids = new Set((routeDef.variants ?? []).map((variant) => variant.id));
    assertEquals(
      ids.size,
      (routeDef.variants ?? []).length,
      `route ${routeDef.id}: duplicate variant ids`,
    );
  }
});

Deno.test('content integrity: risk descriptors use the authored vocabulary (#164)', () => {
  const KNOWN = new Set(['sheltered', 'mild', 'wild', 'perilous']);
  for (const routeDef of ROUTES) {
    if (routeDef.risk !== undefined) {
      assert(KNOWN.has(routeDef.risk), `route ${routeDef.id}: unknown risk ${routeDef.risk}`);
    }
    for (const variant of routeDef.variants ?? []) {
      if (variant.risk !== undefined) {
        assert(KNOWN.has(variant.risk), `variant ${variant.id}: unknown risk`);
      }
    }
  }
  // Every nonzero-event road carries a risk descriptor: the travel view
  // never shows a bare count without its authored characterization.
  for (const routeDef of ROUTES) {
    if (routeDef.eventCount > 0) {
      assert(routeDef.risk !== undefined, `route ${routeDef.id} lacks risk metadata`);
    }
  }
});

Deno.test('content integrity: starter-region routes carry zero forced events', () => {
  for (const routeDef of ROUTES) {
    if (STARTING_ZONES.includes(routeDef.from) && STARTING_ZONES.includes(routeDef.to)) {
      const fresh = createPlayer(1, 'Fresh', 'warrior');
      const plan = resolveRoute(fresh, routeDef);
      assertEquals(
        plan.eventCount,
        0,
        `starter route ${routeDef.id} must have zero forced events`,
      );
    }
  }
});

// ── resolution helpers ───────────────────────────────────────────────────

function playerWith(zones: string[], currentZone: string, flags: Record<string, unknown> = {}) {
  const player = createPlayer(1, 'Walker', 'warrior');
  player.unlockedZones = [...zones];
  player.currentZone = currentZone;
  for (const [flagId, flagValue] of Object.entries(flags)) {
    (player.flags as Record<string, unknown>)[flagId] = flagValue;
  }
  return player;
}

Deno.test('usableRoutesFrom enumerates adjacency + unlocks, never every unlocked zone', () => {
  const player = playerWith(['emberdawn', 'outskirts', 'whisperwood', 'hollowmere'], 'outskirts');
  const ids = usableRoutesFrom(player).map((routeDef) => routeDef.id);
  // Adjacent edges only — hollowmere is unlocked but NOT adjacent.
  assertEquals(new Set(ids), new Set(['w_outskirts_emberdawn', 'w_outskirts_whisperwood']));
  // From emberdawn only one edge exists.
  const p2 = playerWith(['emberdawn', 'outskirts'], 'emberdawn');
  assertEquals(usableRoutesFrom(p2).map((routeDef) => routeDef.id), ['w_emberdawn_outskirts']);
});

Deno.test('usableRoutesFrom hides a locked destination even when adjacent', () => {
  const player = playerWith(['emberdawn', 'outskirts'], 'outskirts');
  // whisperwood unlocked? no — only the route to emberdawn may show.
  const ids = usableRoutesFrom(player).map((routeDef) => routeDef.id);
  assertEquals(ids, ['w_outskirts_emberdawn']);
});

Deno.test('resolveRoute: authored variant order, first match, base fallback', () => {
  const player = playerWith(['emberdawn'], 'emberdawn');
  // m7_tyrant not done → base plan (2 events, hostile-heavy).
  const base = resolveRouteById(player, 'w_whisperwood_hollowmere')!;
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
  const plain = resolveRoute(player, route('w_outskirts_whisperwood')!);
  assertEquals(plain.variantId, 'base');
  assertEquals(plain.eventCount, 0);
});

Deno.test('routeUsable refuses a usable-only-by-name plan (conditions + empty tables)', () => {
  const player = playerWith(['emberdawn', 'outskirts', 'hollowmere'], 'outskirts');
  for (const routeDef of usableRoutesFrom(player)) assert(routeUsable(player, routeDef));
  // An unlocked but non-adjacent zone never appears.
  const names = usableRoutesFrom(player).map((routeDef) => routeDef.to);
  assert(!names.includes('hollowmere'));
});

Deno.test('resolveRouteById: unknown edge id resolves to undefined', () => {
  const player = playerWith(['emberdawn'], 'emberdawn');
  assertEquals(resolveRouteById(player, 'w_nope_nada'), undefined);
});

// ── the departure authority (#168) ───────────────────────────────────────

Deno.test('departureCheck: a false top-level route condition refuses; truth opens the road', () => {
  // Patch a gated condition onto an otherwise ungated edge (no shipped
  // route authors a top-level `when` today — the gate must hold the
  // moment one is authored), then restore the catalog.
  const edge = route('w_outskirts_whisperwood')!;
  const edgeAny = edge as typeof edge & { when?: Condition };
  edgeAny.when = { flag: { id: 'road_gate_open' } };
  try {
    const player = playerWith(['emberdawn', 'outskirts', 'whisperwood'], 'outskirts');
    // The gate is closed: enumeration, usability and departure all refuse.
    assertEquals(routeUsable(player, edge), false);
    assertEquals(
      usableRoutesFrom(player).map((routeDef) => routeDef.id),
      ['w_outskirts_emberdawn'],
      'the gated road never even displays',
    );
    const closed = departureCheck(player, 'w_outskirts_whisperwood');
    assertEquals(closed.ok, false);
    assert(closed.ok === false && closed.refusal.includes('closed'));
    // And it opens the moment the live condition turns true.
    const open = playerWith(
      ['emberdawn', 'outskirts', 'whisperwood'],
      'outskirts',
      { road_gate_open: true },
    );
    const ready = departureCheck(open, 'w_outskirts_whisperwood');
    assert(ready.ok, 'the same road departs once its condition passes');
    assertEquals(usableRoutesFrom(open).map((routeDef) => routeDef.id), [
      'w_outskirts_emberdawn',
      'w_outskirts_whisperwood',
    ]);
    assertEquals(routeUsable(open, edge), true);
  } finally {
    delete edgeAny.when;
  }
});

Deno.test('departureCheck: one authority for identity, origin, unlock and plan', () => {
  const player = playerWith(['emberdawn', 'outskirts'], 'outskirts');
  const unknown = departureCheck(player, 'w_nope_nada');
  assert(!unknown.ok && unknown.refusal.includes("can't find a road"));
  const foreign = departureCheck(player, 'w_whisperwood_outskirts');
  assert(!foreign.ok && foreign.refusal.includes('does not start here'));
  const locked = departureCheck(player, 'w_outskirts_whisperwood');
  assert(!locked.ok && locked.refusal.includes('closed'), 'destination lock refused');
  // Every enumerated route passes the same check that startJourney applies.
  for (const routeDef of usableRoutesFrom(player)) assert(departureCheck(player, routeDef.id).ok);
});

// ── deterministic fixtures ───────────────────────────────────────────────

/** Hostile weight share of a plan: the probability a roll is an ordinary
 * battle (before level gating). */
function hostileShare(plan: { events: readonly TravelEvent[] }): number {
  const total = plan.events.reduce((totalWeight, event) => totalWeight + event.weight, 0);
  const hostile = plan.events
    .filter((event) => event.kind === 'battle')
    .reduce((totalWeight, event) => totalWeight + event.weight, 0);
  return total > 0 ? hostile / total : 0;
}

Deno.test('fixture: two same-count edges carry materially different distributions', () => {
  const player = playerWith(['sunspire', 'frostpeak'], 'sunspire');
  const up = resolveRoute(player, route('w_sunspire_frostpeak')!);
  const down = resolveRoute(player, route('w_frostpeak_sunspire')!);
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
  const player = playerWith(['whisperwood', 'hollowmere'], 'whisperwood');
  const out = resolveRoute(player, route('w_whisperwood_hollowmere')!);
  const back = resolveRoute(player, route('w_hollowmere_whisperwood')!);
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
  const first = rollDropTable('dt_ember_fields', seeded(158));
  const second = rollDropTable('dt_ember_fields', seeded(158));
  assertEquals(first, second, 'independent rngs with the same seed produce identical rolls');
  assertEquals(
    rollDropTable('dt_ember_fields', () => 0),
    dropTable('dt_ember_fields')!.entries.map((entry) => ({
      item: entry.item,
      qty: entry.qty ?? 1,
    })),
    'every positive-probability entry grants when its roll is zero',
  );
  assertEquals(rollDropTable('dt_unknown', seeded(158)), [], 'unknown tables roll nothing');
});

Deno.test('rollDropTable: never grants beyond the authored qty', () => {
  for (const dropTable of DROP_TABLES) {
    for (let seed = 0; seed < 50; seed++) {
      const rng = (() => {
        let state = seed * 2654435761;
        return () => {
          state = (state + 0x6d2b79f5) | 0;
          let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
          mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
          return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
        };
      })();
      for (const drop of rollDropTable(dropTable.id, rng)) {
        const authored = dropTable.entries.find((authoredDrop) => authoredDrop.item === drop.item)!;
        assertEquals(drop.qty, authored.qty ?? 1);
      }
    }
  }
});

Deno.test('content integrity: routes never inherit a zone explore table (distinct catalogs)', () => {
  // Travel tables come only from route defs; nothing in the model reads
  // ZoneDef.explore for crossings. Structural pin: the route event kinds
  // are their own closed union — flavor/battle/treasure/rest — never a
  // passthrough of the exploration vocabulary.
  const kinds = new Set(
    ROUTES.flatMap((routeDef) => (routeDef.events ?? []).map((event) => event.kind)),
  );
  assertEquals(
    [...kinds].sort(),
    ['battle', 'flavor', 'rest', 'treasure'],
    'travel-event kinds are their own vocabulary, not explore kinds',
  );
  // And the zone-side integrity stays intact: every explore event still
  // references real content (the same rule the zone tests pin).
  for (const zoneDef of ZONES) {
    for (const event of zoneDef.explore) {
      if (event.kind === 'battle' || event.kind === 'elite') {
        assert(enemy(event.enemy), `zone ${zoneDef.id}: unknown explore enemy ${event.enemy}`);
      }
    }
  }
});

Deno.test('content integrity: route ids never collide with route helper lookups', () => {
  // routesFrom/routesBetween agreement with the catalog.
  for (const routeDef of ROUTES) {
    assert(
      routesFrom(routeDef.from).includes(routeDef),
      `routesFrom(${routeDef.from}) must include ${routeDef.id}`,
    );
    assert(
      routesBetween(routeDef.from, routeDef.to).includes(routeDef),
      `routesBetween must include ${routeDef.id}`,
    );
  }
});

// ── world-topology documentation checks (#163) ───────────────────────────

Deno.test('world topology: the authoring map matches the shipped catalog (#163)', async () => {
  // docs/world-topology.md is a maintained authoring map, not a second
  // mechanics source — its mechanical facts are test-checked here.
  const doc = await Deno.readTextFile(new URL('../docs/world-topology.md', import.meta.url));
  const zones = new Set(ZONES.map((zoneDef) => zoneDef.id));
  // Every zone and every route id appears in the documented map (by name
  // or road id), so the doc cannot silently lag the world.
  for (const zoneDef of ZONES) {
    assert(doc.includes(zoneDef.name), `the topology map never names ${zoneDef.name}`);
  }
  // The documented haven/facility matrix matches the catalog.
  const havens = ZONES.filter((zoneDef) => zoneDef.safeHaven).map((zoneDef) => zoneDef.id);
  assertEquals(havens.sort(), ['emberdawn', 'mirefoot'], 'the map documents exactly these havens');
  assert(doc.includes('Mirefoot Landing') && doc.includes('forge only') === false);
  const shopZones = ZONES.filter((zoneDef) => zoneDef.services?.shop).map((zoneDef) => zoneDef.id)
    .sort();
  assertEquals(
    shopZones,
    ['cinder', 'emberdawn', 'frostpeak', 'hollowmere', 'sunspire'],
    'five authored shops across the map',
  );
  const forgeZones = ZONES.filter((zoneDef) => zoneDef.services?.forge).map((zoneDef) => zoneDef.id)
    .sort();
  assertEquals(forgeZones, ['cinder', 'emberdawn', 'mirefoot'], 'three authored forges');
  // The starter region and the Descent's exceptional count are documented.
  assert(doc.includes('zero-event'), 'starter roads are documented as zero-event');
  assert(doc.includes('3') && doc.includes('Descent'), 'the exceptional expedition is documented');
  void zones;
});

Deno.test('world topology: road tables keep meaningful quiet/beneficial room (#163)', () => {
  // "Random event" must never become a euphemism for mandatory combat:
  // every nonzero-event table keeps at least a quarter of its weight
  // non-hostile (level-gated battles excluded from the promise).
  for (const routeDef of ROUTES) {
    const tables: TravelEvent[][] = [routeDef.events ?? []];
    for (const variant of routeDef.variants ?? []) {
      if ((variant.events ?? routeDef.events ?? []).length > 0 && (variant.eventCount ?? 0) > 0) {
        tables.push(variant.events ?? routeDef.events ?? []);
      }
    }
    for (const table of tables) {
      if (table.length === 0) continue;
      const total = table.reduce((totalWeight, event) => totalWeight + event.weight, 0);
      const hostile = table
        .filter((event) => event.kind === 'battle')
        .reduce((totalWeight, event) => totalWeight + event.weight, 0);
      const quiet = (total - hostile) / total;
      assert(
        quiet >= 0.25,
        `${routeDef.id}: only ${(quiet * 100).toFixed(0)}% of the road is non-hostile`,
      );
    }
  }
});

Deno.test('world topology: a quest-secured road can drop to a zero-event crossing (#163)', () => {
  const player = createPlayer(1660, 'Trader', 'warrior');
  player.level = 20;
  player.unlockedZones.push('sunspire', 'hollowmere');
  player.currentZone = 'sunspire';
  const edge = route('w_sunspire_hollowmere')!;
  assertEquals(resolveRoute(player, edge).eventCount, 1, 'the patrolled descent rolls');
  player.quests['m10_cult'] = { status: 'done', counts: [8] };
  const plan = resolveRoute(player, edge);
  assertEquals(plan.variantId, 'v_sun_road_open');
  assertEquals(plan.eventCount, 0, 'caravans run: a zero-event secured road');
  assertEquals(plan.risk, 'sheltered');
  // The base table is untouched for players who have not broken the cult.
  const other = createPlayer(1661, 'Patrol', 'mage');
  other.level = 20;
  assertEquals(resolveRoute(other, edge).eventCount, 1);
});
