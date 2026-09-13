# Combat resolution contracts

Implementation: `src/engine/combat.ts`, `src/engine/effects.ts`, `src/engine/character.ts`, and
`src/content/enemies.ts`. Relevant checks include `tests/roundflow_test.ts`,
`tests/applied_hp_test.ts`, and `tests/lethal_test.ts`.

## Progression and enemy stats

- 45 levels. The XP curve is deliberately grindy; `xpForNextLevel()` in `src/engine/classes.ts` is
  the authority (it floors the curve and returns infinity at the level cap).
- Enemy stats derive from level in `mk()` (`src/content/enemies.ts`). Bosses multiply HP/xp/gold and
  have scripted specials.

## Resolution order and telemetry

- One authoritative coordinator owns combat phases and nested sub-resolution; SPD determines the
  first actor; each action and effect fully resolves before the next begins; terminal state is
  checked immediately after every potentially lethal transition. When HP reaches 0 and no immediate
  revival succeeds, no later action, rider, reaction, or end-of-round effect runs; regeneration
  never revives a terminal combatant, and DoT never creates a post-victory mutual KO.
- Combat trace entries are plain records appended by and returned from the active synchronous
  resolution (`recordCombatEvent`): state changes first, then a plain-data push.
- Applied-HP contract: `hpDamaged` carries `resolved` (post-mitigation, post-shield, pre-floor —
  overkill included) and `hpLost` (the actual capped HP delta every damage family reports);
  `hpRestored`/`revived` carry `attempted` + `applied`. HP-moved metrics (balance dealt/taken) sum
  `hpLost`, never `resolved`; lifesteal telemetry and battle text report the applied heal.

## Initiative and durations

- Initiative is snapshotted from effective SPD before either actor's slot. An advertised N-turn SPD
  effect covers exactly N eligible snapshots: a mid-round SPD application (any slot after the
  snapshot) defers its first decay — the cast round spent no unit on a snapshot that already decided
  — while opening SPD applications (enemy openings like the Chrono Anchor, pre-emptive skills)
  precede round 1's snapshot and count it (`timing: immediate`, rounds 1..N). Dodge and Flee simply
  follow liveness while the instance is up, so a faster caster still gets same-round value on top of
  its N snapshots. Refresh re-banks the full count from the recast round.
- ATK/MAG self-buffs currently author `timing: 'defer'`; DEF/RES self-buffs author
  `timing: 'immediate'`. These determine whether the application round consumes duration, not a
  guaranteed number of attacks or mitigated hits: the enemy may already have acted, and later slots
  may be spent healing or lost to stun. SPD follows the snapshot rule above.

## SPD avoidance

SPD's in-fight payoff is capped avoidance — enemy damaging moves can be slipped entirely:
`dodgeChance = clamp(0.02 + (spd − enemySpd) × 0.002, 0.02, 0.20)`. Self-heals, enemy guard stances,
and pure status moves are never dodged. `executeSpecs` rolls once before resolving an enemy move
containing positive-power damage targeting the player; a dodge skips the whole move, including its
riders (test-enforced). Dodges are a visible 💨 round line. Smoke Step (+45% SPD) is a
stay-and-fight defensive tool; Flee still uses SPD separately.

## Enemy moves

- Boss specials: `special.every = N` makes a special due on every Nth enemy action slot (3, 6, 9…
  for `every: 3`). Stunned slots advance the counter but choose no move. A due special rejected as
  wasted falls back to ordinary move selection and is reconsidered at the next cadence window.
- Enemy moves author ordered `EffectSpec[]`. Guard stances use a `statmod` with
  `stat: 'mitigation'`, `duration`, and `timing: 'defer'`; the cast round does not consume duration.
- Pure status moves (Howl) omit damage specs. They apply their authored effects without implicit
  chip damage or dodge rolls.

## Death and revival

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
- Phoenix Cinder auto-revives once per battle (`phoenixUsed`), only from the auto trigger — never by
  hand.
