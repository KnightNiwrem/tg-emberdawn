# Code-quality review history

Completed reviews and their recorded results. For current commands, interpretation, and accepted
boundaries, use the [code-quality review guide](code-quality.md). Counts and coverage figures below
are historical measurements at the recorded review baselines.

The September 2026 review used Fallow 3.22.0 at `851b80a`.

## Implemented review work

The issues hold the original evidence, implementation boundaries, and validation details. Unused API
cleanup was excluded from this work.

| Issue                                                           | Result                                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#178](https://github.com/KnightNiwrem/tg-emberdawn/issues/178) | Campaign flee attempts use the ordinary terminal accounting path, including consumed rounds, deaths, contextual loot, and journey completion.                               |
| [#179](https://github.com/KnightNiwrem/tg-emberdawn/issues/179) | Shared application of resolved journey steps and quiet-event rewards preserves advancement ownership and RNG order.                                                         |
| [#180](https://github.com/KnightNiwrem/tg-emberdawn/issues/180) | Quest goods share one requirement collector; named quest-effect operations stay inside the story draft transaction.                                                         |
| [#181](https://github.com/KnightNiwrem/tg-emberdawn/issues/181) | Substantial combat effect cases have named helpers; the coordinator retains ordering, RNG gates, and terminal checks.                                                       |
| [#182](https://github.com/KnightNiwrem/tg-emberdawn/issues/182) | Balance metrics and deterministic route search are separate from combat and travel policy. Twelve seeded campaign reports matched before and after extraction.              |
| [#183](https://github.com/KnightNiwrem/tg-emberdawn/issues/183) | Shared hero status rendering and a focused travel-confirmation renderer clarify existing view responsibilities.                                                             |
| [#184](https://github.com/KnightNiwrem/tg-emberdawn/issues/184) | Item-source and dialogue-integrity checks have focused helpers; the Ferryman suites share their identical hero fixture.                                                     |
| [#185](https://github.com/KnightNiwrem/tg-emberdawn/issues/185) | CLI consumers are included in Fallow discovery, with the retained-API decision and review limits recorded in the [active guide](code-quality.md#accepted-boundaries).       |
| [#186](https://github.com/KnightNiwrem/tg-emberdawn/issues/186) | Verification exposed random travel UI fixtures; fixed draws exercise both battle/quiet departure outcomes and reliable defeat recovery.                                     |
| [#213](https://github.com/KnightNiwrem/tg-emberdawn/issues/213) | Webhook management exits nonzero on HTTP or API failure while retaining the response. Process-level tests use a fake transport and verify request payloads and exit status. |
| [#214](https://github.com/KnightNiwrem/tg-emberdawn/issues/214) | The CLI matrix has direct coverage of representative policy cells, eligibility boundaries, boss gear comparisons, finite metrics, and seeded repeatability.                 |
| [#215](https://github.com/KnightNiwrem/tg-emberdawn/issues/215) | Bag, equipped-item, and shop details share Sources/Uses subview selection after their existing item-context checks.                                                         |
| [#216](https://github.com/KnightNiwrem/tg-emberdawn/issues/216) | Equipment tests share identical poison-plus-stun setup; narrow and broad HP-damage triggers retain separate assertions.                                                     |
| [#217](https://github.com/KnightNiwrem/tg-emberdawn/issues/217) | Domain and test variable names use descriptive terms rather than single-letter abbreviations, keeping wire callbacks exempt.                                                |
| [#218](https://github.com/KnightNiwrem/tg-emberdawn/issues/218) | Three identical content-override fixtures share one helper; pass-through wrappers and repeated preview checks are removed while preserving distinct assertions.             |
| [#219](https://github.com/KnightNiwrem/tg-emberdawn/issues/219) | Lifecycle comments describe the current ownership of loading and notices; overview prose drops drifting catalog counts and describes regional shop stock.                   |

The follow-up review used Fallow 3.22.0 at `3095cde`. It reported 28 dependency/export findings: 24
unused exports and one unused type retained under #185, plus the three Deno dependency false
positives described in the [review guidance](code-quality.md#running-the-review). Of 75 clone
groups, 58 were test-only, 11 source-only, and six mixed. Its 143 above-threshold functions were
investigation candidates, not 143 defects. High fan-in alone did not justify splitting the 39-line
inventory module; explicit dispatch and semantically different combat/story loops remained intact.

Executed coverage distinguished two useful gaps from the estimates: the real webhook CLI falsely
reported success for mocked API failures, and `runMatrix` had zero calls despite coverage of
`runCell`, `buildSnapshot`, and `MATRIX_LEVELS`. Baseline combat coverage was 94.1% of lines and
91.2% of branches. The baseline suite passed 743 tests with four PostgreSQL tests skipped locally;
the separate PostgreSQL CI suite exercises `ensureSchema` through `PgStore.open`. New webhook tests
run the script in a subprocess with a fake transport, which a static import graph may still miss.

## September review follow-up

The owner clarified the supported operating model in #227: the BotFather setting prevents group
membership, releases always move forward (including functional reverts), and custom-crafted callback
payloads are outside scope. The crafted death callback and unknown-item navigation reproductions are
therefore recorded, not expanded into a defensive callback framework. Existing staleness and
story-authority contracts remain in force. Reset confirmation requires its active scene.

- #227: one classified player load before message adoption or mutation; shared save refusal rules.
- #228: independent safe-haven forage recharge deadlines, with two-haven expiry coverage.
- #229: quiet rest messages disclose applied HP/MP recovery.
- #230: MemoryStore reads and writes own separate copies; failed delivery cannot save by aliasing.
- #232: dungeon entry and dialogue application expose explicit success/refusal variants.
- #233: forge mutations and rendering use resolved quotes; route variants share one plan
  constructor.
- #231: named scene variants replace positional arguments; return destinations and item references
  are structured JSON. Pre-launch version 16 refuses older saves without migration.

- #234: campaign shop planning takes explicit player state; travel accounting owns one accumulator.
  Nearest-shop selection checks for an upgrade without sorting unused candidates or calculating
  unused gains. The apparent shop retry loops always exited on their first iteration; explicit
  single attempts preserve that behavior. Thirteen seeded campaign reports, including a deliberate
  stall, matched byte-for-byte after the refactor.
- #235: story and combat comments state current contracts and explain local ordering. Repeated
  implementation history is consolidated here and in the story/combat skills; initiative snapshots,
  lethal stops, transactional receipts, and final readiness reconciliation remain documented next to
  their owners. This prose cleanup changes no executable code.
