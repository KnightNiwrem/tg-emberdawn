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

Record the tool version and commit when comparing reports. Counts depend on tool version,
thresholds, entrypoints, and test discovery; a lower count alone does not establish an improvement.

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
  the implementation under test.
- **Descriptive domain naming.** Variable names must be descriptive and reveal intent; avoid
  single-letter domain variables (`p`, `b`, `q`, etc.) across engine, handlers, renderers, and tests
  in favor of descriptive identifiers (`player`, `battle`, `questDef`). This includes content
  builders, scripts, destructuring, and array callback/comparator parameters. Telegram
  `callback_data` keys and values remain compact; local variables holding them still need
  descriptive names, even inside `src/codec.ts`, because variable names consume no wire bytes.
  Compact 1–3 line index-only loops remain exempt; semantic counters use role names such as
  `candidateSeed`, `floorNumber`, and `tierIndex`. When renaming shorthand bindings, preserve
  existing object keys and check for collisions with other variables in scope. See
  [#217](https://github.com/KnightNiwrem/tg-emberdawn/issues/217) and the follow-ups
  [#220](https://github.com/KnightNiwrem/tg-emberdawn/issues/220) and
  [#221](https://github.com/KnightNiwrem/tg-emberdawn/issues/221).

Fallow's `static_estimated` coverage describes dependency paths, not executed branches or meaningful
assertions. Use Deno coverage and inspect the tests before proposing coverage work. For example,
`ensureSchema` is exercised through `PgStore.open` in the conditional PostgreSQL integration suite;
an absent direct test reference is not proof it is untested. Local runs without `TEST_PG_URL` skip
those four tests, and CI runs them separately against PostgreSQL. Import-only tests for side-effect
entrypoints do not establish their behavior.

## Review history

For completed work, earlier baselines, and decision provenance, see the
[review history](code-quality-history.md).
