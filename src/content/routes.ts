/**
 * The authored world-route graph (#158): zones are real graph nodes,
 * routes are DIRECTED edges between adjacent zones. Travel is restricted
 * to these edges — unlocking a zone grants participation in the world
 * graph, never a teleport to it.
 *
 * Authoring rules (content-integrity tested):
 *  - `eventCount` is an EXACT number of forced random travel-event rolls,
 *    never a probability weight and never a battle count;
 *  - a nonzero count requires a non-empty weighted `events` table whose
 *    weights are finite and positive;
 *  - battle events are ordinary fleeable fights — no boss enemies, no
 *    elite kind, no inescapable encounters hidden in a road;
 *  - every table carries at least one non-hostile entry, so a road can
 *    never reduce to mandatory combat;
 *  - route tables never inherit a zone's explore table: staying and
 *    crossing are different contexts;
 *  - variants rewrite a crossing through the declarative condition
 *    language, selected in authored order with the base plan as fallback.
 *
 * Starter region: the Emberdawn hearth-roads carry ZERO forced events —
 * the beginning is forgiving by authoring, not by encounter filtering.
 */

import type { RouteDef } from './types.ts';

export const ROUTES: readonly RouteDef[] = [
  // ── Starter region (chapter 1) — zero forced events ────────────────────
  {
    id: 'w_emberdawn_outskirts',
    from: 'emberdawn',
    to: 'outskirts',
    name: 'Hearth-road',
    desc: 'The worn path from the village gate into the stubble fields. Farmers walk it at dusk.',
    eventCount: 0,
  },
  {
    id: 'w_outskirts_emberdawn',
    from: 'outskirts',
    to: 'emberdawn',
    name: 'Hearth-road',
    desc: 'Home again — woodsmoke on the wind, the ember-glow behind the fields.',
    eventCount: 0,
  },
  {
    id: 'w_outskirts_whisperwood',
    from: 'outskirts',
    to: 'whisperwood',
    name: 'Root-path',
    desc: 'A cart track that slips under the first true trees. Ranger-marked, well kept.',
    eventCount: 0,
  },
  {
    id: 'w_whisperwood_outskirts',
    from: 'whisperwood',
    to: 'outskirts',
    name: 'Root-path',
    desc: 'The way back through the tree-line, where the whispers lose their teeth.',
    eventCount: 0,
  },

  // ── Chapter 2 — down to the mire ───────────────────────────────────────
  {
    id: 'w_whisperwood_mirefoot',
    from: 'whisperwood',
    to: 'mirefoot',
    name: 'The Landing Trail',
    desc: 'A ranger-marked track down to the fen\u2019s edge — the long way in, but the dry way.',
    eventCount: 1,
    events: [
      { kind: 'battle', enemy: 'e_wolf', weight: 2, maxPlayerLevel: 12 },
      { kind: 'battle', enemy: 'e_boglin', weight: 2 },
      { kind: 'flavor', weight: 2, text: 'The trees thin; the ground softens; boards begin.' },
      {
        kind: 'rest',
        healPct: 0.25,
        weight: 1,
        text: 'A corduroy road-bridge makes a dry bench. You rest.',
      },
      {
        kind: 'treasure',
        gold: 50,
        weight: 1,
        text: 'A lost pole-tax pouch hangs from a waypoint stake.',
      },
    ],
  },
  {
    id: 'w_mirefoot_whisperwood',
    from: 'mirefoot',
    to: 'whisperwood',
    name: 'The Landing Trail, climbing',
    desc: 'Up from the boards into honest tree-shade, the fen breathing at your back.',
    eventCount: 1,
    events: [
      { kind: 'battle', enemy: 'e_boglin', weight: 2 },
      { kind: 'flavor', weight: 2, text: 'Each rise leaves another layer of fen-damp behind.' },
      {
        kind: 'rest',
        healPct: 0.25,
        weight: 1,
        text: 'You rest at the tree-line, where the frogs give way to birds.',
      },
      {
        kind: 'treasure',
        gold: 45,
        weight: 1,
        text: 'A boatman\u2019s dropped coin-roll wedged in the trail-boards.',
      },
    ],
  },
  {
    id: 'w_mirefoot_hollowmere',
    from: 'mirefoot',
    to: 'hollowmere',
    name: 'The Poled Crossing',
    desc: 'The Ferryman\u2019s own route: flat water, tall reeds, a steady pole. The safe way in.',
    eventCount: 0,
  },
  {
    id: 'w_hollowmere_mirefoot',
    from: 'hollowmere',
    to: 'mirefoot',
    name: 'The Poled Crossing, out',
    desc: 'Back to the landing\u2019s dry boards and Odo\u2019s patient hammer.',
    eventCount: 0,
  },
  {
    id: 'w_whisperwood_hollowmere',
    from: 'whisperwood',
    to: 'hollowmere',
    name: 'The Drowned Causeway',
    desc:
      'The old stone road sinks into the black water. Things move along it that serve the mire.',
    eventCount: 2,
    events: [
      { kind: 'battle', enemy: 'e_boglin', weight: 3 },
      { kind: 'battle', enemy: 'e_leech', weight: 2 },
      { kind: 'battle', enemy: 'e_bandit', weight: 1, maxPlayerLevel: 8 },
      {
        kind: 'flavor',
        weight: 2,
        text: 'The causeway stones give with a wet sigh under each step.',
      },
      {
        kind: 'rest',
        healPct: 0.2,
        weight: 1,
        text: 'You find a hunter\u2019s lean-to above the floodline and rest a while.',
      },
      {
        kind: 'treasure',
        gold: 70,
        weight: 1,
        text: 'A drowned courier\u2019s satchel snagged on the pilings still holds coin.',
      },
    ],
    variants: [
      {
        id: 'v_causeway_quiet',
        // The Tyrant is dead — the mire no longer sends raiders up the road.
        when: { questStatus: { questId: 'm7_tyrant', is: 'done' } },
        eventCount: 1,
        name: 'The Drowned Causeway — quieted',
        desc: 'The water lies flat now. Whatever sent the boglins up the road is gone.',
        events: [
          { kind: 'battle', enemy: 'e_boglin', weight: 2 },
          {
            kind: 'flavor',
            weight: 2,
            text: 'Flat water, still air. The road belongs to travelers again.',
          },
          {
            kind: 'rest',
            healPct: 0.25,
            weight: 1,
            text: 'You rest dry-shod on a broad stone. The mire lets you.',
          },
          {
            kind: 'treasure',
            gold: 70,
            weight: 1,
            text: 'A fisher\u2019s cache hangs under the old bridge, meant for whoever comes back.',
          },
        ],
      },
    ],
  },
  {
    id: 'w_hollowmere_whisperwood',
    from: 'hollowmere',
    to: 'whisperwood',
    name: 'The Causeway, climbing',
    desc:
      'Out of the fen and up toward tree-shade — the wood at your back, the mire draining away.',
    eventCount: 1,
    events: [
      { kind: 'battle', enemy: 'e_boglin', weight: 2 },
      {
        kind: 'flavor',
        weight: 2,
        text: 'The air sweetens a mile at a time. The trees lean closer to listen.',
      },
      {
        kind: 'rest',
        healPct: 0.25,
        weight: 1,
        text: 'You wash the mire off in a clean stream and rest easy.',
      },
      {
        kind: 'treasure',
        gold: 55,
        weight: 1,
        text: 'A poacher\u2019s larder, abandoned: some coin and a sealed draught.',
      },
    ],
  },

  // ── Chapter 3 — the sun road ───────────────────────────────────────────
  {
    id: 'w_hollowmere_sunspire',
    from: 'hollowmere',
    to: 'sunspire',
    name: 'The Sun Road',
    desc:
      'The fen gives way to hardened flats, and the ruined causeway of a clockwork city rises ahead.',
    eventCount: 1,
    events: [
      { kind: 'battle', enemy: 'e_fenhag', weight: 2 },
      { kind: 'battle', enemy: 'e_sludge', weight: 2 },
      { kind: 'battle', enemy: 'e_cultist', weight: 2 },
      {
        kind: 'flavor',
        weight: 2,
        text: 'Faded waymarkers count down the miles to the city of gears.',
      },
      {
        kind: 'treasure',
        gold: 120,
        weight: 1,
        text: 'A pilgrim\u2019s offering-box lies toppled where the road meets the flats.',
      },
    ],
  },
  {
    id: 'w_sunspire_hollowmere',
    from: 'sunspire',
    to: 'hollowmere',
    name: 'The Sun Road, descending',
    desc:
      'Down from the dry heat into the fen\u2019s cold breath. The cult patrols the upper miles.',
    eventCount: 1,
    events: [
      { kind: 'battle', enemy: 'e_cultist', weight: 3 },
      { kind: 'battle', enemy: 'e_scarab', weight: 2 },
      { kind: 'flavor', weight: 1, text: 'The gears dim behind you; the swamp hums ahead.' },
      {
        kind: 'rest',
        healPct: 0.2,
        weight: 1,
        text: 'You rest in the shadow of a fallen mile-marker.',
      },
      {
        kind: 'treasure',
        gold: 110,
        weight: 1,
        text: 'A cultist\u2019s tithe-purse, cut and abandoned in the scrub.',
      },
    ],
  },

  // ── Chapter 4 — up to the ice ──────────────────────────────────────────
  {
    id: 'w_sunspire_frostpeak',
    from: 'sunspire',
    to: 'frostpeak',
    name: 'The Frozen Stair',
    desc: 'The climb where the desert\u2019s heat finally dies. Marauders work the switchbacks.',
    eventCount: 2,
    events: [
      { kind: 'battle', enemy: 'e_marauder', weight: 3 },
      { kind: 'battle', enemy: 'e_icebat', weight: 2 },
      { kind: 'battle', enemy: 'e_sentinel', weight: 2, maxPlayerLevel: 24 },
      {
        kind: 'flavor',
        weight: 1,
        text: 'Your breath turns to frost-glass. Above, the pass glitters.',
      },
      {
        kind: 'rest',
        healPct: 0.2,
        weight: 1,
        text: 'You shelter in a marauder-cave, banked coals still warm.',
      },
      {
        kind: 'treasure',
        gold: 260,
        weight: 1,
        text: 'A frost-cracked strongbox — the expedition that carried it never climbed down.',
      },
    ],
  },
  {
    id: 'w_frostpeak_sunspire',
    from: 'frostpeak',
    to: 'sunspire',
    name: 'The Frozen Stair, descending',
    desc: 'Down into dry warmth. The road is lonelier on this side of the pass.',
    eventCount: 2,
    events: [
      { kind: 'battle', enemy: 'e_bristlehorn', weight: 2 },
      { kind: 'battle', enemy: 'e_vulture', weight: 2 },
      { kind: 'flavor', weight: 2, text: 'Each switchback thaws a little more of you.' },
      {
        kind: 'rest',
        healPct: 0.25,
        weight: 1,
        text: 'A hot vent by the trail — the mountain\u2019s one kindness. You rest.',
      },
      {
        kind: 'treasure',
        gold: 300,
        weight: 1,
        text: 'A caravan\u2019s fallen tribute, half-buried at the snowline.',
      },
    ],
  },

  // ── Chapter 5 — the ash road ───────────────────────────────────────────
  {
    id: 'w_frostpeak_cinder',
    from: 'frostpeak',
    to: 'cinder',
    name: 'The Ashroad',
    desc: 'Snow gives way to grey dunes. The heat comes up through the boots here.',
    eventCount: 2,
    events: [
      { kind: 'battle', enemy: 'e_iceling', weight: 2 },
      { kind: 'battle', enemy: 'e_magmaslime', weight: 2 },
      { kind: 'battle', enemy: 'e_cinderhound', weight: 2 },
      {
        kind: 'flavor',
        weight: 2,
        text: 'The snow-line ends abruptly, as if drawn by a rule no one wrote.',
      },
      {
        kind: 'rest',
        healPct: 0.2,
        weight: 1,
        text: 'You rest in the lee of a black ridge, one cheek warm, one cold.',
      },
      {
        kind: 'treasure',
        gold: 420,
        weight: 1,
        text:
          'Ash has half-buried a smith\u2019s payment-cart. The coin kept better than the smith.',
      },
    ],
  },
  {
    id: 'w_cinder_frostpeak',
    from: 'cinder',
    to: 'frostpeak',
    name: 'The Ashroad, climbing',
    desc: 'Out of the caldera\u2019s reach, up into air that finally bites clean.',
    eventCount: 2,
    events: [
      { kind: 'battle', enemy: 'e_emberimp', weight: 2 },
      { kind: 'battle', enemy: 'e_cinderhound', weight: 2 },
      {
        kind: 'flavor',
        weight: 2,
        text: 'Cool air slides down the trail like a held breath released.',
      },
      {
        kind: 'rest',
        healPct: 0.25,
        weight: 1,
        text: 'A meltwater pool, painfully cold and perfectly clean. You rest.',
      },
      {
        kind: 'treasure',
        gold: 500,
        weight: 1,
        text: 'An ash-preserved trade-pack — someone\u2019s whole fortune, never delivered.',
      },
    ],
  },

  // ── Chapter 6 — the night road ─────────────────────────────────────────
  {
    id: 'w_cinder_umbra',
    from: 'cinder',
    to: 'umbra',
    name: 'The Night Road',
    desc: 'Toward the spire where light goes strange. The King\u2019s servants watch this road.',
    eventCount: 2,
    events: [
      { kind: 'battle', enemy: 'e_salamander', weight: 2 },
      { kind: 'battle', enemy: 'e_shade', weight: 2 },
      { kind: 'battle', enemy: 'e_shattered', weight: 2 },
      {
        kind: 'flavor',
        weight: 2,
        text: 'Your shadow paces you wrong here — a half-step early, a half-step late.',
      },
      {
        kind: 'rest',
        healPct: 0.2,
        weight: 1,
        text: 'You rest where a watchfire once stood. Even the memory of fire helps.',
      },
      {
        kind: 'treasure',
        gold: 650,
        weight: 1,
        text: 'A deserting Crownsworn\u2019s kit, cached under a flat stone.',
      },
    ],
  },
  {
    id: 'w_umbra_cinder',
    from: 'umbra',
    to: 'cinder',
    name: 'The Night Road, retreating',
    desc: 'Back into the honest heat of the ash dunes, where shadows keep their own hours.',
    eventCount: 2,
    events: [
      { kind: 'battle', enemy: 'e_shade', weight: 2 },
      { kind: 'battle', enemy: 'e_watcher', weight: 2 },
      {
        kind: 'flavor',
        weight: 2,
        text: 'Warm ash dunes roll to every horizon. Nothing follows. Probably.',
      },
      {
        kind: 'rest',
        healPct: 0.25,
        weight: 1,
        text: 'You rest inside a dead magma-vent, warmed from below.',
      },
      {
        kind: 'treasure',
        gold: 800,
        weight: 1,
        text: 'Tribute dropped by unseen servants who decided not to pursue.',
      },
    ],
  },

  // ── Postgame — the descent (exceptional: clearly signposted) ───────────
  {
    id: 'w_umbra_abyss',
    from: 'umbra',
    to: 'abyss',
    name: 'The Descent',
    desc: 'Down the seam beneath the world — the longest, darkest road there is. Go restored.',
    eventCount: 3,
    events: [
      { kind: 'battle', enemy: 'e_nightgaunt', weight: 2 },
      { kind: 'battle', enemy: 'e_horror', weight: 2 },
      { kind: 'battle', enemy: 'e_voidspawn', weight: 2 },
      { kind: 'flavor', weight: 1, text: 'The way down smells of cold iron and lost mornings.' },
      {
        kind: 'rest',
        healPct: 0.15,
        weight: 1,
        text: 'You dream by a fire that isn\u2019t there, and wake partly restored.',
      },
      {
        kind: 'treasure',
        gold: 1000,
        weight: 1,
        text: 'A previous climber\u2019s kit, past needing it. You are the climber now.',
      },
    ],
  },
  {
    id: 'w_abyss_umbra',
    from: 'abyss',
    to: 'umbra',
    name: 'The Climb',
    desc: 'Up out of the seam, toward the thin stubborn light above the spire.',
    eventCount: 2,
    events: [
      { kind: 'battle', enemy: 'e_nullhound', weight: 2 },
      { kind: 'battle', enemy: 'e_echo', weight: 2 },
      { kind: 'battle', enemy: 'e_voidspawn', weight: 2 },
      {
        kind: 'flavor',
        weight: 2,
        text: 'Light grows, one grey shade at a time. Your shadow remembers how to follow.',
      },
      {
        kind: 'rest',
        healPct: 0.2,
        weight: 1,
        text: 'A ledge of honest stone, out of the wind from below. You rest.',
      },
      {
        kind: 'treasure',
        gold: 1200,
        weight: 1,
        text: 'Value is a habit. The void indulged it here, once.',
      },
    ],
  },
];

const ROUTE_INDEX = new Map(ROUTES.map((r) => [r.id, r]));

export function route(id: string): RouteDef | undefined {
  return ROUTE_INDEX.get(id);
}

/** Every authored edge LEAVING the zone — raw adjacency, no availability
 * filtering (engine/routes.ts applies unlock state and conditions). */
export function routesFrom(zoneId: string): RouteDef[] {
  return ROUTES.filter((r) => r.from === zoneId);
}

/** The authored edge(s) joining two zones in ONE direction. */
export function routesBetween(from: string, to: string): RouteDef[] {
  return ROUTES.filter((r) => r.from === from && r.to === to);
}
