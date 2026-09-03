# Design Decisions & Accepted Trade-offs — Emberdawn

Record of accepted architectural trade-offs, evaluated tool findings, and deliberate gameplay
non-goals.

## 1. Tooling & Linter Findings

### Fallow "Unlisted Dependencies"

- `deno.json` is the authoritative project manifest for Deno runtime dependencies.
- Static audit tools tailored for Node.js (`npx fallow`) report `grammy` and `grammy-testing` as
  unlisted dependencies because they do not appear in a `package.json`. These findings are false
  positives and are safely ignored.

### Code Duplication in Shop Rows

- `src/render/views.ts` contains a ~12-line pair of similar button row constructors for shop
  purchasing versus selling.
- Because these rows differ in label structure, action encodings, and semantics, creating a shared
  abstraction would add indirection without meaningful reuse. The localized duplication is accepted.

### Flat Dispatch Switches

- The callback router (`src/handlers/callbacks.ts`) and view renderers (`src/render/views.ts`)
  utilize large, flat switch statements.
- This design is intentional: dispatch logic remains transparent, exhaustive, and easy to trace
  directly to codec actions. Complexity is maintained in structured data rather than nested control
  flow.

## 2. Gameplay Mechanics & Non-Goals

### Dungeon Attrition is Optional

- In Emberdawn, dungeon floors are independent challenges. Progress persists upon clearing a floor,
  travel between zones is free, and returning to a safe haven fully restores HP.
- Leaving a dungeon to heal between floors is valid and expected play.
- Attrition mechanics (such as resetting run progress on exit, travel locks, or between-floor
  healing limits) are deliberate non-goals. Encounters are balanced under the assumption that
  players may enter each floor at full health.

### Protected Boss Trophies

- First-clear rewards for major dungeon bosses award unique trinkets (`t_12`–`t_18`).
- These items are flagged as `unique`, preventing them from being sold or discarded. Because they
  are earned once per character, this protects players against accidental loss.

### Item-Pattern Mastery in the Forge

- Forge tempering (up to +5 via `forge_i_<itemId>` flags) applies to the item catalog identity
  rather than a specific inventory slot instance.
- Any subsequent copy of that item found in loot inherits the earned temper level. This creates a
  bounded, satisfying sink for crafting materials without inventory bookkeeping friction.

### Targeted Equipment Shops

- Shop equipment offerings are strictly filtered by the shopper's class and current level
  (`item.level <= player level`).
- This prevents players from spending resources on weapons or armor they cannot immediately equip.

### Guided Hero Prologue

- New characters undergo a short, directed prologue before the full village hub opens.
- The zone view progressively discloses hub options only as the hero learns core controls, ensuring
  a smooth onboarding experience.
