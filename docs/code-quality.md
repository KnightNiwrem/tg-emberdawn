# Code-quality review

Fallow provides advisory signals for investigation. Validate findings against callers, structured
content, project decisions, and meaningful regression assertions before choosing work. The required
verification gates remain those in [AGENTS.md](../AGENTS.md#verification).

## Running the review

Run the combined analysis from the repository root, keeping raw output outside the tracked tree:

```sh
npx fallow --no-cache --format json --output-file /tmp/emberdawn-fallow.json
npx fallow health --hotspots --targets --coverage-gaps
```

Record the tool version and commit when comparing reports. The September 2026 review used Fallow
3.22.0 at `851b80a`. Counts depend on tool version, thresholds, entrypoints, and test discovery; a
lower count alone does not establish an improvement.

[.fallowrc.json](../.fallowrc.json) includes the bot, migration, balance CLI, and webhook CLI
entrypoints. Do not exclude `scripts/**`: the balance script consumes `MATRIX_FIGHTS` and
`runMatrix`, which were incorrectly flagged as unused when its caller was hidden. Deno declares
dependencies in `deno.json`; Node-style unlisted-dependency warnings for `grammy`, `grammy-testing`,
and `pg` are false positives here. Keep them advisory instead of introducing a second dependency
manifest.

## Accepted boundaries

- **Unused APIs are retained.** The owner deferred unused-code removal, obsolete re-export removal,
  and export-visibility cleanup in [#185](https://github.com/KnightNiwrem/tg-emberdawn/issues/185).
  An absent current caller may represent preparatory work. Keep these findings visible, preserve
  existing functions and exports, and do not run `fallow fix` to remove them. A later explicit owner
  decision can revisit this boundary.
- **Flat dispatch stays explicit.** Codec, callback, view, and structured-effect switches often have
  high scores because they enumerate distinct intents. Extract substantial operations when that
  clarifies ownership; retain ordered coordinators and exhaustive dispatch. Do not add an event bus
  or generic fallback behavior to reduce scores.
- **Shared authority can have many callers.** High fan-in does not justify splitting cohesive
  inventory, condition, or codec utilities. Their callers should use the common rules authority.
- **Some clones are intentional.** The accepted shop buy/sell row duplication and short location or
  authority guards remain readable in place. Damage, restoration, quest lifecycle, and equipment
  loops can resemble each other while owning different timing, notifications, or hooks. Confirm
  semantic equivalence before sharing them. See the
  [design-decisions skill](../.agents/skills/emberdawn-design-decisions/SKILL.md).
- **Test expectations remain independent.** Share identical setup and name coherent content crawls,
  but retain explicit assertions and useful failure context. Do not calculate expected values with
  the same production operation under test just to eliminate a clone.

Fallow's `static_estimated` coverage describes dependency paths, not executed branches or meaningful
assertions. Use Deno coverage and inspect the tests before proposing coverage work. For example,
`ensureSchema` is exercised through `PgStore.open` in the conditional PostgreSQL integration suite;
an absent direct test reference is not proof it is untested. Local runs without `TEST_PG_URL` skip
those four tests, and CI runs them separately against PostgreSQL. Import-only tests for side-effect
entrypoints do not establish their behavior.

## Implemented review work

The issues hold the original evidence, implementation boundaries, and validation details. Unused API
cleanup was excluded from this work.

| Issue                                                           | Result                                                                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#178](https://github.com/KnightNiwrem/tg-emberdawn/issues/178) | Campaign flee attempts use the ordinary terminal accounting path, including consumed rounds, deaths, contextual loot, and journey completion.                  |
| [#179](https://github.com/KnightNiwrem/tg-emberdawn/issues/179) | Shared application of resolved journey steps and quiet-event rewards preserves advancement ownership and RNG order.                                            |
| [#180](https://github.com/KnightNiwrem/tg-emberdawn/issues/180) | Quest goods share one requirement collector; named quest-effect operations stay inside the story draft transaction.                                            |
| [#181](https://github.com/KnightNiwrem/tg-emberdawn/issues/181) | Substantial combat effect cases have named helpers; the coordinator retains ordering, RNG gates, and terminal checks.                                          |
| [#182](https://github.com/KnightNiwrem/tg-emberdawn/issues/182) | Balance metrics and deterministic route search are separate from combat and travel policy. Twelve seeded campaign reports matched before and after extraction. |
| [#183](https://github.com/KnightNiwrem/tg-emberdawn/issues/183) | Shared hero status rendering and a focused travel-confirmation renderer clarify existing view responsibilities.                                                |
| [#184](https://github.com/KnightNiwrem/tg-emberdawn/issues/184) | Item-source and dialogue-integrity checks have focused helpers; the Ferryman suites share their identical hero fixture.                                        |
| [#185](https://github.com/KnightNiwrem/tg-emberdawn/issues/185) | CLI consumers are included in Fallow discovery, with the retained-API decision and review limits recorded here.                                                |
| [#186](https://github.com/KnightNiwrem/tg-emberdawn/issues/186) | Verification exposed random travel UI fixtures; fixed draws exercise both battle/quiet departure outcomes and reliable defeat recovery.                        |
