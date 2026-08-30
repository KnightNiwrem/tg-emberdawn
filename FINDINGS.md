# Emberdawn Re-Review: Remaining Audit Findings After the First Repair Pass

**Repository:** `KnightNiwrem/tg-emberdawn`  
**Current reviewed head:** `af337b46a6162288c8c2eebe2d7b64cda69f0380`  
**Previous audited baseline:** `53ecf548382a69f39288f19dda070eb816f3fc4b`  
**Purpose:** verify completeness/correctness of the implementation intended to resolve the previous game-design/progression audit.

---

# Executive summary

The repair pass is a **substantial improvement**.

The previous deterministic main-story hardlocks in Chapter 3 and Chapter 6 are genuinely fixed, and the dungeon/combat changes are mostly implemented correctly rather than cosmetically.

In particular, the following major systems are now materially better:

- dungeon battles carry structured provenance;
- normal dungeon floors advance only after victory;
- flee/death no longer inherently skips floors;
- floor treasure is actually granted;
- boss rematches exist;
- story boss floors are gated;
- Automaton and Crownsworn main-quest kill capacities are now repeatable;
- overworld encounters no longer automatically trigger dungeon first-clear bookkeeping;
- Smoke Bomb works;
- Venom Cut weakens the enemy rather than the Rogue;
- invalid cooldown/MP skill taps no longer spend a turn;
- SPD buffs affect fleeing;
- Phoenix Cinder is automatic-only and once-per-battle;
- new-character equipped gear no longer also exists in the bag;
- forge material and stat scaling are much more coherent;
- tier-8 class gear is purchasable;
- normal callback message-pointer persistence is fixed;
- renderer notice consumption is now pure;
- the Telegram resend whitelist is appropriately narrowed.

However:

> **The previous audit should not yet be considered closed.**

There are still several significant correctness gaps, including one final-story bypass, migration/data-loss bugs, message-lifecycle regressions, collect-quest delivery bugs, and multiple gameplay integrity checks still missing from the engine.

The project has moved from:

> **campaign structurally broken**

to:

> **campaign broadly functional, but correctness-incomplete**

The remaining work is much narrower and more actionable than the original audit.

---

# Current priority map

## P0 — high-severity correctness / save integrity / story correctness

1. `m25_silence` can still be completed from an overworld Warden without entering the Endless Seam.
2. `/start` kills/abandons the player if any battle exists.
3. `backfillPlayer()` can silently delete legitimate duplicate inventory gear on every load.
4. Legacy active battles are not fully migrated for newly-added combat buff fields and can produce `NaN` combat values.
5. Stale onboarding/meta callbacks can bypass the live-message staleness guard and potentially reset an existing character.
6. Class-pick commit/save ordering still retains the old message-pointer persistence bug on that one path.
7. Newer-message adoption can be lost because the callback path loads the player twice.

## P1 — significant gameplay correctness / incomplete original fixes

8. Collect quests can still be turned in after required goods are spent/dropped.
9. Dungeon/cache/first-clear item gains do not consistently trigger collect-objective refresh.
10. Sunspire Key remains narrative-only and does not mechanically gate the Vault boss.
11. Engine equip logic does not verify the player still owns the item.
12. Engine skill execution does not verify the player has learned that skill or that it belongs to their class.
13. Equipping/unequipping gear can leave current HP/MP above the new maximum.
14. Cleric creation miscalculates starting HP because weapon/armor stat objects are shallow-merged instead of summed.
15. Shop tier formula unlocks new gear one level too early.
16. `t_9`–`t_11` trinkets now have a source, but their acquisition timing is badly wrong.
17. Boss first-clear trinket rewards remain obsolete by the time they are earned.
18. Postgame XP remains mechanically worthless.
19. Safe-haven forage remains infinitely repeatable through free travel resets.

## P2 — design / test / documentation completeness

20. The flagship `m1→m25` test is useful but is not a true full progression simulation.
21. There is still no systematic collect-item acquisition-source test.
22. Free safe-haven healing between dungeon floors still removes dungeon attrition.
23. Forge temper is bound to item ID/model, not an individual item instance; clarify whether that is intended.
24. README still has stale dungeon/count/wording details.

---

# Findings that are genuinely resolved

These do **not** need another redesign unless later tests reveal a regression.

## Main quest encounter capacity

### `m11_toll`

Previously required four Automatons but had fewer than four possible encounters.

Now `e_automaton` is present in Sunspire's repeatable exploration table.

**Status:** resolved.

### `m21_loyalty`

Previously required ten Crownsworn but Crownsworn existed only in limited one-time dungeon floors.

Now `e_crownsworn` is present in Umbral Spire exploration.

**Status:** resolved.

---

## Dungeon progression

The dungeon rewrite correctly improves the state machine:

- structured `BattleOrigin`;
- no floor advancement on battle start;
- normal-floor advancement on victory;
- normal-floor treasure on victory;
- boss rematches after clear;
- dungeon first-clear logic only on dungeon-origin boss victories.

**Status:** substantially resolved.

---

## Combat semantics

Correctly resolved:

- Smoke Bomb escapes normal fights and is not consumed against bosses.
- Venom Cut writes enemy-side weaken state.
- Enemy outgoing damage respects that weaken.
- Invalid MP/cooldown skill use does not progress enemy phase.
- Skill menu disables unavailable skills.
- Flee probability uses buffed SPD.
- Phoenix Cinder is hidden from manual battle-item use.
- Phoenix Cinder triggers at most once per battle.

**Status:** resolved.

---

## Forge core behavior

Correctly improved:

- temper material comes from the equipped item's tier, not current location;
- temper level is no longer a generic slot-global upgrade;
- stat scaling occurs per equipment item before aggregation;
- trinket stats no longer accidentally receive weapon/armor temper scaling.

**Status:** core original bugs resolved.

One semantic caveat remains later in this document: temper is really bound to **item ID/model**, not individual item instance.

---

## Rendering and normal callback persistence

Correctly improved:

- notice rendering no longer mutates player state;
- normal callback `commit()` occurs before final persistence;
- resend-updated `messageId` is therefore stored;
- resend error matching is no longer effectively "resend on almost anything".

**Status:** resolved for the ordinary callback path.

There are still special-path issues in onboarding and `/start`.

---

# P0-1 — Final story quest still bypasses the Endless Seam

## Current behavior

`m25_silence` still has the objective:

```ts
{ kind: 'kill', target: 'e_warden', count: 1 }
```

The Abyss exploration table still contains `e_warden` as an overworld elite.

Structured battle provenance now correctly prevents an overworld Warden from setting the Endless Seam dungeon-clear flag.

That is good.

However, quest kill progress remains keyed only by enemy ID.

Therefore an overworld Warden kill still increments `m25_silence`.

The new regression test even explicitly expects this:

> overworld Warden kill counts the quest but does not clear the Seam

That means a player can finish the final story quest without ever entering the final dungeon.

## Practical sequence

1. Finish `m24_below`.
2. Accept `m25_silence`.
3. Remain in Abyss overworld.
4. Explore until elite `e_warden` appears.
5. Kill it.
6. `m25_silence` becomes ready.
7. Turn it in.
8. Receive final outro / `seamConquered`.
9. Endless Seam never entered.

## Why this matters

The narrative explicitly says:

> Face the Warden of the Void **at the bottom of the Seam**.

The implementation still treats:

> kill any enemy with ID `e_warden`

as equivalent.

## Recommended fix

### Preferred

Use the existing `dungeon` objective type:

```ts
objectives: [
  { kind: 'dungeon', target: 'd_seam' }
]
```

Then add a dungeon-completion hook from actual first boss clear.

Conceptually:

```ts
export function onDungeonClear(p: PlayerState, dungeonId: string): void {
    progressObjective(p, 'dungeon', dungeonId);
}
```

Call it only on first clear of that dungeon.

### Alternative

Create a different overworld elite ID, e.g.:

```text
e_void_reaver
e_abyssal_harbinger
e_lesser_warden
```

and reserve `e_warden` for the dungeon boss.

This is also desirable for narrative uniqueness.

### Test

Replace the current test with two assertions:

```text
overworld elite kill:
- m25 remains active
- seam not cleared

d_seam boss kill:
- m25 progresses
- seam clears
```

---

# P0-2 — `/start` now treats an active battle as a death

## Current implementation

`handleStart()` re-centers to a fresh message, but before doing so it checks for any battle and calls death handling.

Equivalent behavior:

```ts
if (existing.battle) {
    existing.battle = undefined;
    existing.notices.push(applyDeath(existing));
}
```

`applyDeath()`:

- increments deaths;
- removes 10% gold;
- moves player to safe haven;
- sets HP/MP to half.

## Problem

`/start` is documented and conceptually used as:

> re-center the game message if it is buried

It should not be a gameplay action.

A user can issue `/start` in the middle of a perfectly healthy boss fight simply because the game message is far up the Telegram chat.

They then lose:

- the fight;
- 10% gold;
- their current location;
- one death statistic.

It also triggers if a battle is already `won` but the user has not yet tapped Continue.

## Recommended fix

`/start` should preserve all current gameplay state.

It should only force a fresh live message:

```ts
existing.notices = ['🧭 The flame guides you back.'];
existing.messageId = undefined;

await commit(ctx, existing);
await store.set(from.id, existing);
```

No battle mutation.

No death.

No travel.

No gold penalty.

If an explicit abandon-battle mechanic is desired, create a dedicated control/command.

## Test

Integration test:

1. enter battle;
2. record:
   - HP;
   - MP;
   - gold;
   - currentZone;
   - battle state;
   - deaths;
3. send `/start`;
4. assert:
   - battle unchanged;
   - gold unchanged;
   - deaths unchanged;
   - zone unchanged;
   - new `messageId` persisted.

Also test a won-but-not-continued battle.

---

# P0-3 — Existing-save equipment migration can delete legitimate inventory

## Current migration

To clean up the old "equipped gear is also in inventory" bug:

```ts
for (const slot of ['weapon', 'armor']) {
    const eq = p.equipment[slot];
    if (eq && countOf(p, eq) > 0) removeItem(p, eq, 1);
}
```

This runs every time `backfillPlayer()` runs.

## Why this is unsafe

The same item ID can legitimately exist:

- equipped once;
- plus one or more extra copies in inventory.

Example:

```text
Iron Sword equipped
Iron Sword ×2 in bag
```

The migration cannot determine whether those bag copies are:

- old invalid legacy duplicates;
- or legitimate purchases/drops.

Every load removes one.

Repeated callbacks can therefore delete legitimate player property.

## Recommended solution: explicit save schema version

Add something like:

```ts
interface PlayerState {
    stateVersion: number;
    ...
}
```

Example:

```ts
const CURRENT_STATE_VERSION = 2;

export function migratePlayer(p: PlayerState): void {
    const version = p.stateVersion ?? 0;

    if (version < 1) {
        migrateLegacyStartingGearDuplication(p);
    }

    if (version < 2) {
        migrateBattleProvenanceAndBuffs(p);
    }

    p.stateVersion = CURRENT_STATE_VERSION;
}
```

Each destructive migration runs once.

## Important

Do not use:

> "if state happens to look like old state"

as the migration marker for destructive operations.

Use an explicit version.

## Tests

- old save with duplicate starter gear → cleaned once;
- call migration again → no further removal;
- new save with equipped Iron Sword + legitimate bag copies → untouched;
- persistence round-trip keeps `stateVersion`.

---

# P0-4 — Legacy active battles lack new enemy weaken fields

## Change

`CombatBuffs` now contains:

```ts
enemyWeakenedPct
enemyWeakenTurns
```

Enemy damage uses:

```ts
1 - buffs.enemyWeakenedPct
```

## Existing-save problem

An old persisted battle created before these fields existed has no such properties.

JavaScript behavior:

```ts
1 - undefined === NaN
```

That can propagate into:

- enemy offense;
- raw damage;
- player HP.

## Current migration

Battle origin string migration exists.

New combat fields are not initialized.

## Fix

As part of versioned battle migration:

```ts
b.buffs.enemyWeakenedPct ??= 0;
b.buffs.enemyWeakenTurns ??= 0;
b.phoenixUsed ??= false;
```

Also review every other field added to persisted state since the prior schema.

## Test

Construct a literal pre-update serialized battle shape with:

- old string origin;
- no enemy weaken fields;
- no phoenixUsed;

run migration;

then perform an enemy action and assert:

- all stats finite;
- damage finite;
- no `NaN`;
- correct structured origin.

---

# P0-5 — Meta callbacks bypass the staleness guard

## Current routing

Meta callbacks are handled before ordinary live-message validation.

Conceptually:

```ts
if (cb.v === 'meta') {
    handleMeta(...);
    return;
}
```

## Problem

This makes stale button-bearing messages special in a dangerous way.

### Worst case: stale class picker

Sequence:

1. User sends `/start` twice before creating a character.
2. Two class-picker messages exist.
3. User chooses Mage on picker B.
4. Plays for a while.
5. Later taps Warrior on stale picker A.
6. Meta callback bypasses staleness guard.
7. `metaAction('pick')` creates a new Warrior.

This can reset the player's character without `/reset`.

## Additional issue

Old Help buttons also bypass ordinary staleness semantics and can change the current scene unexpectedly.

## Fix

### Rule

Only onboarding `pick` should be allowed without an existing character.

If a player already exists:

```ts
if (cb.a === 'pick') {
    return toast("You already have a character.");
}
```

For meta callbacks on an existing character:

- apply the same live-message validation;
- or route them through the ordinary loaded-player pipeline.

## Integration tests

### Stale picker

1. create two pickers;
2. pick class on newest;
3. tap class on older;
4. existing player must remain unchanged.

### Existing character

Direct/forged `m:pk:*` callback must never replace an existing save.

---

# P0-6 — Class creation still uses save-before-commit

## Current path

On class pick:

```text
set messageId to picker ID
save player
commit/edit picker
return
```

## Why this retains the original bug

If editing the picker fails with a resendable error:

- `commit()` sends a fresh message;
- updates `player.messageId`;
- but no final `store.set()` occurs.

The database still points at the old picker message.

Also:

- `commit()` clears notices after successful delivery;
- pre-commit persisted state still contains onboarding notices.

## Fix

Use:

```ts
await ctx.answerCallbackQuery();
await commit(ctx, player);
await store.set(userId, player);
```

Same invariant as the repaired ordinary callback path:

> persist the final message pointer after delivery.

## Test

Mock edit failure:

- picker edit throws `message can't be edited`;
- sendRichMessage returns ID N;
- persisted `messageId === N`.

Also assert onboarding notices are not persisted after delivery.

---

# P0-7 — Newer-message adoption is lost because the player is loaded twice

## Current flow

`handleCallback()`:

1. `store.get()`
2. `isLiveMessage(p, ctx)`

`isLiveMessage()` may adopt a newer message:

```ts
p.messageId = tapped;
```

Then:

3. `withPlayer()` calls `store.get()` again.

With PostgreSQL, the second read creates a new object from persisted JSON and loses the in-memory adoption from step 2.

## Why tests can miss this

`MemoryStore.get()` returns the same stored object reference.

So mutation can appear to survive accidentally in tests.

PostgreSQL returns deserialized data.

## Recommended architecture

Load exactly once.

For example:

```ts
const p = await store.get(id);

if (!isLiveMessage(p, ctx)) ...
await withLoadedPlayer(ctx, store, p, dispatch);
```

Or change `withPlayer()` to accept an already-loaded state.

## Test

Use a store implementation whose `get()` always returns a structured clone.

That reproduces production-style object isolation.

Test:

1. stored message ID = 100;
2. callback message ID = 101;
3. adoption allowed;
4. final persisted ID must be 101 unless commit replaces it with another fresh ID.

---

# P1-1 — Collect delivery is not revalidated at turn-in

## Current behavior

Once a collect quest transitions to `turnIn`, it stays ready.

`turnInQuest()` then:

1. marks quest done;
2. removes required items;
3. ignores `removeItem()` failure;
4. grants rewards.

## Exploit

Example:

- Quest requires 6 Ember Shards.
- Player reaches 6 → quest becomes `turnIn`.
- Player spends those shards at Forge.
- Player presses Turn In.
- `removeItem()` fails.
- Failure ignored.
- Quest completes anyway.

## Multi-quest version

Two active quests can both become ready from the same shared materials.

Turning in one can consume them.

The other remains `turnIn` and can still be completed without goods.

## Correct invariant

At turn-in:

> The player must currently possess every required delivered item.

## Recommended implementation

Before changing state:

```ts
for (const obj of q.objectives) {
    if (obj.kind !== 'collect') continue;

    const need = obj.count ?? 1;

    if (countOf(p, obj.target) < need) {
        qp.status = 'active';
        return {
            ok: false,
            lines: [`You no longer have enough ${itemName(obj.target)}.`],
        };
    }
}
```

Only after **all** checks pass:

- remove all required goods;
- mark done;
- grant rewards.

Ideally make the consumption atomic:

1. validate everything;
2. mutate everything.

## Tests

- ready quest → drop goods → turn-in refused;
- ready quest → forge goods → turn-in refused;
- two quests share resources → only one can consume them unless enough remain;
- no partial removal if later objective is missing.

---

# P1-2 — Item-gain quest refresh is still fragmented

The repair introduced `onItemGain()` and calls it in some places:

- shops;
- exploration treasure.

But item acquisition still exists in multiple places that call `addItem()` directly.

Examples include:

- dungeon floor treasure;
- dungeon first-clear item;
- quest rewards;
- enemy reward pipeline indirectly.

Some later action may call `syncAvailability()` and eventually refresh the quest, but the intended new invariant:

> acquiring the final required item immediately makes the quest ready

is not centralized.

## Better architecture

Avoid requiring every item source to remember a quest hook.

Add a helper:

```ts
export function grantItem(
    p: PlayerState,
    itemId: string,
    qty = 1,
): string[] {
    addItem(p, itemId, qty);
    return onItemGain(p);
}
```

or integrate the hook into a higher-level inventory operation.

Be careful not to create circular dependencies between `inventory.ts` and `quests.ts`.

A small reward service/module may be cleaner.

## Tests

For each acquisition mechanism:

- enemy drop;
- exploration treasure;
- dungeon floor cache;
- dungeon first-clear;
- quest reward;
- shop purchase;

assert a collect quest becomes ready immediately when the threshold is reached.

---

# P1-3 — Sunspire Key is still not a mechanical key

`m11_toll` awards:

```text
q_sunspire_key
```

Narrative:

> The Vault only opens for its own key.

But the Vault boss gate currently checks whether the boss quest `m12_chronolich` has begun.

Possessing the Sunspire Key is not required.

The player can drop the key before entering the boss chamber and proceed normally.

## Recommendation

Choose one:

### Option A — use the key directly

Boss gate supports required item:

```ts
bossGate: {
    quest: 'm12_chronolich',
    item: 'q_sunspire_key',
    consumeItem: true,
}
```

Consume only on first boss entry.

### Option B — make the key a collect/delivery part of `m12`

For example:

```ts
objectives: [
  { kind: 'collect', target: 'q_sunspire_key', count: 1 },
  { kind: 'kill', target: 'e_chronolich', count: 1 }
]
```

The first approach fits the narrative better.

---

# P1-4 — Equipping does not verify ownership

## Current behavior

Equip handler:

```text
check item is equippable
removeItem(...)
ignore return value
set equipment slot
```

A legal item ID can therefore become equipped even if it is no longer in inventory.

## Realistic triggers

Not only malicious/forged callbacks.

Telegram message ID staleness does not distinguish revisions of the same edited message.

Two rapid taps can race:

- first tap consumes/equips item;
- second tap acts on stale UI state;
- second call can still install the item despite no bag copy remaining.

## Fix

```ts
if (!removeItem(p, itemId, 1)) {
    return { toast: "You don't have that." };
}
```

Only then swap equipment.

## Test

Call equip action twice with one copy.

Second attempt must fail without changing inventory/equipment.

---

# P1-5 — Combat does not validate learned/class-owned skills

## Current validation

Skill action checks:

- skill definition exists;
- cooldown;
- MP.

It does not check:

```ts
p.skills.includes(sk.id)
sk.classId === p.classId
```

UI hides unlearned skills, but the engine explicitly claims to remain safe against stale/forged callbacks.

It currently is not.

## Consequence

A sufficiently crafted callback can request a real skill the player never learned.

If MP is sufficient, the engine executes it.

## Fix

Before cooldown/MP:

```ts
if (sk.classId !== p.classId || !p.skills.includes(sk.id)) {
    lines.push("You haven't learned that skill.");
    return { lines, consumedTurn: false };
}
```

## Tests

- Warrior submits Mage Cataclysm callback → refused;
- level-1 Mage submits Meteor → refused;
- learned skill remains usable.

---

# P1-6 — Equipment changes do not clamp current HP/MP

Some equipment increases max HP or max MP.

After removing/swapping that equipment, current pools are not reduced to the new maximum.

## Exploit

1. Equip +HP trinket.
2. Heal to new maximum.
3. Swap to offensive trinket.
4. Keep HP above current max.

Same for MP.

## Fix

After every equipment mutation:

```ts
const s = statsOf(p);
p.hp = Math.min(p.hp, s.maxHp);
p.mp = Math.min(p.mp, s.maxMp);
```

Apply to:

- equip;
- unequip;
- any future item destruction affecting equipped stats.

## Test

Equip HP/MP item → fill pool → unequip → current pool equals new maximum.

---

# P1-7 — Cleric does not start at full HP

## Root cause

Creation computes initial gear stats with shallow object spread:

```ts
{
  ...itemStats(startingWeapon),
  ...itemStats(startingArmor)
}
```

If both weapon and armor define the same stat, the later object overwrites the earlier stat rather than adding them.

Cleric starting weapon and armor both contribute HP.

Normal `statsOf()` later correctly sums them.

Therefore initial HP is calculated from a smaller total than the actual maximum after creation.

## Practical result

Cleric starts slightly injured.

## Better fix

Do not duplicate stat-aggregation logic in character creation.

Construct base player state, assign equipment, then derive pools using the same canonical function:

```ts
const p = { ... };

const s = statsOf(p);
p.hp = s.maxHp;
p.mp = s.maxMp;
```

Or extract a shared equipment-stat aggregator.

## Test

For **all four classes**:

```ts
p.hp === statsOf(p).maxHp
p.mp === statsOf(p).maxMp
```

Do not only test Warrior.

---

# P1-8 — Shop tier formula is one level early

Item tier equip levels:

```text
tier 1 → level 1
tier 2 → level 7
tier 3 → level 13
tier 4 → level 19
tier 5 → level 25
tier 6 → level 31
tier 7 → level 37
tier 8 → level 43
```

Current shop level tier approximately:

```ts
Math.floor(p.level / 6) + 1
```

This gives:

```text
level 6  → tier 2
level 12 → tier 3
level 18 → tier 4
...
```

one level before the item can be equipped.

## Correct formula

```ts
Math.floor((p.level - 1) / 6) + 1
```

clamped to 1..8.

## Additional design decision

The current zone lower-bound clamp may force a low-level visitor to see/buy gear they cannot equip.

Possible policies:

- stock based only on player level;
- zone determines maximum quality, player determines actual offered tier;
- show but disable gear above player level.

---

# P1-9 — `t_9`–`t_11` have the wrong acquisition timing

The prior audit found these trinkets had no meaningful acquisition route.

The fix exposes all remaining trinkets in tier-7+ shops.

That technically gives them a source.

But:

```text
t_9  Thorn Ring     level 5
t_10 Moon Pendant   level 13
t_11 Ember Locket   level 29
```

They first become purchasable near endgame.

By then they are generally obsolete.

## Root problem

Trinket progression is tied to array position, but the array is not sorted monotonically by level.

## Fix

Do not determine trinket shop availability from index.

Filter by actual item level:

```ts
TRINKET_ITEMS.filter(t => t.level <= shopLevelCap)
```

Potentially expose several level-appropriate trinkets across different zones.

## Test

For each trinket:

- verify first available shop band is reasonably close to `ItemDef.level`;
- no level-5 item should first appear around level 37+.

---

# P1-10 — Boss first-clear trinkets are obsolete on arrival

Examples:

```text
Vault          → t_2
Glacier Maw    → t_3
Pyre Caldera   → t_4
Sundered Throne→ t_5
Endless Seam   → t_6
```

Approximate trinket level requirements:

```text
t_2 → 7
t_3 → 11
t_4 → 15
t_5 → 20
t_6 → 26
```

But these bosses occur around:

```text
Chronolich → ~22
Jormunis   → ~30
Ignivar    → ~38
Aldric     → 45
Warden     → 45
```

Aldric's first-clear reward is therefore roughly a level-20 normal trinket.

The player can already buy substantially better level-32/40 trinkets.

## Recommendation

Remap first-clear rewards to:

- contemporaneous trinkets;
- or, preferably, unique boss/dungeon trinkets.

Example pattern:

```text
Rootbound → early unique
Sunken    → early-mid unique
Vault     → mid unique
Glacier   → 20s unique
Pyre      → 30s unique
Throne    → 40+ unique
Seam      → postgame unique
```

This would make boss clears feel materially rewarding.

---

# P1-11 — Postgame XP is still not a reward

The repair changed silent XP loss into an honest message:

> XP means nothing now.

That improves transparency.

It does **not** solve the game-design problem.

At level 45:

- `m24` awards large XP;
- `m25` awards huge XP;
- Abyss side quests award huge XP;
- Endless Seam awards huge XP;
- level-45 enemies award XP.

All of it is useless.

## Recommended choices

### Option A — replace postgame XP entirely

Use:

- gold;
- Void Fragments;
- rare consumables;
- unique gear;
- forge currency;
- cosmetics;
- achievement currency.

### Option B — post-level-cap progression

Add:

- mastery;
- prestige;
- Dawncaller Rank;
- stat points;
- account XP;
- postgame talent track.

### Option C

Raise level cap and redesign Abyss as continued leveling content.

Do not keep giant zero-value XP numbers merely because ordinary content uses XP.

---

# P1-12 — Safe-haven forage remains an infinite zero-risk faucet

## Repair behavior

Treasure availability is limited after several forage actions per safe-haven visit.

On re-entering the safe haven:

```ts
delete p.flags[`forage_${zoneId}`];
```

The allowance resets.

## Exploit

Travel is free.

Therefore:

```text
forage ×3
travel to Whisperwood
travel back to Emberdawn
forage counter resets
repeat
```

Still yields infinite zero-risk opportunities.

The exploit now takes slightly more taps but is unchanged economically.

## If finite forage is intended

Use a reset condition that costs meaningful progress:

- real-time daily reset;
- once per N battles;
- once per chapter milestone;
- once per real-world hour;
- account-level cooldown timestamp.

Example:

```ts
forageResetAt: unixMillis
```

or:

```ts
forageCharges
forageRechargeAt
```

If infinite forage is actually acceptable, remove the complexity and document it as an intentional safety faucet.

---

# P2-1 — The flagship progression test is not a true full campaign simulation

The new test is useful and should remain.

But it explicitly does:

```ts
p.level = 45;
```

and directly inserts collect-objective items:

```ts
addItem(...)
```

instead of obtaining them from actual content.

So the test proves:

- quest prerequisite graph;
- kill-target availability;
- zone unlock sequence;
- boss gating/routing;
- general quest-state traversal.

It does **not** prove:

- level/XP pacing;
- actual collection source correctness;
- combat feasibility;
- drop-rate reachability;
- equipment/economy pacing.

## Recommendation

Rename it to something more precise:

```text
campaign quest graph m1→m25 is traversable
```

Then add targeted tests for other dimensions.

---

# P2-2 — Add collect-item source integrity testing

There is now a kill-capacity test.

A corresponding collect-source test is still missing.

For every collect objective:

```text
target item
required count
```

determine whether at least one legitimate source exists before/during that quest.

Possible sources:

- repeatable enemy drop;
- exploration treasure;
- shop;
- previous quest reward;
- dungeon floor reward;
- dungeon first-clear.

For probabilistic sources:

- source must be repeatable unless enough guaranteed finite attempts exist.

Example invariant:

```text
if item only has a 25% drop from one one-time enemy:
    invalid unless another guaranteed/repeatable source exists
```

This test should also be progression-aware:

> source zone/content must be unlocked by the time the quest is available.

---

# P2-3 — Free safe-haven healing still removes dungeon attrition

Current dungeon progress persists after each cleared floor.

Travel remains free.

Emberdawn fully restores HP/MP.

So optimal safe play remains:

```text
clear floor
travel Emberdawn
full heal
travel dungeon zone
continue
```

This is not necessarily a bug.

It is a design decision.

## If independent floor fights are intended

Leave it.

## If dungeons are meant to test endurance/resource management

Choose one:

- leaving resets current dungeon run;
- travel blocked while a dungeon run is active;
- healing only at explicit dungeon checkpoints;
- dungeon completion must happen in one run.

Do not accidentally balance bosses assuming players preserve attrition if full heal is always two taps away.

---

# P2-4 — Forge temper is bound to item model, not item instance

Current key:

```text
forge_i_<itemId>
```

This means:

```text
temper Iron Sword to +5
sell/lose Iron Sword
buy another Iron Sword
new Iron Sword is +5
```

That can be a valid system.

But it is not literally:

> this physical item was tempered.

It is effectively:

> your Iron Sword model/proficiency has been upgraded globally.

## Two choices

### Keep current implementation

Rewrite terminology toward:

- Forge Mastery;
- Blueprint Enhancement;
- Weapon Model Reinforcement.

### True item-instance tempering

Requires inventory instances instead of:

```ts
{ id, qty }
```

which is a larger model change.

No need to change unless individual-item ownership matters to the design.

---

# P2-5 — Documentation still contains stale details

## README dungeon count

README says:

> 8 zones, 8 dungeons

Current obvious dungeon count is seven:

1. Rootbound Hollow
2. Sunken Shrine
3. Vault of Hours
4. Glacier Maw
5. Pyre Caldera
6. Sundered Throne
7. Endless Seam

Emberdawn has no dungeon.

## Auto-revive wording

README refers to an auto-revive trinket, while Phoenix Cinder is implemented as a consumable.

## Audit completion language

Avoid claiming all findings are fully resolved while the current residual issues above remain.

---

# Additional test suite recommended

The next repair commit should add tests for the remaining holes.

## Save migrations

### Versioned migration

```text
legacy save migrates once
second load does nothing destructive
new save remains unchanged
```

### Legitimate duplicate gear

```text
equipped w_warrior_2
inventory w_warrior_2 ×2
migration does not delete legitimate copies after version is current
```

### Legacy active battle

No enemy weaken fields.

After migration:

```text
enemyWeakenedPct = 0
enemyWeakenTurns = 0
damage is finite
HP is finite
```

---

## `/start`

### Active battle

`/start`:

- fresh message;
- same battle;
- same gold;
- same deaths;
- same zone.

### Won battle awaiting Continue

Still preserved.

---

## Meta callback safety

### Existing character + stale picker

Old class-pick callback must not replace player.

### Existing character + forged pick

Must return an error/toast.

---

## Class pick resend

Force picker edit failure.

Assert final resent message ID is persisted.

---

## Newer message adoption

Use clone-on-read store.

Assert newer tapped message is retained as live.

---

## Quest delivery

### Spend-after-ready

Quest reaches `turnIn`.

Spend/drop required items.

Turn-in must fail and revert/remain active.

### Shared material contention

Two quests require the same material.

One turn-in consumes it.

Second cannot turn in unless sufficient quantity remains.

---

## Item gain hooks

For collect quests, final item from each mechanism should transition readiness:

- shop;
- overworld treasure;
- enemy drop;
- dungeon cache;
- dungeon first-clear;
- quest reward.

---

## Equip ownership

One item copy.

Equip twice.

Second action must fail.

---

## Skill ownership

- wrong class skill → refused;
- unlearned same-class skill → refused;
- learned skill → accepted.

---

## HP/MP clamping

Remove +HP/+MP equipment while above the new maximum.

Assert current pool is clamped.

---

## Starting pools

For every class:

```ts
assertEquals(p.hp, statsOf(p).maxHp);
assertEquals(p.mp, statsOf(p).maxMp);
```

---

## Shop boundaries

Assert:

```text
Lv6  → tier 1
Lv7  → tier 2
Lv12 → tier 2
Lv13 → tier 3
...
Lv43 → tier 8
```

---

## Trinket timing

Every trinket should have a shop/source near its intended level rather than only endgame fallback.

---

## Final quest provenance

Overworld Warden:

```text
m25 no progress
seam not cleared
```

Dungeon Warden:

```text
m25 progress
seam clear
```

---

# Recommended repair order

## Phase 1 — correctness / data safety

1. Make `m25` require the Endless Seam itself.
2. Make `/start` preserve all gameplay state.
3. Introduce versioned player/save migration.
4. Migrate new combat fields safely.
5. Fix stale meta/class-picker behavior.
6. Fix class-pick commit/save order.
7. Eliminate double-load message adoption issue.

## Phase 2 — engine authority/invariants

8. Revalidate collect goods atomically on turn-in.
9. Centralize item gain → quest refresh.
10. Validate equip ownership.
11. Validate skill ownership/class.
12. Clamp HP/MP after equipment change.
13. Fix starting-stat aggregation.

## Phase 3 — progression/economy polish

14. Fix shop tier boundary.
15. Make trinket availability level-based.
16. Rework boss first-clear trinket rewards.
17. Give postgame XP a meaningful replacement.
18. Decide whether forage is finite and implement a real reset rule.

## Phase 4 — tests/docs

19. Rename the synthetic quest-graph test precisely.
20. Add collect-source reachability analysis.
21. Add migration/recovery integration tests.
22. Correct README dungeon count and auto-revive wording.
23. Document whether dungeon healing/forge model semantics are intentional.

---

# Acceptance criteria for closing the original audit

I would consider the original audit satisfactorily resolved when all of the following are true.

## Campaign

- [ ] `m1→m25` quest graph is traversable.
- [ ] `m25` specifically requires the Endless Seam boss/dungeon clear.
- [ ] No overworld enemy can substitute for a location-specific story boss objective.
- [ ] Every kill objective has repeatable or sufficient finite capacity.
- [ ] Every collect objective has a progression-valid item source.
- [ ] Story keys described as keys have real mechanical relevance or are removed/reworded.

## Dungeons

- [x] Normal floors advance only on victory.
- [x] Flee does not advance floor.
- [x] Death does not advance floor.
- [x] Boss rematches work.
- [x] First-clear is awarded only once.
- [x] Dungeon treasure is granted.
- [x] Overworld boss-ID collision does not trigger dungeon clear.
- [ ] Final quest itself is also provenance-correct.

## Combat

- [x] Smoke Bomb works as described.
- [x] Venom Cut weakens enemy.
- [x] Invalid cooldown/MP use does not spend turn.
- [x] Phoenix Cinder is automatic-only.
- [x] Phoenix Cinder is once-per-battle.
- [x] SPD affects at least fleeing.
- [ ] Skill callbacks validate class/learned ownership.
- [ ] Legacy battle state migrates safely.

## Equipment / forge

- [x] New-character equipped gear not duplicated in bag.
- [ ] Legacy gear migration never deletes legitimate inventory.
- [ ] Equip requires actual ownership.
- [ ] HP/MP are clamped after gear changes.
- [ ] Every class starts at actual full pools.
- [x] Forge material no longer depends on current zone.
- [x] Temper scaling does not bleed into unrelated equipment.
- [ ] Temper model semantics documented as item-ID mastery or redesigned as item-instance upgrade.

## Economy / rewards

- [x] Tier-8 class gear has a source.
- [ ] Shop tier boundaries match actual equipment levels.
- [ ] Trinket acquisition timing matches trinket levels.
- [ ] Boss first-clear rewards are level-appropriate.
- [ ] Postgame rewards have real value at max level.
- [ ] Forage is either intentionally infinite or actually finite.

## Persistence / Telegram lifecycle

- [x] Ordinary callback resend persists new message ID.
- [x] `/reset` persists the fresh live message ID.
- [x] Renderer no longer consumes notices.
- [x] Resend whitelist is narrow.
- [ ] `/start` re-centers without gameplay mutation.
- [ ] Class pick saves after final commit.
- [ ] Meta callbacks respect stale/live semantics.
- [ ] A stale picker cannot overwrite an existing character.
- [ ] Newer-message adoption persists correctly with clone-on-read/database stores.
- [ ] Save migrations are versioned.

## Tests

- [x] Main quest graph traversal test exists.
- [x] Kill encounter capacity test exists.
- [ ] Collect acquisition-source test exists.
- [ ] Legacy-save migration tests exist.
- [ ] `/start` preservation test exists.
- [ ] Stale picker/meta safety test exists.
- [ ] Final dungeon objective provenance test exists.
- [ ] Equip ownership test exists.
- [ ] Skill ownership test exists.
- [ ] HP/MP equipment clamping test exists.
- [ ] All-class starting-pool test exists.
- [ ] Shop exact boundary tests exist.

---

# Final assessment

The first repair pass successfully addressed most of the most serious **core dungeon and combat implementation errors**.

The campaign is no longer blocked by the old Automaton/Crownsworn encounter-capacity failures.

The state-machine architecture is significantly healthier.

The largest remaining risks are now:

1. **final quest provenance**;
2. **existing-save migration safety**;
3. **Telegram message/onboarding lifecycle correctness**;
4. **quest delivery invariants**;
5. **engine-side authority checks for equipment/skills**;
6. **reward/economy progression quality**.

The next agent should therefore avoid another broad rewrite.

The correct next step is a focused second repair pass that:

- closes the remaining semantic holes;
- introduces explicit save-version migrations;
- strengthens engine validation;
- expands regression tests around lifecycle and item-source correctness.

After that, the project should be in a much better position for genuine balance/playtesting work.
