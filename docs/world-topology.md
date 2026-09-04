# World topology and facility map

The high-level authoring map for Emberdawn's world graph (#163). This is NOT a second mechanics
source: counts, tables, conditions, and capabilities live in `src/content/routes.ts`,
`src/content/zones.ts`, and `src/content/facilities.ts`, and the machine-checkable facts here are
test-pinned (`tests/routes_test.ts`, `tests/facilities_test.ts`, `tests/lifecycle_test.ts`). If this
map and the catalog disagree, the catalog wins and this file gets updated with it.

## Reading the map

- **Safety** and **services** are independent authored properties: a haven may lack either or both;
  a danger zone may exceptionally host one. Nothing derives services from `safeHaven`.
- **Roads** are directed edges. `events` is an exact count of forced random travel-event rolls —
  never a battle count and never a probability weight. Risk is authored qualitative metadata.
- **Unlock state** (which zones a player may enter) comes from quest rewards and dungeon
  first-clears; roads are static. A locked destination hides behind its zone unlock, not its road.
- Starter hearth-roads carry **zero** forced events — forgiving by authoring, not by encounter
  filtering.

## Nodes

| Zone                | Chapter | Band  | Safety | Services                                                             | Why it is a node                                                     |
| ------------------- | ------- | ----- | ------ | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Emberdawn Village   | 1       | 1–7   | Haven  | Bram's Forge-stall · Bram's Anvil (full)                             | Starter settlement; guided prologue; quest board                     |
| Emberdawn Outskirts | 1       | 1–3   | Danger | —                                                                    | First wilds band (Lv 1–3 encounter identity)                         |
| Whisperwood         | 1       | 3–9   | Danger | —                                                                    | Ch.1 encounter identity; Rootbound Hollow; Warden Tom, Ranger Pell   |
| Mirefoot Landing    | 2       | 9–16  | Haven  | Ropewalk Forge (cap 3 → 5)                                           | Ch.2 shelter; boat-iron forge; Slowsmith Odo; safe fork into the fen |
| Hollowmere Swamp    | 2       | 9–16  | Danger | The Ferryman's Post (shop)                                           | Ch.2 encounter identity; Sunken Shrine; the Ferryman                 |
| Sunspire Ruins      | 3       | 16–23 | Danger | The Confiscated Counter (shop)                                       | Ch.3 encounter identity; Vault of Hours; Curator Ombra               |
| Frostpeak Pass      | 4       | 23–31 | Danger | Rho's Trading Post (shop)                                            | Ch.4 encounter identity; Glacier Maw; Ice-Outcast Rho                |
| Cinder Wastes       | 5       | 31–39 | Danger | The Ash Caravan (shop) · The Warden's Cold Anvil (weapon, cap 4 → 5) | Ch.5 encounter identity; Pyre Caldera; Ashen Monk Sorrel             |
| Umbral Spire        | 6       | 39–45 | Danger | —                                                                    | Ch.6 encounter identity; Sundered Throne; the Archivist              |
| The Abyss           | 7       | 45    | Danger | —                                                                    | Postgame encounter identity; Endless Seam; Echo of Maren             |

## Roads (directed)

| From → To                | Name                         | Events | Risk      | Gate / upgrade                                 |
| ------------------------ | ---------------------------- | ------ | --------- | ---------------------------------------------- |
| emberdawn → outskirts    | Hearth-road                  | 0      | sheltered | —                                              |
| outskirts → emberdawn    | Hearth-road                  | 0      | sheltered | —                                              |
| outskirts → whisperwood  | Root-path                    | 0      | sheltered | —                                              |
| whisperwood → outskirts  | Root-path                    | 0      | sheltered | —                                              |
| whisperwood → mirefoot   | The Landing Trail            | 1      | mild      | —                                              |
| mirefoot → whisperwood   | The Landing Trail, climbing  | 1      | mild      | —                                              |
| mirefoot → hollowmere    | The Poled Crossing           | 0      | sheltered | —                                              |
| hollowmere → mirefoot    | The Poled Crossing, out      | 0      | sheltered | —                                              |
| whisperwood → hollowmere | The Drowned Causeway         | 2      | wild      | Secured to 1 (mild) when m7_tyrant is done     |
| hollowmere → whisperwood | The Causeway, climbing       | 1      | mild      | —                                              |
| hollowmere → sunspire    | The Sun Road                 | 1      | wild      | —                                              |
| sunspire → hollowmere    | The Sun Road, descending     | 1      | wild      | Secured to 0 (sheltered) when m10_cult is done |
| sunspire → frostpeak     | The Frozen Stair             | 2      | wild      | —                                              |
| frostpeak → sunspire     | The Frozen Stair, descending | 2      | wild      | —                                              |
| frostpeak → cinder       | The Ashroad                  | 2      | wild      | —                                              |
| cinder → frostpeak       | The Ashroad, climbing        | 2      | wild      | —                                              |
| cinder → umbra           | The Night Road               | 2      | wild      | —                                              |
| umbra → cinder           | The Night Road, retreating   | 2      | wild      | —                                              |
| umbra → abyss            | The Descent                  | 3      | perilous  | Confirmation required before departure         |
| abyss → umbra            | The Climb                    | 2      | wild      | —                                              |

Design notes:

- **The mire fork** is the map's taught tradeoff: the Drowned Causeway is direct but heavy (2 rolls,
  wild) until the Tyrant falls; the Landing Trail is longer (two edges) but mild, ends in a haven
  with a forge, and crosses the fen on the Ferryman's safe poled route.
- **Asymmetric secured roads** are deliberate: the cult's fall clears only the DESCENDING Sun Road
  (caravans run downhill with the grain of the trade); the climb keeps its patrol-free wildness
  until the story says otherwise.
- **The Descent** is the one expedition-grade road (3 rolls, perilous, departure confirmation). Its
  count is signposted, not hidden.
- Every road keeps at least one quiet/beneficial entry in its table — a road is never mandatory
  combat. Battle entries are ordinary fleeable fights; no bosses or elites hide in roads.

## Facilities and progression

- **Emberdawn** stays a beginner shop at every level: tier-1 hearth-steel plus basics, with Bram's
  tier-2 rack opening exactly at the m5_arms beat (quest progression, never level scaling).
- **Regional shops** carry regional steel: the Ferryman's Post (tier 2–3), the Confiscated Counter
  (tier 3–4), Rho's post (tier 5–6), the Ash Caravan (tier 6–7, and crownsteel tier-8 at an authored
  +25% once the Last Flame is freed). A returning veteran cannot buy endgame steel at the village.
- **Forges**: Bram's Anvil is the full craft (weapon + armor to +5); the Ropewalk caps at +3 until
  the Sunken Shrine is cleared; the Warden's Cold Anvil tempers weapons to +4 until the Pyre Caldera
  is cleared (then +armor and +5). Temper mastery remains per item-pattern everywhere (#24).
- **Condition upgrades** reuse the declarative condition language (quest status, flags) — no
  hard-coded facility branches in the engine.

## Reachability contracts

- The starter hearth-roads are zero-event crossings: the beginning is forgiving by authoring, not by
  encounter filtering.
- The graph is one connected progression whole from Emberdawn; no zone is reachable only through a
  road gated by a quest that starts or finishes behind that road (no circular gates — walk-tested
  with a fresh hero in `tests/lifecycle_test.ts`).
- Zone unlocks arrive from quest rewards (`m4_blessing` opens the fen and the landing, `m8_passage`
  Sunspire, `m12_chronolich` Frostpeak, `m15_wyrm` Cinder, `m16_ashes` the Spire, `m23_aldric` the
  Abyss) and dungeon first-clears; roads never add a second gate.
- The campaign/balance harness walks these real roads and rolls their real tables (see #162).
