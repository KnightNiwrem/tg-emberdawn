# Flavor and mechanics disclosure

Authoritative code and tests: `src/engine/mechanics.ts`, `src/render/menus.ts`,
`tests/mechanics_test.ts`.

For authored player-facing prose, load `emberdawn-narrative-writing`; this reference covers the
structural disclosure and generic output contract.

## Flavor versus mechanics (details)

- A skill or item's name and flavor (`SkillDef.flavor`, `ItemDef.desc`) are creative and may be
  nonliteral — never a rules source. The player-facing mechanical summary is generated from the
  structured effect specs by `src/engine/mechanics.ts`
  (`mechanicsText`/`mechanicsLines`/`consumableEffectLines`); equipment triggers disclose their
  mechanics the same way (`triggerDisclosure` in `src/render/menus.ts`). Never duplicate mechanical
  quantities in authored prose or replace the generated summary with a hand-written description.
- Canonical rules vocabulary: **Shield** (the absorbable pool), **DEF/RES**, **round** (duration and
  tick unit), **action** (one actor's opportunity to act), **beneficial/harmful effect** (cleanse
  and dispel categories).
- Validation is structural: tests assert the renderer discloses every field of an effect spec. They
  must not lexically scan names or flavor for words like "ward" or "stun".
- Battle narration (`spec.line`, `defaultInstanceLine`) is distinct from the static rules summary
  and may use in-world wording, but generic effect output (shield grants, capacity fades, dispels)
  still uses the canonical terms: the pool is always "Shield" (never "ward"), durations are rounds,
  and removals name beneficial or harmful effects.
- Some balance metrics still parse generic battle lines, while others use structured trace entries.
  When changing that copy, follow the parser and telemetry guidance in `emberdawn-combat`.
