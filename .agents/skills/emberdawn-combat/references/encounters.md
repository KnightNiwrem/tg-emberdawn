# Encounter and dungeon behavior

## Encounters, bosses, and dungeons

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
- Run progression, abandonment, recovery restrictions, and durable rewards follow
  [the dungeon-run policy](../../../../docs/dungeon-runs.md).
- Encounter eligibility: battle/elite explore events carry authored `minPlayerLevel` /
  `maxPlayerLevel`; `explore()` filters them before weighting, so low-level protection lives in
  content (authorable, testable), not ad-hoc engine checks. Ordinary enemies have no ceiling —
  returning to earlier areas must keep working end-game. Whisperwood hostiles start at level 3 and
  its elite (e_stag) at 5; the Emberdawn Outskirts (Lv 1–3) are the repeatable low-level wilds, and
  Emberdawn Village stays a battle-free safe haven.
- Every dungeon authors `recommendedLevel`; the dedicated entry panel surfaces it. Every run
  requires explicit entry confirmation (`z:dgb`), with an additional warning below the recommended
  level. Bosses cannot be fled, so entry must disclose that commitment before the run starts.
