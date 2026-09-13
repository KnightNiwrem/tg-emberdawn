# Balance simulation and campaign accounting

Authoritative code and tests: `src/engine/balance.ts`, `src/engine/campaign_policy.ts`,
`src/engine/campaign_metrics.ts`, `scripts/balance.ts`, `tests/balance_test.ts`,
`tests/balance_metrics_test.ts`, `tests/campaign_fight_test.ts`, `tests/balance_snapshot.json`.

For trace-event or HP-accounting changes, also read
[Resolution order and telemetry](resolution-and-effects.md#resolution-order-and-telemetry). For
changes to simulated action/effect behavior, read
[Resolution and effects](resolution-and-effects.md). For changes to encounter eligibility or
dungeon/run behavior, read [Encounters and dungeons](encounters-and-dungeons.md) and its relevant
canonical documentation links.

## Balance harness

`scripts/balance.ts` (run via `deno task balance`) simulates seeded fights per class against the
content catalog and snapshots results in `tests/balance_snapshot.json` (`deno task balance:update`
refreshes it). Shield grants/waste and equipment procs come from structured trace entries (#176):
`shieldGranted` sums applied + wasted grant capacity on both sides; `equipProcs` counts successful
reactive triggers, including during openings, while `procHits` also includes battle-start
activations. The trace's `triggerKind` distinguishes the authored trigger from its display name. One
remaining line scanner measures crit/dodge markers, Shield absorption and expiry/loss — keep those
markers and the SHIELD_ABSORB/SHIELD_FADE regexes in sync if their generic effect copy changes.

Campaign orchestration stays in `driveQuests` in `src/engine/balance.ts`. Read-only shop planning
lives in `src/engine/campaign_policy.ts`; equal-distance counters retain catalog order. Planning
never buys or travels. `src/engine/campaign_metrics.ts` owns the travel accumulator and its derived
means; arrival HP/MP samples precede the haven heal, and accounting never feeds gameplay decisions.
Refactors must preserve RNG order, the actual retry bounds, and seeded campaign reports (including
stalls), without refreshing balance snapshots to conceal changes.
