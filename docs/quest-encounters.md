# Hidden quest encounter assistance

Exploration events can author `questBoosts` to help a player find an encounter while an accepted
quest objective is unfinished. This is internal content tuning: no boost indicator, extra button, or
explanation appears in the game. The initial application is The Old Guardian's Corrupted Stag hunt.
Investigation and implementation are tracked in
[#226](https://github.com/KnightNiwrem/tg-emberdawn/issues/226).

## Authoring

Add a rule to the relevant event in `src/content/zones.ts`:

```ts
{
  kind: 'elite',
  enemy: 'e_stag',
  weight: 1,
  minPlayerLevel: 5,
  text: 'A massive stag with emberless eyes crashes through the brush!',
  questBoosts: [{
    questId: 'sq_stag',
    objective: { kind: 'kill', target: 'e_stag' },
    weight: 18,
  }],
}
```

The quest must exist and contain the specified objective kind and target. Numeric boost weights must
be finite and greater than the event's positive base weight. The objective selector uses structured
identity, so reordering objectives does not change which goal the rule assists. Content integrity
tests enforce references and weights. Authors must also check that the event actually helps that
objective; the selector does not add kills, items, or story effects to an event.

Numeric boosts replace the event's base weight. Probability is effective weight divided by the sum
of effective weights of all eligible events; a weight is not a percentage or a minimum probability.
Other active boosts can change that denominator. Without an applicable rule, the event retains its
base weight and ordinary randomness uses exactly the same single selection draw.

All exploration event kinds support the metadata. For example, a future treasure event awarding
`m_iron_chunk` can author a collection rule for `m5_arms` or `sq_ore`. Collection progress reads the
live inventory, including goods acquired elsewhere. This release ships only the stag tuning;
non-enemy support is exercised by deterministic treasure fixtures.

## Quest and objective lifecycle

The pure `questObjectivePending` helper in `src/engine/quests.ts` reuses the objective-progress
calculation used by quest readiness. Assistance requires all of the following:

- The specified quest is `active`, with no terminal outcome.
- The specified kind and target belong to that quest's definition.
- At least one matching objective still needs progress.

Unaccepted, unavailable, turn-in-ready, completed, failed, and locked quests never activate a rule.
Finishing the selected objective stops assistance even if another objective keeps the quest active.
Selection reads state without changing quest status, counters, receipts, or content definitions.
Existing reward and victory operations remain responsible for progression and readiness notices.

A turn-in-ready collection quest whose goods were spent does not regain assistance merely because
its bag changed. It must return to `active` through the existing quest lifecycle before its rule can
apply again.

## Cross-quest interactions and guarantees

Rules are evaluated independently against their own quests and objectives. There is no quest-list or
rule-list priority, and no additive or multiplicative stacking:

| Applicable rules                                    | Selection behavior                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Multiple numeric boosts for one event               | Largest effective weight wins; duplicates have no effect                     |
| Numeric boosts for different events                 | Each gets its own effective weight; all share the denominator                |
| One quest finishes but another needs the same event | The remaining quest's rule still applies                                     |
| One eligible event has `weight: 'guaranteed'`       | That event has a true 100% chance                                            |
| Several eligible events have applicable guarantees  | Only those events compete, using their base weights                          |
| A guaranteed rule stops applying                    | Recompute the pool; remaining guarantees or numeric boosts apply immediately |

Guarantees take precedence over numeric assistance, so a guaranteed encounter temporarily excludes
ordinary and numerically boosted encounters. A guarantee promises selection from the guaranteed
pool, not an impossible 100% chance for every competing event. Two guaranteed events with base
weights 1 and 3 have probabilities 25% and 75%; neither wins merely by being listed first. Numeric
rules on either event do not alter that split. Duplicate rules do not add extra entries to the pool.

Use guarantees for short, deliberate beats where that precedence is appropriate. A repeatable
encounter that cannot advance its linked objective could indefinitely suppress other encounters;
authors must ensure the objective can progress and consider concurrent quests before using a
guarantee. Numeric boosts are the default choice for hunts that should retain random exploration.

Shared collection goals remain independent: with the two-chunk `m5_arms` and three-chunk `sq_ore`
active, reaching two chunks stops only the main quest's rule. The side quest continues to assist
until three are owned. Completing, locking, or failing one quest cannot cancel the other's boost.

## Eligibility and scope

`questEncounterWeights` in `src/engine/world.ts` runs after level eligibility, safe-haven safety,
and forage filtering. Even a guaranteed event cannot bypass those restrictions. If its event was
filtered out, its guarantee has no effect on the remaining pool. Existing battle, journey, and
dungeon guards still apply before exploration begins. Quiet events and battles resolve through the
existing reward and provenance paths.

This policy covers zone exploration only. It does not change travel tables, dungeon floors, enemy
stats, drop probabilities, quest acceptance, or quest-item relevance caps. The fixed content
metadata and derived weights require no new persisted fields or save-version change.

## Initial tuning and verification

At eligible levels, Whisperwood has 19 total base weight, including the stag's weight of 1. During
its unfinished hunt, the stag receives weight 18 against 18 other weight:

| Measure                                            | Ordinary exploration | Active unfinished stag hunt |
| -------------------------------------------------- | -------------------- | --------------------------- |
| Stag chance per exploration                        | 1/19, about 5.26%    | 18/36, 50%                  |
| Expected explorations to first sighting            | 19                   | 2                           |
| Explorations for at least 95% chance of a sighting | 56                   | 5                           |
| Chance of no sighting after 30 explorations        | About 19.8%          | Less than one in a billion  |

These independent-roll calculations describe finding the encounter, not winning the fight. The
numeric boost shortens the random tail without imposing a hard attempt limit. Stag victory readies
the quest and restores the base rate on the next exploration.

`tests/quest_encounters_test.ts` covers lifecycle boundaries, multi-objective completion, inventory
progress, independent and shared targets, duplicate/order independence, competing guarantees,
eligibility filtering, non-enemy rewards, baseline selection, and the real stag acceptance/victory
path. Run it with `deno test --allow-import tests/quest_encounters_test.ts`, then run the four CI
gates listed in `AGENTS.md`.
