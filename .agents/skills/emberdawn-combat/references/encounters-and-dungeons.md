# Encounters, dungeon runs, and respawn

Authoritative code and tests: `src/engine/world.ts`, `src/engine/dungeon_run.ts`,
`src/engine/character.ts`, `tests/quest_encounters_test.ts`, `tests/dungeon_content_test.ts`,
`tests/dungeon_run_test.ts`, `tests/dungeon_ui_test.ts`, `tests/save_identity_test.ts`.

For changes to in-battle effects or immediate revival, also read
[Resolution and effects](resolution-and-effects.md). For changes to simulated encounter or run
policies and their reports, read [Balance harness](balance-harness.md).

## Encounters, bosses, and dungeons

For changes to or reviews of `questBoosts` or quest-dependent encounter weighting, read
[docs/quest-encounters.md](../../../../docs/quest-encounters.md).

- Battles carry structured provenance (`BattleOrigin`): `explore`, `elite`, `dungeon`, or `travel`.
  Dungeon origins carry the dungeon id, floor, and boss flag. Travel origins identify the edge and
  pending event; their `zoneId` is the crossing's origin zone, which determines contextual loot.
- Boss semantics (no flee, Smoke Bomb refused, `bossesSlain`) come from the encounter — only a
  dungeon boss floor (`origin.boss`) is boss-classified. The Abyss overworld Warden is a farmable
  elite: fleeable, smokeable, not counted.
- Dungeon battle floors advance on victory; discovery floors advance through their explicit
  continuation. Boss floors are story-gated via `bossGate` (kill-quest bosses use
  `requireDone: false`). Victory bookkeeping routes through `resolveVictory()` in
  `src/engine/world.ts` — overworld kills never touch dungeon state.
- Dungeons are consecutive runs from floor 1 through the boss. Leaving, fleeing, or defeat abandons
  temporary floor progress; re-entry starts over. No hub facilities or rest are available inside a
  run. Discovery rooms never restore HP/MP. Collected floor caches and first-clear rewards remain
  consumed across retries, while ordinary earned loot and quest progress remain earned. See
  [docs/dungeon-runs.md](../../../../docs/dungeon-runs.md) and `emberdawn-design-decisions`.
- Encounter eligibility: battle/elite explore events carry authored `minPlayerLevel` /
  `maxPlayerLevel`; `explore()` filters them before weighting, so low-level protection lives in
  content (authorable, testable), not ad-hoc engine checks. Ordinary enemies have no ceiling —
  returning to earlier areas must keep working end-game. Whisperwood hostiles start at level 3 and
  its elite (e_stag) at 5; the Emberdawn Outskirts (Lv 1–3) are the repeatable low-level wilds, and
  Emberdawn Village stays a battle-free safe haven.
- Every dungeon authors `recommendedLevel`; the dedicated entry panel surfaces it. Every run
  requires explicit entry confirmation (`z:dgb`), with an additional warning below the recommended
  level. Bosses cannot be fled, so entry must disclose that commitment before the run starts.

## Death and respawn

- Death: −10% gold, revive FULLY restored at the LAST safe haven the hero actually reached
  (`player.respawnHaven`, never where you fell, never merely the catalog's first haven). The full
  revive is deliberate (#212): the haven's arrival authority full-heals anyway, so a partial revive
  is bypassed by one free walk out and back — the real penalties are the gold loss, the lost
  position, and the abandoned dungeon run. The pointer moves ONLY through the one arrival authority
  (`arriveAt` in `src/engine/world.ts`) when a crossing finally reaches a safe-haven zone — a
  journey that has merely begun or a crossing still mid-road never relocates it. A corrupt pointer
  refuses the load (identity gate). `applyDeath()` currently contains an `emberdawn` fallback for an
  invalid in-memory pointer; that existing fallback must not be used to recover or legitimize a
  refused save. Unknown or corrupt persisted haven identities require /reset. Retreat from a
  crossing returns to the edge ORIGIN, not the haven.
