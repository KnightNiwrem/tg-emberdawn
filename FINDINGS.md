# Emberdawn Final Audit Handoff

**Repository:** `KnightNiwrem/tg-emberdawn`\
**Reviewed head:** `c88efd9454f6dfff003f8d53b9540b84fda290c4`\
**Previous repair baseline:** `af337b46a6162288c8c2eebe2d7b64cda69f0380`\
**Purpose:** final re-review of the implementation after two repair passes against the original
game-design, progression, dungeon, combat, economy, persistence, and lifecycle audits.

---

# Executive summary

The second repair pass is successful in the areas that previously threatened campaign correctness.

The project is no longer in the state it was during the first audit.

At the current reviewed head:

> **The main campaign appears structurally completable, the final quest is provenance-correct,
> dungeon state is coherent, and the previously identified P0 lifecycle/combat blockers are
> resolved.**

The remaining findings are now narrower:

- one important legacy-save migration problem;
- permanent surplus quest-item clutter;
- a forage cooldown timing bug;
- several reward/economy progression issues;
- a few generic content-engine robustness gaps;
- some stale/dead content and copy inconsistencies.

This means the next agent should **not perform another broad rewrite**.

A focused cleanup pass is appropriate.

After the remaining items in this document are addressed, the correctness portion of the audit can
reasonably be considered complete and future work can move toward:

- real playtesting;
- class balance;
- encounter difficulty;
- XP/gold pacing;
- retention/endgame design;
- long-term content expansion.

---

# Current severity map

## High

1. Legacy gear dedup migration is still unsafe and does not correctly repair all actual old-save
   shapes.
2. Surplus quest-drop items can become permanent dead inventory because quest items cannot be sold
   or dropped.

## Medium

3. Forage's six-hour cooldown starts one interaction too late.
4. Future save-schema versions can be silently downgraded by an older binary.
5. Boss first-clear trinkets are described as unique one-time loot but remain permanently
   sellable/droppable.
6. Trinket shop availability still follows tier-band ceiling rather than actual player level.
7. Final `m25` item reward is immediately obsolete relative to the Seam first-clear reward.
8. Collect turn-in validation is not fully atomic for duplicate same-item objectives inside one
   quest.

## Low / content integrity

9. Static collect-source reachability testing is still missing.
10. `q_sealed_letter` and `q_village_charm` remain effectively orphan/dead definitions.
11. Rogue copy still promises first-strike/dodge behavior that the combat system does not implement.
12. `m22_umbral_key` is very likely pre-completed by `m21` and remains a weak story beat.
13. Free safe-haven full healing between dungeon floors still removes dungeon attrition if endurance
    was intended.

---

# Findings that are now resolved

The following items from the previous audits appear correctly addressed and should not be reopened
unless later regression tests prove otherwise.

## Campaign progression

- `m11_toll` Automaton capacity is repeatable and no longer hardlocks Chapter 3.
- `m21_loyalty` Crownsworn capacity is repeatable and no longer hardlocks Chapter 6.
- Sunspire unlock timing has been corrected.
- Main quest graph can traverse `m1 → m25`.
- `m25_silence` now requires clearing the Endless Seam rather than killing any `e_warden`.
- Overworld Warden encounters no longer substitute for the final dungeon objective.

## Dungeon state

- Floors advance only on victory.
- Flee does not advance dungeon progression.
- Death does not advance dungeon progression.
- Boss defeat can be retried.
- Cleared bosses can actually be rematched.
- First-clear rewards are applied once.
- Dungeon-floor treasure is granted.
- Battle provenance distinguishes:
  - exploration;
  - elite;
  - dungeon floor;
  - dungeon boss.
- Overworld enemies sharing a boss ID do not trigger dungeon clear.
- Story boss floors are gated.
- Sunspire Key now mechanically gates the Vault boss.
- Sunspire Key is consumed only after the first victorious keyed descent, preserving retryability
  after a loss.

## Combat

- Smoke Bomb guarantees escape from non-boss fights.
- Smoke Bomb is not wasted against bosses.
- Venom Cut weakens enemy offense instead of the Rogue.
- Invalid MP/cooldown actions do not spend a turn.
- Skill buttons disable unavailable actions.
- Combat engine validates that submitted skills:
  - belong to the player's class;
  - have actually been learned.
- SPD buffs affect flee chance.
- Phoenix Cinder:
  - is automatic-only;
  - cannot be manually wasted;
  - activates at most once per battle.
- Legacy persisted combat buff fields are normalized to safe defaults.

## Equipment / forge

- New players no longer start with equipped items duplicated in inventory.
- Equip actions verify actual inventory ownership.
- HP/MP are clamped after equipment changes.
- All four classes now start at their real derived max HP/MP.
- Cleric starting HP aggregation is fixed.
- Forge material requirement is based on item tier rather than current zone.
- Forge bonuses apply to the item's own stats before aggregation.
- Trinket stats no longer accidentally inherit weapon/armor temper scaling.
- Temper is no longer generic slot-global progression.

## Economy / item availability

- Tier-8 class gear has a purchase path.
- Gear tier threshold math is fixed:
  - tier 2 at level 7;
  - tier 3 at level 13;
  - etc.
- `t_9`–`t_11` are no longer hidden until endgame by array-position logic.
- Dungeon first-clear rewards now use dedicated boss trinkets `t_12`–`t_18` tuned near encounter
  level.
- Post-cap XP now converts into gold rather than disappearing.

## Telegram lifecycle / persistence

- Normal callback commits persist the final live `messageId`.
- `/reset` persists the new live message correctly.
- `/start` re-centers without treating the player as dead.
- `/start` preserves active/won battles and gameplay state.
- Renderer notice handling is pure.
- Resend fallback is restricted to known message-edit failure cases.
- Class-pick persistence occurs after final commit.
- Stale class pickers cannot overwrite an existing character.
- Meta callbacks with existing saves respect staleness rules.
- Newer-message adoption survives clone-on-read/Postgres-style stores.
- Callback player state is loaded once rather than fetched again after adoption.

## Documentation

- README now says 7 dungeons rather than 8.
- Phoenix Cinder wording is clearer.
- Campaign graph test is now named honestly as a quest-graph traversal test rather than a complete
  pacing simulation.

---

# High-1 — Legacy gear migration is still unsafe

## Current design

`stateVersion` is now present and is the correct long-term migration mechanism.

Current version:

```ts
CURRENT_STATE_VERSION = 2;
```

The migration approximately does:

```ts
const from = p.stateVersion ?? 0;

if (from < 1) {
  for (const slot of ['weapon', 'armor']) {
    const eq = p.equipment[slot];
    if (eq && countOf(p, eq) > 0) {
      removeItem(p, eq, 1);
    }
  }
}

if (from < 2) {
  // forge/battle migrations
}

p.stateVersion = CURRENT_STATE_VERSION;
```

The intent is:

> remove the legacy duplicate bag copy of equipped starter gear exactly once.

The version-gating is correct in principle.

The retrospective inference is not reliable.

---

## Problem A — unversioned saves belong to more than one historical cohort

There are at least two kinds of saves with no `stateVersion`.

### Cohort 1 — truly old saves

Created before the starting-equipment duplication fix.

These may legitimately contain the old bug.

### Cohort 2 — intermediate saves

Created after the starting-equipment duplication fix but before `stateVersion` was introduced.

These are also deserialized as:

```ts
stateVersion === undefined;
```

and therefore treated as v0.

But these players may legitimately own another copy of the currently equipped item.

Example:

```text
equipped:
  Iron Sword

inventory:
  Iron Sword ×1
```

This may be a legitimate later purchase.

The v0 migration removes it anyway.

That is destructive player-data loss.

---

## Problem B — the migration does not reproduce the real old duplication shape after gear swaps

The old creation bug put starting gear in:

- equipment;
- inventory.

Then when the player equipped a new weapon, the equip path also returned the previous equipped
starter weapon to inventory.

A realistic legacy state can therefore look like:

```text
equipped:
  Steel Longsword

inventory:
  Rusty Blade ×2
```

The duplicated item is the _old starter weapon_, not the currently equipped weapon.

The migration examines only the current equipped ID:

```text
Steel Longsword
```

finds none in the bag and removes nothing.

The real duplicate remains.

---

## Problem C — legacy temper can be lost if its slot is currently empty

The v0/v1 forge migration moves:

```text
forge_weapon
forge_armor
```

onto the currently equipped item ID.

If the slot is empty:

```text
forge_weapon = 5
equipment.weapon = undefined
```

there is nowhere to migrate the value.

The migration then deletes the old slot flag.

A player can therefore lose historical temper investment.

---

## Recommendation

### Safest approach

Stop trying to perform automatic destructive gear deduplication on arbitrary unversioned saves.

Prefer:

> harmless grandfathered duplicate equipment

over:

> deleting legitimate player-owned gear.

The existence of one extra starter item has a small economic effect.

Incorrect deletion is a permanent data-loss bug.

### If cleanup is still desired

Use a much narrower migration backed by a reliable cohort signal.

Potential signals:

- player `createdAt` relative to known deployment timestamps;
- exact known starter item;
- exact inventory/equipment historical combination;
- no later-equipment history if such history exists.

But do not simply assume:

```text
no stateVersion = duplicate currently equipped gear
```

because that is not historically true.

### Future-version protection

Also add:

```ts
if (from > CURRENT_STATE_VERSION) {
  return;
}
```

or throw/refuse mutation.

An older application binary must never silently rewrite:

```text
stateVersion = 3
```

back to:

```text
stateVersion = 2
```

after loading a future save.

---

## Tests to add

### Intermediate unversioned legitimate duplicate

```text
stateVersion undefined
equipped = w_warrior_2
inventory = w_warrior_2 ×1
created after original equipment fix
```

Migration must not delete legitimate property unless the historical cohort can be proven old.

### Real swapped legacy bug

```text
stateVersion undefined
equipped = w_warrior_2
inventory = w_warrior_1 ×2
```

The test should model the actual old creation + first-swap sequence rather than simply manually
putting the currently equipped item into the bag.

### Empty-slot temper

```text
forge_weapon = 5
equipment.weapon = undefined
```

Migration must have an explicit policy:

- preserve legacy flag;
- defer migration;
- convert to another representation.

Do not silently delete investment.

### Future save

```text
stateVersion = CURRENT_STATE_VERSION + 1
```

Current binary must not downgrade or destructively migrate it.

---

# High-2 — Surplus quest-drop items can become permanent dead inventory

## New behavior

Quest items can no longer be dropped.

Quest items are also marked `unique` and cannot be sold.

This protects important quest progress.

However, several quest items are random repeatable enemy drops.

Those drops continue even after the player has enough or has already resolved the relevant quest.

The result is permanent bag clutter.

---

## Umbral Key example

Crownsworn drop:

```text
q_umbra_key = 25%
```

`m21_loyalty` requires killing 10 Crownsworn.

Probability of obtaining at least one key from those 10 kills:

```text
1 - 0.75^10 ≈ 94.37%
```

Probability of obtaining at least two:

```text
≈ 75.6%
```

`m22_umbral_key` consumes only one.

Any excess remains forever.

Crownsworn continue dropping more after the quest.

The player cannot:

- sell them;
- drop them;
- consume them meaningfully.

---

## Sunspire Key example

The Sunspire Key can come from:

- Sun Cultist random drop;
- Brass Automaton random drop;
- guaranteed `m11_toll` reward.

Mandatory story combat already gives many random opportunities before the guaranteed key.

The Vault consumes one.

Any extra copies remain.

---

## Other possible cases

Review every random quest-item drop:

- toxin samples;
- Frost Emblems;
- Cinder Sigils;
- Umbral Keys;
- Sunspire Keys.

Some are multi-count objectives, so globally capping all quest items to 1 would be wrong.

---

## Recommended model

Make random quest-item drops context-sensitive.

Example:

```ts
function canDropQuestItem(
  p: PlayerState,
  itemId: string,
): boolean;
```

Rules might include:

- only while the relevant quest is active/available;
- stop when current count reaches required amount;
- stop permanently once the quest/gate is complete;
- allow explicit exceptions for reusable story resources.

### Alternative

On quest completion:

- consume required amount;
- automatically remove all now-obsolete extras;
- print a small line explaining that leftovers are handed over/discarded.

This is simpler but less elegant.

### Better content architecture

Attach quest-item metadata:

```ts
questUse?: {
    questId: string;
    maxRelevantQty?: number;
    obsoleteAfter?: string;
}
```

Then drop logic can remain generic.

---

## Tests

- After `m22` is done, Crownsworn kills do not add Umbral Keys.
- Before `m22`, key quantity does not exceed intended relevant cap unless explicitly allowed.
- After Vault first-clear, no additional Sunspire Keys accumulate.
- Multi-count quest items still allow the required quantity.

---

# Medium-1 — Forage cooldown starts one interaction too late

## Current behavior

Safe-haven forage has three charges.

Once exhausted, the intended design is:

> wait six real-world hours before caches recharge.

Free travel no longer resets the allowance, which correctly fixes the previous infinite travel loop.

However, `forageResetAt` is currently created only when the player performs another Explore/Forage
action _after_ the counter is already at 3.

---

## Example

```text
12:00 charge 1
12:01 charge 2
12:02 charge 3
```

The player is now exhausted.

But no reset timestamp is necessarily created yet.

They return at:

```text
17:00
```

five hours later.

Their next Forage interaction discovers:

```text
foraged >= 3
forageResetAt is undefined
```

and sets:

```text
forageResetAt = 23:00
```

The player now waits six more hours rather than approximately one.

---

## Correct behavior

Set the recharge timestamp **when the final charge is consumed**.

Conceptually:

```ts
foraged++;
p.flags[forageKey] = foraged;

if (foraged >= MAX_FORAGE_CHARGES) {
  p.flags[resetKey] = now + FORAGE_COOLDOWN;
}
```

Then subsequent interactions simply check expiry.

---

## Also recommended: inject time

`src/engine/world.ts` currently calls:

```ts
Date.now();
```

directly.

The rest of the engine is designed to be deterministic/pure.

Prefer:

```ts
explore(p, rng, now = Date.now());
```

or a small clock abstraction.

Benefits:

- deterministic tests;
- no sleep/mock-clock hacks;
- easier future daily/weekly mechanics.

---

# Medium-2 — Future state versions should not be downgraded

This is a generic save-schema safety invariant.

Current migration ultimately writes:

```ts
p.stateVersion = CURRENT_STATE_VERSION;
```

even when the loaded save may theoretically have come from a newer application version.

Future scenario:

```text
server A deploys stateVersion 3
rollback to older binary supporting version 2
older binary loads v3 save
older binary writes version 2
```

This can cause loss of new state.

## Fix

At migration entry:

```ts
if (from > CURRENT_STATE_VERSION) {
  throw new Error(
    `Save version ${from} is newer than supported ${CURRENT_STATE_VERSION}`,
  );
}
```

or return a typed incompatibility result.

Do not mutate.

---

# Medium-3 — Boss first-clear trinkets are one-time loot but not protected

The new dungeon rewards are a major improvement.

Current first-clear rewards:

```text
Rootbound        → t_12 Rootwoven Band
Sunken Shrine    → t_13 Tidecaller's Pearl
Vault of Hours   → t_14 Hourglass Charm
Glacier Maw      → t_15 Rimeheart Locket
Pyre Caldera     → t_16 Cinderheart Braid
Sundered Throne  → t_17 Regalia of the Dawn
Endless Seam     → t_18 Voidseeker's Lens
```

These are level-appropriate and much better than the old obsolete reward chain.

However, the code comments and AGENTS documentation describe them as:

> unique boss trinkets

but their `ItemDef`s do not set:

```ts
unique: true;
```

Therefore players can:

- sell them;
- drop them;

and because first-clear is one-time, they can never obtain the item again.

---

## Design decision

### If disposable one-time rewards are intentional

Keep current mechanics but avoid calling them "unique" in a way that implies permanent collectible
protection.

### If they are collectible trophies

Protect them.

Possible approaches:

```ts
unique: true;
```

but note the current `unique` field is overloaded and currently mainly means:

> cannot be sold

It does not necessarily mean:

> only one may exist / cannot be dropped / recoverable.

A cleaner model would split:

```ts
sellable?: boolean
droppable?: boolean
recoverable?: boolean
maxOwned?: number
```

---

# Medium-4 — Trinket shop availability still leads player level

The previous bug was:

> low-level trinkets `t_9`–`t_11` only appeared in endgame because array order was used as
> progression order.

That is fixed.

Current logic instead uses the shop tier band:

```ts
const trinketCap = t * 6;
```

and stocks every normal trinket whose level is below that cap.

This can still offer items above the player's actual level.

Examples:

### Tier 1

A level-1 player can be shown:

- Lucky Coin, level 3;
- Thorn Ring, level 5.

### Tier 2

A level-7 player can be shown items up to roughly level 12, including things not yet equippable.

Buying is allowed even though equipping later rejects the item.

---

## Better rule

`currentStock(p)` knows the player's actual level.

Filter equipment to:

```ts
item.level <= p.level;
```

unless deliberately allowing players to buy ahead.

A useful shop policy is:

```text
zone controls maximum tier
player level controls currently usable stock
```

rather than:

```text
zone/player tier exposes the entire band
```

---

# Medium-5 — Final `m25` item reward is immediately obsolete

The Endless Seam first-clear now gives:

```text
t_18 Voidseeker's Lens
level 45
+34 ATK
+34 MAG
+18 Luck
```

This is appropriate final dungeon gear.

Then `m25_silence` still rewards:

```text
t_7 Glass Arrowhead
level 32
+26 ATK
+10 Luck
```

So immediately after receiving `t_18`, the final quest gives a strictly worse physical-offense
trinket.

That makes the last item reward anticlimactic.

---

## Recommended replacements

### Option A — no second equipment reward

Let `t_18` be the final equipment reward.

Change `m25` item reward to:

- Void Fragments;
- Elixirs;
- gold;
- prestige currency.

### Option B — story trophy

Create a non-power reward:

```text
Dawncaller Sigil
Seamwalker Mark
Morning's Witness
```

which could later tie into:

- achievements;
- cosmetics;
- profile display;
- New Game+;
- prestige.

### Option C — true final capstone

Give a different level-45 reward not directly dominated by `t_18`, e.g. defensive/utility build
alternative.

---

# Medium-6 — Collect atomicity is not generic for repeated same-item objectives

Current turn-in logic correctly revalidates inventory before consuming goods.

This solves all current quest sharing cases inspected.

However, the validation is per objective.

Future quest:

```ts
[
  { kind: 'collect', target: 'm_iron_chunk', count: 3 },
  { kind: 'collect', target: 'm_iron_chunk', count: 3 },
];
```

Player owns only:

```text
3 Iron Chunks
```

Validation:

```text
objective 1 sees 3 >= 3 → pass
objective 2 sees 3 >= 3 → pass
```

Consumption:

```text
remove 3 → success
remove 3 → failure
```

The quest can still be completed despite only having half the total required supply.

No current quest appears to use duplicate same-item collect objectives, so this is not a live
campaign blocker.

---

## Fix

Aggregate requirements first:

```ts
const required = new Map<string, number>();

for (const obj of q.objectives) {
  if (obj.kind !== 'collect') continue;
  required.set(
    obj.target,
    (required.get(obj.target) ?? 0) + (obj.count ?? 1),
  );
}
```

Validate the aggregated totals.

Then consume exactly those totals.

---

# Low-1 — Add a progression-aware collect-source integrity test

The kill-capacity test is good.

A corresponding static collect-source test is still missing.

Manual inspection of current main-story collect objectives does not reveal a hardlock:

- Ember Shards → multiple repeatable early enemies;
- Toxin Samples → repeatable Leech/Drowned;
- Frost Emblems → repeatable Frost Wraith;
- Cinder Sigils → repeatable Revenant;
- Umbral Key → repeatable Crownsworn;
- Sunspire Key is a guaranteed quest reward before it is mechanically required.

But this is not automatically enforced.

---

## Recommended test model

For every collect objective:

1. identify target item;
2. find all sources:
   - enemy drops;
   - shops;
   - exploration treasure;
   - dungeon floor treasure;
   - dungeon first-clear;
   - prior quest rewards;
3. determine whether at least one source is available before/during that quest;
4. for probabilistic finite sources, require repeatability;
5. ensure finite guaranteed supply is >= required quantity.

Example failure:

```text
Quest needs Item X ×4
Only source:
one-time dungeon floor with 30% chance
→ invalid
```

---

# Low-2 — Orphan quest items remain

The catalog still contains:

```text
q_sealed_letter
q_village_charm
```

without meaningful current gameplay use.

## Sealed Letter

`m2_letter` narrates:

> Maren gives the player a sealed letter to bring to Bram.

But mechanically the quest is only:

```text
talk to Bram
```

The player never actually receives/loses the defined `q_sealed_letter`.

### Options

Wire it properly:

```text
m1 reward → q_sealed_letter
m2 collect/delivery or talk+consume
```

or remove the item definition.

## Village Charm

Likewise appears to have no active acquisition/use path.

If future content is not imminent, remove it to keep content integrity meaningful.

---

# Low-3 — Rogue description promises mechanics that do not exist

Rogue description still says roughly:

> High speed and crits. Strikes first, dodges, flees like a professional.

Current combat behavior:

- player generally acts first regardless of class;
- there is no dodge mechanic;
- SPD now meaningfully affects flee chance.

Therefore only the flee claim is mechanically grounded.

## Options

### Update copy

Something like:

> High speed and crits. Excels at escaping bad fights and striking hard.

### Or add mechanics later

- initiative/order based on SPD;
- capped dodge chance;
- first-turn bonus.

Do not leave class identity text promising systems that do not exist.

---

# Low-4 — `m22_umbral_key` remains nearly auto-completed

Crownsworn have a 25% Umbral Key drop.

`m21_loyalty` requires killing 10 of them.

Probability of having at least one key by the end:

```text
~94.4%
```

So `m22_umbral_key` will usually be ready immediately after acceptance.

This is not incorrect anymore.

It is simply a weak progression beat.

## Possible improvements

- make `m21` itself award the key;
- remove `m22`;
- make `m22` require a named elite/captain;
- make the key guaranteed from a specific post-`m21` encounter;
- convert `m22` into an NPC/story handoff rather than pretending collection is a meaningful new
  task.

---

# Design note — dungeon attrition is still optional rather than enforced

Dungeons now have correct floor state.

However:

- dungeon progress persists;
- travel is free;
- entering Emberdawn fully restores HP/MP.

Optimal safe play remains:

```text
clear floor
→ travel Emberdawn
→ full heal
→ return
→ next floor
```

This is not a correctness bug.

It is a design decision.

## If independent dungeon floors are intended

No change needed.

## If dungeon endurance is intended

Consider:

- leaving resets the run;
- travel disabled during an active dungeon run;
- checkpoint system;
- limited healing between floors.

Do not balance dungeon difficulty around resource attrition unless the game actually enforces it.

---

# Test-suite assessment

The test suite is now significantly stronger.

Good improvements include:

- main quest graph traversal;
- kill encounter-capacity check;
- `m25` dungeon provenance regression;
- Smoke Bomb;
- Venom Cut;
- invalid skill turn semantics;
- Phoenix once-per-battle;
- `/start` neutrality;
- stale class picker protection;
- clone-on-read message adoption;
- combat migration finite-number check;
- equip ownership;
- skill authority;
- pool clamping;
- collect turn-in revalidation;
- shared-resource quest contention;
- shop tier boundary;
- postgame XP conversion;
- forage travel-reset regression.

Remaining notable gaps:

- real historical swapped-save gear migration fixture;
- future state-version protection;
- quest-item surplus cleanup;
- forage timer-start timing;
- collect same-item aggregate requirements;
- progression-aware collect source test;
- one-time boss-trinket disposal policy.

---

# Recommended final repair pass

## Phase 1 — save safety

1. Rework/remove the unsafe retrospective v0 equipment dedup.
2. Add a realistic old first-swap migration test.
3. Preserve/defer legacy temper when the slot is empty.
4. Reject/ignore future `stateVersion` saves rather than downgrading them.

## Phase 2 — quest-item lifecycle

5. Prevent irrelevant/excess random quest-item drops.
6. Decide whether obsolete extras are auto-purged at quest completion.
7. Add tests for Umbral/Sunspire key accumulation.

## Phase 3 — economy/reward cleanup

8. Start forage cooldown when the last charge is consumed.
9. Inject `now` into world-time logic.
10. Decide whether boss trinkets are disposable or protected.
11. Filter normal trinket stock by actual player level.
12. Replace `m25`'s obsolete `t_7` reward.
13. Review stacked endgame XP→gold payouts.

## Phase 4 — engine/content robustness

14. Aggregate repeated same-item collect requirements.
15. Add collect-source reachability tests.
16. Remove or wire orphan quest items.
17. Update Rogue identity copy or implement the promised mechanics.
18. Decide whether `m22` should remain as-is.

---

# Final acceptance checklist

I would consider the correctness audit closed when:

## Campaign

- [x] Main quest graph is traversable.
- [x] `m11` has repeatable Automaton supply.
- [x] `m21` has repeatable Crownsworn supply.
- [x] `m25` specifically requires the Endless Seam.
- [x] Overworld Warden cannot substitute for final dungeon progress.
- [x] Story boss floors are gated appropriately.
- [x] Sunspire Key has real mechanical function.
- [ ] Static collect-source test protects future content.

## Dungeon

- [x] Start does not advance floor.
- [x] Victory advances floor.
- [x] Flee does not advance.
- [x] Death does not advance.
- [x] Boss retry works.
- [x] Boss rematch works.
- [x] First-clear occurs exactly once.
- [x] Floor treasure works.
- [x] Battle origin controls dungeon bookkeeping.

## Combat

- [x] Smoke Bomb works.
- [x] Venom Cut works.
- [x] Invalid skill use costs no turn.
- [x] Skill ownership/class validated.
- [x] SPD has meaningful flee impact.
- [x] Phoenix is automatic-only.
- [x] Phoenix is once-per-battle.
- [x] Legacy combat state migrates safely.

## Equipment / forge

- [x] New saves have no bag/equipment duplication.
- [ ] Legacy duplicate cleanup cannot delete legitimate gear.
- [ ] Real swapped legacy state migration is handled or intentionally grandfathered.
- [ ] Empty-slot legacy temper has explicit preservation policy.
- [x] Equip validates ownership.
- [x] Pool clamping works.
- [x] All classes start at true full pools.
- [x] Forge material depends on item tier.
- [x] Forge stat scaling is item-local.
- [ ] Boss-trinket disposal/uniqueness semantics are explicit.

## Economy

- [x] Tier-8 gear is available.
- [x] Gear tier level boundaries are correct.
- [x] Low-level trinkets are no longer hidden until endgame.
- [ ] Shop does not unintentionally sell equipment above actual player level.
- [x] Boss rewards are level-appropriate.
- [ ] Final quest reward is not immediately obsolete.
- [x] Post-cap XP produces real value.
- [ ] Forage cooldown starts at actual exhaustion time.
- [x] Free travel cannot directly reset forage.

## Quest items

- [x] Collect turn-in revalidates current supply.
- [x] Shared resources across different quests cannot be reused after consumption.
- [ ] Duplicate same-item objectives inside one quest aggregate requirements.
- [ ] Surplus random quest items do not become permanent clutter.
- [ ] Orphan quest items are removed or wired.

## Persistence / Telegram

- [x] Ordinary commit saves final message pointer.
- [x] `/reset` saves final message pointer.
- [x] `/start` re-centers without gameplay mutation.
- [x] `/start` preserves battle state.
- [x] Stale class picker cannot replace an existing character.
- [x] Class creation saves after commit.
- [x] Clone-on-read newer-message adoption works.
- [x] Renderer is pure.
- [ ] Future save versions cannot be downgraded.

---

# Final verdict

The project has passed the point where broad progression correctness is the primary concern.

The two repair passes have successfully fixed the major structural problems:

- story hardlocks;
- dungeon-state corruption;
- boss softlocks;
- final-quest provenance;
- broken combat item/skill semantics;
- message-pointer lifecycle issues;
- most equipment/forge inconsistencies.

The remaining highest-value work is now:

> **save migration safety and item lifecycle hygiene**

rather than campaign architecture.

Once the legacy migration issue, quest-item accumulation, forage timing, and the remaining
medium/low integrity items are addressed, this audit can be considered substantially complete.

At that point, further effort should shift from correctness auditing toward:

- actual playthroughs from level 1 to 45;
- class win-rate/difficulty comparisons;
- boss tuning;
- potion/MP economy;
- gold inflation;
- forge affordability;
- drop-rate feel;
- postgame reward cadence;
- retention and content pacing.
