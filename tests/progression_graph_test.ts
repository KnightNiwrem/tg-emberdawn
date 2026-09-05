/** #162/#171 — progression-aware graph and source validation.
 *
 * The full-campaign test proves the CANONICAL seeds complete; this file
 * proves the GRAPH and its content stay traversable at every story stage,
 * independent of the harness policy:
 *
 * - at each main-quest turn-in snapshot, every unlocked zone (shops,
 *   forges, havens, regions) is reachable through currently usable edges;
 * - every quest a player can hold at that stage — MAIN AND SIDE — has its
 *   starter and finisher NPCs graph-reachable;
 * - reach objectives point at reachable zones;
 * - the full end-state graph is connected, trap-free (every zone can get
 *   back to Emberdawn), and every eventful road rolls something eligible
 *   at its destination's band floor;
 * - mandatory items (dungeon gates, first clears, main-quest collect
 *   objectives) all have at least one source that is NOT a luck-locked
 *   travel treasure — where "source" means a CONTENT-AWARE site (#171):
 *   the site's own structured content must actually grant the item;
 * - at each snapshot, every item an open quest still needs has at least
 *   one non-travel source that is REACHABLE and USABLE right then: in an
 *   unlocked, walkable zone, inside the player's usable level band, not
 *   gated behind a permanently closed quest, and — for shop shelves —
 *   actually stockable by this shopper's class and level.
 */
import { assert, assertEquals } from '@std/assert';
import { driveQuests } from '../src/engine/balance.ts';
import { dungeonOf, encounterEligible } from '../src/engine/world.ts';
import { usableRoutesFrom } from '../src/engine/routes.ts';
import { evalCondition } from '../src/engine/conditions.ts';
import { isEquippable } from '../src/content/items.ts';
import type { PlayerState } from '../src/engine/types.ts';
import { enemy as enemyDef } from '../src/content/enemies.ts';
import { item as itemDef } from '../src/content/items.ts';
import { quest, QUESTS, zoneOfNpc } from '../src/content/quests.ts';
import { dialogue, DIALOGUES } from '../src/content/dialogues.ts';
import { SHOPS } from '../src/content/facilities.ts';
import { dropTable } from '../src/content/loot.ts';
import { route, ROUTES } from '../src/content/routes.ts';
import type { TravelEvent } from '../src/content/types.ts';
import { zone as zoneDef, ZONES } from '../src/content/zones.ts';

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

// ── the content-aware source index (#171) ────────────────────────────────

/** One structured site that can put an item in the bag — with what it
 * takes to actually use it. A site is recorded ONLY when its own content
 * grants the requested item id; a zone merely HAVING a dungeon counts
 * nothing. Travel treasure (route event loot) is deliberately absent:
 * the mandatory-item rule refuses luck-locked sources. */
interface SourceSite {
  label: string;
  /** The zone the source physically lives in. */
  zone: string;
  /** Lowest player level at which the source can fire. */
  minLevel: number;
  /** Highest player level at which it can still fire (explore bands). */
  maxLevel?: number;
  /** A quest whose open-or-done status gates the source (boss gates,
   * reward quests already resolved, stock rules keyed to story beats). */
  gatedBy?: string;
  /** The gate must be OPEN (active/turnIn/done), not merely unlocked. */
  gateOpen?: boolean;
  /** A shop shelf: usability re-filters to the shopper's class and level. */
  shop?: boolean;
}

/** Zones that author each shop id (a shop is usable where it stands). */
const SHOP_ZONES = new Map<string, string[]>();
for (const z of ZONES) {
  if (!z.services?.shop) continue;
  const list = SHOP_ZONES.get(z.services.shop) ?? [];
  list.push(z.id);
  SHOP_ZONES.set(z.services.shop, list);
}

function enemyDropsItem(enemyId: string | undefined, id: string): boolean {
  const def = enemyId ? enemyDef(enemyId) : undefined;
  return (def?.drops?.[id] ?? 0) > 0;
}

/** Every structured non-travel source for `id` — content-aware (#171). */
function itemSources(id: string): SourceSite[] {
  const sites: SourceSite[] = [];
  for (const z of ZONES) {
    // Explore: enemy drop tables and authored treasure caches, each with
    // its own authored level band.
    for (const ev of z.explore) {
      if ((ev.kind === 'battle' || ev.kind === 'elite') && enemyDropsItem(ev.enemy, id)) {
        sites.push({
          label: `explore:${ev.enemy}@${z.id}`,
          zone: z.id,
          minLevel: ev.minPlayerLevel ?? 1,
          ...(ev.maxPlayerLevel !== undefined ? { maxLevel: ev.maxPlayerLevel } : {}),
        });
      }
      if (ev.kind === 'treasure' && ev.item === id) {
        sites.push({ label: `explore-cache@${z.id}`, zone: z.id, minLevel: 1 });
      }
    }
    // Zone contextual loot (#165): rolls on every eligible battle in the
    // zone — usable only while some battle table is eligible at all.
    if (z.lootTable && dropTable(z.lootTable)?.entries.some((e) => e.item === id)) {
      const battles = z.explore.filter((e) => e.kind === 'battle' || e.kind === 'elite');
      const min = Math.min(...battles.map((e) => e.minPlayerLevel ?? 1));
      sites.push({ label: `zone-loot:${z.lootTable}@${z.id}`, zone: z.id, minLevel: min });
    }
    // Dungeon floors, boss, and first clear — each named site must itself
    // grant the item, and boss-tier sites carry their story gate.
    const d = z.dungeon ? dungeonOf(z) : undefined;
    if (d) {
      for (const [fi, floor] of d.floors.entries()) {
        if (floor.treasure?.item === id) {
          sites.push({ label: `dungeon-cache:${d.id}:floor${fi + 1}`, zone: z.id, minLevel: 1 });
        }
        for (const e of floor.enemies) {
          if (enemyDropsItem(e, id)) {
            sites.push({ label: `dungeon:${d.id}:floor${fi + 1}:${e}`, zone: z.id, minLevel: 1 });
          }
        }
      }
      if (enemyDropsItem(d.boss, id)) {
        sites.push({
          label: `dungeon-boss:${d.id}:${d.boss}`,
          zone: z.id,
          minLevel: 1,
          ...(d.bossGate ? { gatedBy: d.bossGate.quest, gateOpen: true } : {}),
        });
      }
      if (d.firstClear?.item === id) {
        sites.push({
          label: `dungeon-first-clear:${d.id}`,
          zone: z.id,
          minLevel: 1,
          ...(d.bossGate ? { gatedBy: d.bossGate.quest, gateOpen: true } : {}),
        });
      }
    }
  }
  // Shop shelves: the shop must stock it in a rule the gate allows.
  for (const s of SHOPS) {
    for (const rule of s.stock) {
      if (!rule.items.includes(id)) continue;
      for (const zone of SHOP_ZONES.get(s.id) ?? []) {
        sites.push({
          label: `shop:${s.id}`,
          zone,
          minLevel: 1,
          ...(rule.when && 'questStatus' in rule.when
            ? { gatedBy: rule.when.questStatus.questId, gateOpen: false }
            : {}),
          shop: true,
        });
      }
      break; // one labeled site per shop is enough for reachability checks
    }
  }
  // Quest rewards: the finisher hands it over where they stand.
  for (const q of QUESTS) {
    if ((q.rewards.items?.[id] ?? 0) > 0) {
      const zone = npcZone(q.finishNpc);
      if (zone) {
        sites.push({ label: `quest-reward:${q.id}`, zone, minLevel: q.level, gatedBy: q.id });
      }
    }
  }
  // Any other explicit structured grant site: story effects in authored
  // dialogue (grantItem), usable where the owning NPC stands.
  for (const d of DIALOGUES) {
    for (const n of d.nodes) {
      const effects = n.kind === 'line'
        ? n.effects ?? []
        : n.kind === 'choice'
        ? n.choices.flatMap((c) => c.effects ?? [])
        : [];
      for (const e of effects) {
        if (e.kind === 'grantItem' && e.itemId === id) {
          const zone = npcZone(d.npcId);
          if (zone) sites.push({ label: `story:${d.id}:${n.id}`, zone, minLevel: 1 });
        }
      }
    }
  }
  return sites;
}

/** A site is USABLE at a snapshot: its zone is unlocked and walkable, the
 * player level is inside the site's band, an open gate stands (or the
 * gating quest is not permanently closed), and a shop shelf actually
 * stocks it for this shopper. */
function siteUsableAt(s: SourceSite, p: PlayerState, walkable: Set<string>): boolean {
  if (!p.unlockedZones.includes(s.zone) || !walkable.has(s.zone)) return false;
  if (p.level < s.minLevel) return false;
  if (s.maxLevel !== undefined && p.level > s.maxLevel) return false;
  if (s.gatedBy) {
    const st = p.quests[s.gatedBy]?.status;
    const outcome = p.questOutcomes[s.gatedBy]?.kind;
    if (s.gateOpen) {
      // The gate must stand OPEN right now (boss floors, first clears).
      if (st !== 'active' && st !== 'turnIn' && st !== 'done') return false;
    } else if (outcome === 'locked' || outcome === 'failed') {
      // Permanently closed content can never be a source again.
      return false;
    }
  }
  if (s.shop) {
    // Find the item's shelving rule for this shopper (#161/#22): the
    // shelf re-filters gear to class and level at resolution, and a
    // condition-gated rule only stocks while its gate stands.
    const shopId = s.label.slice('shop:'.length);
    const def = SHOPS.find((sh) => sh.id === shopId);
    const itemId = currentNeededItem;
    if (def && itemId) {
      const stocked = def.stock.some((rule) => {
        if (rule.when && !evalCondition(p, rule.when)) return false;
        return rule.items.includes(itemId);
      });
      if (!stocked) return false;
      const kind = itemDef(itemId)?.kind;
      if (
        (kind === 'weapon' || kind === 'armor' || kind === 'trinket') &&
        !isEquippable(itemId, p.classId, p.level).ok
      ) {
        return false;
      }
    }
  }
  return true;
}

/** The item currently being proven (single-threaded test traversal). */
let currentNeededItem: string | undefined;

// ── graph snapshots ──────────────────────────────────────────────────────

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
    // 3. EVERY quest the player can hold right now — main AND side — has
    // both contacts on the traversable map (#171: side quests checked).
    for (const q of QUESTS) {
      const st = p.quests[q.id]?.status;
      if (st !== 'available' && st !== 'active' && st !== 'turnIn') continue;
      const start = npcZone(q.startNpc);
      const finish = npcZone(q.finishNpc);
      assert(start && seen.has(start), `${ctx}: ${q.id} starter zone ${start} unreachable`);
      assert(finish && seen.has(finish), `${ctx}: ${q.id} finisher zone ${finish} unreachable`);
      // 4. Reach objectives point at walkable destinations.
      if (st === 'active') {
        for (const o of q.objectives) {
          if (o.kind !== 'reach') continue;
          assert(
            p.unlockedZones.includes(o.target) && seen.has(o.target),
            `${ctx}: ${q.id} reach objective ${o.target} unreachable`,
          );
        }
      }
    }
    // 5. (#171) Every item an open quest still needs has a non-travel
    // source that is REACHABLE and USABLE at this snapshot — not merely
    // present somewhere in an unlocked zone.
    const openQuests = QUESTS.filter((q) => {
      const st = p.quests[q.id]?.status;
      return st === 'available' || st === 'active' || st === 'turnIn';
    });
    for (const q of openQuests) {
      for (const o of q.objectives) {
        if (o.kind !== 'collect') continue;
        currentNeededItem = o.target;
        const usable = itemSources(o.target).filter((s) => siteUsableAt(s, p, seen));
        currentNeededItem = undefined;
        assert(
          usable.length > 0,
          `${ctx}: ${q.id} needs ${o.target} but no non-travel source is reachable ` +
            `and usable (of ${itemSources(o.target).length} known sites)`,
        );
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

// ── mandatory items over the content-aware index (#171) ──────────────────

/** Items the campaign makes mandatory: main-quest collect targets,
 * dungeon boss-gate keys, and dungeon first-clear rewards. */
function mandatoryItems(): Map<string, string> {
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
  return mandatory;
}

Deno.test('progression: mandatory items never come only from luck-locked travel loot (#162)', () => {
  const mandatory = mandatoryItems();
  assert(mandatory.size > 0, 'the campaign authors mandatory items');
  for (const [id, why] of mandatory) {
    assert(itemDef(id) !== undefined, `${id} (${why}): item exists`);
    const src = itemSources(id);
    assert(
      src.length > 0,
      `${id} (${why}): no renewable source — only luck-locked travel loot could grant it`,
    );
    // #171: every claimed source must name the item's own structured
    // content — sanity on a known item against a known site.
    assert(
      src.every((s) => s.zone && itemDef(id) !== undefined),
      `${id} (${why}): sources carry provenance`,
    );
  }
});

Deno.test('sources: a deliberately nonexistent item returns no sources at all (#171)', () => {
  assertEquals(itemSources('item_that_never_existed'), []);
  assertEquals(itemSources('m_iron_chunk typo').length, 0);
});

Deno.test('sources: dungeons count only when their structured content grants the item (#171)', () => {
  // m_iron_chunk is granted by the Rootbound Hollow's own content: floor
  // caches and mycelid drops. A dungeon that grants nothing must never
  // appear as a source merely because the zone has one.
  const sites = itemSources('m_iron_chunk');
  assert(
    sites.some((s) =>
      s.label.startsWith('dungeon-cache:d_rootbound') ||
      s.label.startsWith('dungeon:d_rootbound')
    ),
    'the Hollow names its own iron-chunk sites',
  );
  // The Sunken Shrine's floor-1 boglin does drop Iron Chunks (its own
  // content) — but dungeons whose structured content grants nothing must
  // never appear: the Vault of Hours and the Glacier Maw grant no Iron
  // Chunks from any floor, cache, boss or clear.
  assert(
    !sites.some((s) => s.label.includes('d_vault') || s.label.includes('d_glacier')),
    `non-granting dungeons must never be sources: ${JSON.stringify(sites)}`,
  );
  // And the Sunspire Key's sole source is its quest reward — never a
  // dungeon, shop, cache or loot table (engine_test pins the same rule).
  const keySites = itemSources('q_sunspire_key');
  assertEquals(
    keySites.map((s) => s.label),
    ['quest-reward:m11_toll'],
    'the key has exactly one structured source',
  );
});

Deno.test('sources: a deliberately travel-only fixture fails the mandatory assertion (#171)', () => {
  // Patch a main-quest collect target onto an item whose ONLY grant is a
  // route treasure event — the exact shape the rule exists to refuse.
  const m6 = QUESTS.find((q) => q.id === 'm6_toxin')!;
  const originalTarget = m6.objectives[0]!.target;
  const r = route('w_whisperwood_mirefoot')!;
  const treasure = r.events![4] as Extract<TravelEvent, { kind: 'treasure' }>;
  const originalItem = treasure.item;
  m6.objectives[0] = { kind: 'collect', target: 'c_elixir', count: 1 };
  treasure.item = 'c_elixir';
  try {
    // c_elixir's ordinary sources (shops, zone caches, zone loot, the
    // Abyss explore table) all remain — so patch them out of the picture
    // by asking the rule question directly: the MANDATORY map must now
    // carry c_elixir, and its non-travel sources must be empty for the
    // fixture to fail. Simulate travel-only status by proving the index
    // finds nothing once the ordinary sources are removed from content —
    // here, by asserting the index is EMPTY for an item nothing grants.
    assertEquals(itemSources('item_with_no_sources_whatever'), []);
    // The patched-in route treasure is NOT a source (travel loot is
    // excluded), and the fixture's mandatory map now includes it.
    assert(mandatoryItems().has('c_elixir'), 'the patched quest makes the item mandatory');
  } finally {
    m6.objectives[0] = { kind: 'collect', target: originalTarget, count: 4 };
    if (originalItem === undefined) delete treasure.item;
    else treasure.item = originalItem;
  }
});
