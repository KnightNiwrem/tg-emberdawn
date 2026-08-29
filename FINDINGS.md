# Emberdawn Game Design & Progression Audit

**Repository:** `KnightNiwrem/tg-emberdawn`\
**Reviewed snapshot:** `main` at commit `53ecf548382a69f39288f19dda070eb816f3fc4b`\
**Review focus:** game design, main/side quest progression correctness, zone/location unlocks, item
acquisition, dungeon progression, combat/item semantics, economy/forge behavior, persistence issues
that affect gameplay, and gaps in the current tests.

---

## Executive summary

The overall campaign structure is promising, but the current build is **not progression-correct**.

The most important result of this audit is:

> **A player following the intended story cannot currently complete the main quest line.**

There are at least two deterministic main-story hardlocks:

1. `m11_toll` requires **4 Brass Automaton kills**, but the player can encounter at most three
   Automatons during the one-way Vault of Hours traversal, and usually fewer.
2. `m21_loyalty` requires **10 Crownsworn kills**, but Crownsworn are absent from Umbral Spire
   exploration and only appear as possible enemies on two non-repeatable dungeon floors.

These are not balance problems or edge cases. They are direct contradictions between quest
requirements and the encounter graph.

The dungeon engine also has several foundational progression errors:

- dungeon floor state advances when a fight **starts**, not when it is won;
- fleeing or dying can therefore skip floors;
- boss defeat/death states can permanently strand dungeon progression;
- boss rematches are advertised but not actually possible;
- dungeon bosses can be entered before the story says they should be accessible;
- killing a boss before its quest is active may permanently softlock that quest;
- the Abyss Warden can be encountered in normal exploration, and the victory handler can incorrectly
  treat that overworld fight as an Endless Seam dungeon clear.

There are also important secondary correctness problems in combat, items, forge behavior, equipment
ownership, postgame rewards, and single-message persistence.

The main recommendation is:

> **Do not spend significant effort balancing XP, enemy stats, or difficulty until the dungeon/quest
> state graph is repaired and an end-to-end campaign reachability test exists.**

---

# Priority map

## P0 — campaign blockers / state corruption / severe progression errors

| Finding                                                 | Effect                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `m11_toll` impossible                                   | Main story hardlocks in Chapter 3                      |
| `m21_loyalty` impossible                                | Main story hardlocks in Chapter 6                      |
| Dungeon floor advances on battle start                  | Flee/death skips content and can strand bosses         |
| Boss rematch state contradicts implementation           | Bosses cannot actually be re-fought                    |
| Dungeon access not story-gated                          | Boss can be defeated before its quest is active        |
| Premature boss kill + no rematch                        | Main quest can become permanently impossible           |
| Abyss overworld Warden counts as dungeon boss           | Final dungeon/quest can be bypassed                    |
| `messageId` changed after persistence                   | Duplicate live-message behavior / staleness corruption |
| `/reset` persists before the new live message ID exists | Repeated duplicate game-message behavior after reset   |

## P1 — major mechanics behaving incorrectly

- Dungeon floor treasure is authored but never awarded.
- Smoke Bomb does not escape.
- Rogue Venom Cut weakens the player rather than the enemy.
- Phoenix Cinder can be manually consumed for no useful effect.
- Multiple Phoenix Cinders can auto-revive multiple times in the same battle despite the intended
  once-per-battle rule.
- Invalid skill use due to cooldown/MP can still spend the player's entire turn.
- SPD buffs have little/no practical effect on combat identity.
- Forge material cost can be downgraded by travelling to an early zone.
- Forge tempering is stored per slot rather than tied to the item.
- Forge percentage bonuses are applied to aggregate slot-related stats, including trinket stats.
- Starting equipment exists both in inventory and equipped state.
- Shop gear tier progression lags character level progression.
- Tier-8 class gear appears to lack a normal shop path.
- Some later trinkets appear orphaned from the normal acquisition path.
- Postgame XP rewards have no gameplay effect because the postgame begins at `MAX_LEVEL`.
- Collect quests do not immediately become turn-in-ready when the player already owns the required
  items.
- Collect quests do not consume delivered items, despite much of the writing implying
  hand-in/delivery semantics.
- `/start` claims to re-center the game but normally edits the existing buried message instead.
- Rendering mutates `PlayerState` by clearing notices.
- The save/render/commit order contradicts the documented architecture and causes persistence
  inconsistencies.

## P2 — design consistency / UX / documentation

- Safe-haven forage is an infinite zero-risk gold/potion faucet.
- Free travel to Emberdawn creates a full-heal-between-every-dungeon-floor loop.
- Some chapter unlock story beats occur after the zone is already unlocked.
- README/AGENTS/content comments contain stale counts or behavior descriptions.
- Current integrity tests prove referential validity, not progression reachability.

---

# Detailed findings

## P0-1 — `m11_toll` is impossible to complete

### Relevant content

Quest:

- `src/content/quests.ts`
- `m11_toll`
- objective: kill `e_automaton` ×4

The Brass Automaton does not appear in the Sunspire overworld exploration table.

It appears only in `d_vault` normal dungeon floors:

- floor 1: `['e_chronowisp', 'e_automaton']`
- floor 2: `['e_automaton', 'e_chronowisp', 'e_sentinel']`
- floor 3: `['e_automaton', 'e_chronowisp']`

Each floor starts exactly one enemy battle.

### Consequence

Even with perfect RNG, one traversal contains at most:

- floor 1: 1 Automaton
- floor 2: 1 Automaton
- floor 3: 1 Automaton

Maximum = **3**, while the quest requires **4**.

Because normal dungeon floors are currently one-way and non-repeatable, the player cannot
legitimately obtain the fourth kill.

### Practical outcome

The intended story flow:

`m10_cult` → `m11_toll` → `m12_chronolich`

stops permanently at `m11_toll`.

### Recommended fix

Do not merely reduce the count to 3 unless that is the intended encounter design.

Better options:

1. Add `e_automaton` to normal Sunspire exploration.
2. Make cleared dungeon normal floors replayable.
3. Introduce a repeatable dungeon encounter mode before the boss.
4. Redesign `m11_toll` around acquiring the key rather than an exact number of kills.

The quest text says the automatons carry the key, so a more coherent quest may be:

- defeat Automatons until the Sunspire Key is acquired; or
- clear a specific Vault gate encounter.

---

## P0-2 — `m21_loyalty` is impossible to complete

### Relevant content

Quest:

- `src/content/quests.ts`
- `m21_loyalty`
- objective: kill `e_crownsworn` ×10

The Umbral Spire overworld exploration table contains:

- `e_shade`
- `e_watcher`
- `e_shattered`
- `e_horror`
- `e_nightgaunt`
- elite `e_regalia`

It does **not** contain `e_crownsworn`.

Crownsworn appear only in `d_throne`:

- floor 1: possible `e_crownsworn`
- floor 3: possible `e_crownsworn`

### Consequence

A single traversal provides at most **2** Crownsworn kills.

Usually it provides 0 or 1 due to random selection.

The quest requires **10**.

### Practical outcome

The intended story:

`m20_seam` → `m21_loyalty` → `m22_umbral_key` → `m23_aldric`

cannot proceed normally beyond `m21_loyalty`.

### Recommended fix

`e_crownsworn` should probably be an Umbral Spire field enemy if the narrative asks the player to
thin their ranks by ten.

That also makes `m22_umbral_key` make more thematic sense because Crownsworn have a 25%
`q_umbra_key` drop.

However, see the later finding about `m22`: after killing ten Crownsworn, the player is
overwhelmingly likely to already possess the key before `m22` even begins.

---

# Dungeon-system findings

## P0-3 — Dungeon floor progression advances when combat starts

### Relevant code

`src/engine/world.ts`

`diveDungeon()` determines the current floor, creates a battle, and then immediately executes the
equivalent of:

```ts
p.flags[floorKey(d)] = floor + 1;
```

This happens before victory.

### Consequences

The dungeon state machine currently means:

> enter fight = floor completed

rather than:

> win fight = floor completed

This causes several failure modes.

### Flee from normal floor

A successful flee clears the battle and returns the player to the zone.

The dungeon floor counter has already advanced.

Result: the player skips that floor.

### Die on normal floor

The player eventually revives at a safe haven.

The dungeon floor counter remains advanced.

Result: death also skips the failed floor.

### Die on boss

The boss floor has already incremented beyond the boss.

After revival, the dungeon can report itself beyond the valid progression range.

This can strand the boss permanently.

### Recommended model

A dungeon battle needs enough context to know:

- dungeon ID;
- floor index;
- whether it is a boss encounter;
- whether progression should be advanced on victory.

Starting the fight should not mark any floor complete.

Normal-floor victory should:

1. grant any floor treasure;
2. advance the next-floor pointer.

Flee/death should:

- leave the same floor pending.

Boss victory should:

- mark dungeon clear;
- apply first-clear reward;
- expose an explicit boss rechallenge route if desired.

---

## P0-4 — Boss rematches are advertised but impossible

### Relevant code

`src/engine/world.ts`

After boss victory:

```ts
p.flags[floorKey(d)] = d.floors.length + 2;
```

`dungeonProgressLine()` returns:

> Boss defeated — re-challenge available

But `diveDungeon()` rejects:

```ts
if (floor > bossFloor) {
  return {
    ok: false,
    lines: ["You've already bested this place. Its boss may be re-fought from the dungeon screen."],
  };
}
```

There is no separate dungeon screen or boss-rechallenge action.

### Consequence

The UI and state machine promise a feature that is not actually reachable.

More importantly, the inability to re-fight bosses combines with premature boss access to create
main-quest softlocks.

### Recommended fix

Implement a distinct cleared-dungeon state:

- `uncleared`
- `progressing`
- `cleared`

Once cleared, the zone view can expose:

- `Rechallenge Boss`

which starts a battle tagged as a dungeon boss rematch but does not re-grant first-clear rewards.

---

## P0-5 — Dungeon bosses are not gated by story progression

### Relevant files

- `src/render/views.ts`
- `src/handlers/hub.ts`
- `src/engine/world.ts`

The zone view shows a Dive button whenever the zone has a dungeon.

The handler checks only that a dungeon exists.

There is no check for:

- active main quest;
- story flag;
- key item;
- prerequisite quest;
- boss-floor unlock.

### Narrative contradictions

Several quests explicitly claim that a prerequisite opens the dungeon/boss route:

- Sunspire Key opens Vault of Hours.
- Frost Emblems open the way to the Glacier Maw.
- Cinder Sigils calm/open the Caldera.
- Umbral Key opens the throne room.

Mechanically, these items/quests currently do not gate access.

### Consequence

A player can defeat a dungeon boss before the corresponding main quest is active.

Quest kill progression only applies to quests that are currently `active`.

Therefore:

1. player defeats boss early;
2. boss kill is not credited to later quest;
3. dungeon becomes cleared;
4. boss rematch does not actually work;
5. later main quest requiring that boss kill cannot be completed.

This is a true story softlock.

### Recommended design

Do not necessarily gate the whole dungeon.

Several quests intentionally ask the player to fight normal dungeon inhabitants before reaching the
boss.

Better design:

- normal dungeon floors can be explored once the zone is unlocked;
- the boss floor is gated by the relevant story condition.

Examples:

- Vault boss floor requires `q_sunspire_key` or completion of `m11_toll`.
- Glacier boss floor requires `m14_emblem` completion.
- Pyre boss floor requires `m18_sigil` completion.
- Throne boss floor requires `m22_umbral_key` completion.

---

## P0-6 — Abyss overworld Warden can incorrectly clear the dungeon

### Relevant content

`src/content/zones.ts`

The Abyss exploration table includes:

```ts
{ kind: 'elite', enemy: 'e_warden', ... }
```

The Endless Seam dungeon boss is also:

```ts
boss: 'e_warden';
```

### Relevant handler

`src/handlers/battle.ts`

On victory, dungeon bookkeeping is triggered approximately by:

```ts
const z = zoneDef(p.currentZone);
const d = z ? dungeonOf(z) : undefined;

if (d && def.id === d.boss) {
  onDungeonVictory(p, d);
}
```

The battle does not prove that the encounter came from the dungeon.

### Consequence

A random Abyss Explore event can spawn the Warden.

Defeating it can:

- progress `m25_silence`;
- mark Endless Seam cleared;
- grant first-clear dungeon XP/gold/item;
- set `seamCleared`;

without entering the Endless Seam.

### Root cause

`BattleState.origin` stores only the zone string.

That is not enough encounter provenance.

### Recommended fix

Use structured battle origin, conceptually:

```ts
type BattleOrigin =
  | { kind: 'explore'; zoneId: string }
  | { kind: 'dungeon'; zoneId: string; dungeonId: string; floor: number; boss: boolean };
```

Only an origin tagged as the correct dungeon boss encounter should call dungeon victory bookkeeping.

---

## P1-1 — Dungeon floor treasure is dead content

### Relevant content type

`DungeonFloor` supports:

```ts
treasure?: { gold?: number; item?: string };
```

Every major dungeon authors treasure on some floors.

Examples include:

- Rootbound Hollow gold/cache potion
- Sunken Shrine gold/Ether
- Vault of Hours gold/Greater Potion
- Glacier Maw gold/Greater Ether
- Pyre Caldera gold/Phoenix Cinder
- Sundered Throne gold/Elixir
- Endless Seam gold/Elixir

### Relevant engine

`diveDungeon()` reads only `floor.enemies`.

Normal-floor victory handling has no logic to grant the authored `floor.treasure`.

### Consequence

A meaningful portion of dungeon reward design is unreachable.

### Recommended fix

Grant floor treasure on successful normal-floor victory, once per floor clear.

Do not grant it merely for entering the fight.

---

# Quest-state findings

## P1-2 — Collect objectives do not refresh on item acquisition

### Relevant code

Collect objective progress is live:

```ts
countOf(p, obj.target);
```

However, a quest becomes `turnIn` only when `refreshProgress()` runs.

`refreshProgress()` is called through event-based hooks such as:

- kill
- reach
- talk

It is not automatically called on:

- enemy drop;
- treasure item;
- shop purchase;
- quest reward;
- manual inventory addition.

### Consequence

A player can already own the required item quantity while the quest remains `active`.

The quest log can effectively show full collection progress while not transitioning to turn-in.

### Recommended fix

Centralize inventory-changing operations so item acquisition triggers quest refresh.

Alternative:

- make readiness for collect quests derived rather than persisted;
- or run `refreshProgress()` whenever the quest view/turn-in eligibility is evaluated.

---

## P1-3 — `m22_umbral_key` is likely redundant after fixing `m21`

Crownsworn drop:

```ts
q_umbra_key: 0.25;
```

If `m21` is repaired so that the player actually kills ten Crownsworn, the probability of having
received at least one Umbral Key is:

```text
1 - 0.75^10 ≈ 94.37%
```

Therefore, by the time `m22_umbral_key` becomes available, the player will almost always already
possess its objective item.

This is not necessarily invalid, but it makes `m22` feel like a bookkeeping quest rather than a
progression beat.

### Options

1. Make `m21` itself award the Umbral Key.
2. Make `m22` require a distinct elite encounter.
3. Make the key a guaranteed drop from a named Crownsworn captain after `m21`.
4. Keep the current drop model but accept that `m22` is primarily narrative handoff.

---

## P1-4 — Collect quests do not consume delivered items

Collection quests inspect current inventory but `turnInQuest()` does not remove objective items.

Examples whose text implies physical delivery include:

- Ember Shards for Bram/Lyra
- Iron Chunks for Bram
- toxin samples
- Frost Emblems
- Cinder Sigils
- keys

### Consequence

The same items can:

- satisfy a quest;
- remain in inventory;
- satisfy another quest;
- be used for forge costs;
- sometimes be dropped later.

### Design decision needed

Choose one explicit model.

### Model A — acquisition milestone

The objective means:

> Acquire/possess N at some point.

Items remain after completion.

If this is intended, rewrite quest text so it does not imply hand-in.

### Model B — delivery quest

The objective means:

> Bring N to the giver.

On turn-in:

- verify current count;
- remove N items;
- then grant rewards.

This better matches most current writing.

---

## P2-1 — Sunspire unlock arrives before the narrative introduction

`m7_tyrant` currently unlocks `sunspire`.

`m8_passage` then has the Ferryman tell the player to go to Sunspire.

`m9_spire` is the actual reach-Sunspire quest.

### Consequence

The player can travel to Sunspire after `m7`, before the story beat in `m8` introduces the
destination.

They can also access its exploration/dungeon systems before that narrative handoff.

### Recommendation

Move the `unlockZone: 'sunspire'` reward from `m7_tyrant` to `m8_passage`.

---

# Combat and item findings

## P1-5 — Smoke Bomb does not perform its advertised function

### Item data

`c_smoke_bomb`

Description:

> Guaranteed escape from normal fights.

Actual effect:

```ts
effect: {
  cureStatus: true;
}
```

### Engine behavior

Generic consumable logic:

- clears player weaken debuffs;
- consumes item;
- enemy then gets its normal response unless the battle phase was explicitly changed to `fled`.

There is no Smoke Bomb-specific escape code.

### Consequence

Smoke Bomb behaves roughly like another Cleansing Tonic and can expose the player to another enemy
attack.

### Recommended fix

Represent escape explicitly in item effect data, e.g.:

```ts
effect: {
  flee: true;
}
```

Then combat use should:

- reject bosses if the item is meant for normal fights only;
- set phase to `fled`;
- consume the item;
- return without an enemy retaliation.

---

## P1-6 — Rogue Venom Cut weakens the Rogue instead of the enemy

### Skill

`sk_venom_cut`

Description:

> 130% ATK and weaken the enemy by 25% for 3 turns.

### Actual state

`CombatBuffs.weakenedPct` is documented as:

> Player-side weaken (from enemy debuffs)

`playerEffectiveAtk()` and `playerEffectiveMag()` multiply the player's offense by:

```ts
1 - buffs.weakenedPct;
```

The `debuff` skill path then writes:

```ts
buffs.weakenedPct = sk.potency;
buffs.weakenTurns = ...
```

### Consequence

Venom Cut:

1. damages the enemy;
2. prints that the enemy is weakened;
3. actually reduces the player's subsequent ATK/MAG.

### Recommended fix

Enemy offensive debuffs need separate state, e.g.:

```ts
enemyAtkPct;
enemyMagPct;
enemyWeakenTurns;
```

Enemy action calculations should apply those modifiers to `def.atk` / `def.mag`.

Do not reuse the player debuff fields.

---

## P1-7 — Invalid skill use can still cost a turn

When a skill is:

- on cooldown; or
- unaffordable due to MP,

the skill remains clickable.

The engine emits:

- `That skill is still on cooldown`
- `Not enough MP`

but then proceeds to the enemy phase.

### Consequence

A player can lose a full combat turn because they tapped a control the UI could already know was
invalid.

### Recommendation

UI:

- disable skill buttons when cooldown > 0;
- disable when current MP < cost.

Engine:

- return an explicit `actionConsumed: false`/validation failure;
- do not run enemy phase for invalid actions.

The engine should remain safe even if a forged/stale callback bypasses the UI.

---

## P1-8 — SPD buffs do not meaningfully deliver the advertised combat identity

Rogue class text emphasizes:

- speed;
- striking first;
- dodging;
- fleeing.

Skills include:

- Smoke Step: +45% SPD
- Time Warp: +40% MAG/SPD

But combat currently:

- always gives the player the action first;
- has no dodge mechanic;
- uses raw `statsOf(p).spd` for flee chance;
- does not appear to include the active battle `spdPct` buff in flee calculation.

### Consequence

A substantial part of Rogue identity and some Mage buff power is mechanically dead.

### Possible design directions

#### Option A — minimal

Use effective battle SPD in flee probability and any future initiative/dodge calculations.

#### Option B — initiative

At battle start / each round, compare effective SPD to determine action order.

#### Option C — dodge

Use SPD difference to create a capped dodge chance.

Any of these would make SPD more than a mostly decorative stat.

---

## P1-9 — Phoenix Cinder can be manually wasted

`c_phoenix_feather` has:

```ts
effect: {
  revivePct: 50;
}
```

Generic battle item rendering lists every consumable.

Generic battle item consumption does not implement `revivePct`.

### Consequence

The player can tap Phoenix Cinder during battle.

The item is consumed.

No useful revival effect occurs.

### Recommended fix

Do not render auto-trigger-only consumables as manually usable battle items.

Or explicitly define valid manual behavior.

---

## P1-10 — Phoenix Cinder can auto-revive repeatedly in one battle

The design documentation says the Phoenix Cinder auto-revives once per battle.

The engine merely checks whether another Cinder remains in inventory whenever HP reaches zero.

There is no per-battle `phoenixUsed` state.

### Consequence

A stack of Cinders can produce multiple revivals in the same boss battle.

### Recommended fix

Add battle state such as:

```ts
phoenixUsed: boolean;
```

On first lethal hit:

- if false and item exists → consume one and revive;
- set true.

Subsequent lethal hits in that battle cause defeat normally.

---

# Equipment and economy findings

## P1-11 — Starting equipment is duplicated between inventory and equipment state

### Character creation

The starting weapon and armor are:

1. inserted into `inventory`;
2. also assigned to `equipment.weapon` and `equipment.armor`.

### Later equip model

Equipping a new item:

1. removes the new item from inventory;
2. adds the previously equipped item to inventory;
3. changes the equipment slot.

That later logic assumes equipped items are **not** also in inventory.

### Consequence

The initial state violates the invariant used by all subsequent swaps.

On the first swap, the old starter item can gain an additional bag copy.

The player can also sell/drop the bag representation of an item while its equipped representation
continues to grant stats.

### Recommended invariant

> An item instance is either in the bag or equipped, never both.

Creation should:

- put starting gear directly into equipment;
- not add it to inventory.

---

## P1-12 — Forge material tier is based on current location, enabling cheap late-game tempering

### Relevant engine

`forgeMaterial(p)` derives the material from:

```ts
zoneTier(p.currentZone);
```

Forge is available from the zone UI everywhere.

### Exploit

An endgame player can:

1. equip endgame weapon/armor;
2. travel to Emberdawn;
3. use the Chapter-1 forge material mapping;
4. temper high-tier equipment using cheap Ember Shards.

### Consequence

The intended tier-material progression is bypassable.

### Recommended fix

Derive temper material from:

- the equipped item's `tier`; or
- the temper level + item tier;
- not the current zone.

---

## P1-13 — Temper progression is stored per slot, not per item

Temper levels are stored in flags like:

```ts
forge_weapon;
forge_armor;
```

### Consequence

Once the player has a +5 weapon slot:

- swapping to any other weapon automatically gives that new weapon +5.

This means tempering is really a permanent character-slot upgrade, despite the writing/UI presenting
it as tempering the equipped item.

### Decide the intended system

#### If temper belongs to items

Persist upgrades by item instance/item ID.

This requires a richer inventory/equipment representation.

#### If temper belongs to character slots

Keep the current storage but rename/rewrite the system:

- Weapon Mastery
- Weapon Forge Rank
- Armor Reinforcement

and design material cost accordingly.

The current implementation and presentation disagree.

---

## P1-14 — Forge percentage bonuses apply to aggregate gear stats

`statsOf()` aggregates weapon, armor, and trinket stats first.

Weapon temper then scales aggregate ATK/MAG.

Armor temper scales aggregate DEF/RES/HP.

### Consequence

A trinket that grants ATK can be improved by weapon temper.

A trinket that grants HP can be improved by armor temper.

At the same time, weapon stats such as SPD/HP are not necessarily tempered even when they belong to
the weapon.

### Recommended fix

Apply temper to each equipped item's own base stats before adding that item into the total equipment
stats.

---

## P1-15 — Shop gear tiers do not align with level progression

Class weapon/armor tier levels are generated approximately at:

- tier 1: level 1
- tier 2: level 7
- tier 3: level 13
- tier 4: level 19
- tier 5: level 25
- tier 6: level 31
- tier 7: level 37
- tier 8: level 43

Shop stock, however, derives tier from zone chapter:

- Chapter 1 → tier 1
- Chapter 2 → tier 2
- ...
- Abyss Chapter 7 → tier 7

### Consequence

The shop tier generally lags the level at which the next equipment tier becomes legal.

More importantly:

> There is no Chapter 8 zone, so normal shop generation never reaches tier 8.

Therefore the level-43 class weapon/armor sets appear to have no normal shop route.

### Recommended fix

Shop gear tier should probably derive from:

- zone recommended level;
- player level;
- explicit zone shop tier;

rather than directly equating chapter number with item tier.

---

## P1-16 — Some later trinkets appear disconnected from acquisition progression

The trinket table contains more entries than the normal chapter-indexed shop prefix naturally
exposes.

In particular, later appended entries such as:

- Thorn Ring
- Moon Pendant
- Ember Locket

deserve an acquisition-path audit.

The reviewed quest/boss rewards predominantly use `t_1` through `t_7`.

### Recommendation

Add a static content integrity test:

> Every non-unique equippable item must have at least one acquisition source:
>
> - shop;
> - enemy drop;
> - quest reward;
> - dungeon reward;
> - starting equipment.

Do not merely test that the item definition exists.

---

# Postgame reward finding

## P1-17 — Postgame XP rewards are mechanically worthless

`MAX_LEVEL = 45`.

`grantXp()` returns immediately when the player is already level 45.

The Abyss/postgame starts at level 45.

Yet postgame content awards very large XP values:

- `m24_below`
- `m25_silence`
- Abyss side quests
- level-45 enemies
- Endless Seam first clear

### Consequence

The UI announces large XP rewards that have no effect.

This makes a significant part of postgame reward value fake.

### Recommended options

1. Remove XP from postgame and replace it with:
   - gold;
   - materials;
   - cosmetics;
   - rare gear;
   - forge currency.
2. Add a post-45 progression system:
   - mastery;
   - prestige;
   - account rank;
   - postgame talent points.
3. Raise level cap if the Abyss is intended as continued leveling content.

---

# Persistence and Telegram-message findings

## P0-7 — `messageId` changes during `commit()` are not persisted on normal callbacks

### Intended architecture

The documentation says:

> handler → engine mutation → render → persist

and that if message edit fails, the bot resends and re-points the live message.

### Actual `withPlayer()` flow

It effectively does:

1. load
2. mutate
3. `store.set(...)`
4. render/commit
5. `commit()` may send a new message and change `p.messageId`

If a resend occurs, the new ID is assigned only after the saved snapshot already exists.

### Consequence

The store retains the stale message ID.

The next callback can cause additional staleness/resend behavior.

This undermines the "single live message" invariant.

### Recommended flow

Something conceptually like:

1. load
2. mutate
3. render
4. edit/send
5. update `messageId` if needed
6. persist the final post-commit state

If persistence before send is needed for crash safety, persist twice:

- state mutation checkpoint;
- final message-pointer checkpoint.

But the stored `messageId` must eventually match the actual live message.

---

## P0-8 — `/reset` strongly exposes the same pointer bug

`/reset` creates fresh state and stores it before calling `commit()`.

Fresh state has no live `messageId`.

`commit()` sends a new message and mutates only the in-memory state object.

The updated ID is not written back in the shown command path.

### Consequence

The persisted reset player can continue to have no `messageId`.

Subsequent button interactions are allowed because the staleness guard treats missing pointer as no
comparison.

Each mutation can then fall into another send path.

This can produce repeated game messages.

### Recommended fix

After any send that establishes a live game message:

```ts
player.messageId = sent.message_id;
await store.set(...)
```

must be guaranteed.

---

## P1-18 — Renderers are not actually pure because notices are consumed during rendering

`noticesBlocks(p)` does:

```ts
p.notices = [];
```

while constructing view output.

### Problems

1. Rendering mutates PlayerState despite the architecture saying renderers are pure.
2. Normal callbacks persist the state before rendering, so the cleared notices may not be persisted.
3. A transient notice can therefore reappear on a later interaction.

### Recommended fix

Rendering must not mutate.

Options:

- clear notices in the mutation/session layer before/after producing the render input;
- pass notices separately as transient response state;
- copy notices into a local variable and persist the cleared state intentionally.

---

## P1-19 — `/start` does not reliably "re-center" the game

README says:

> If the game message ever gets buried, `/start` re-centers it.

`handleStart()` calls `commit(existing)`.

`commit()` first attempts to edit the current tracked message.

If it remains editable, Telegram updates that old buried message rather than sending a new message
at the bottom of the conversation.

### Consequence

The user's buried message stays buried.

### Recommended fix

`/start` for an existing character should explicitly send a fresh game message, then set/persist the
new `messageId`.

That is different from the normal edit-in-place action path.

---

## P1-20 — Suspicious Telegram error recovery condition in `commit()`

The error handling includes a condition equivalent to:

```ts
d.includes('MESSAGE_TOO_LONG') === false;
```

inside the group of errors that should fall through to resend.

That expression is true for almost every error description except one containing `MESSAGE_TOO_LONG`.

### Consequence

Unexpected `GrammyError`s may be treated as resend-worthy rather than rethrown.

That can:

- hide real API failures;
- generate duplicate messages;
- complicate diagnosis.

### Recommendation

Make the resend error whitelist explicit.

Only resend for errors known to mean:

- message missing;
- message ID invalid;
- message no longer editable.

Do not use a broad negative condition.

---

# Game-design observations

## P2-2 — Safe-haven forage is an infinite zero-risk resource faucet

Emberdawn Village forage can repeatedly produce:

- gold;
- Minor Potions;
- rest/flavor.

There is no action-energy system, time cost, or cooldown.

### Consequence

A player can farm infinite gold/potions with no risk.

### Is this necessarily bad?

Not automatically.

For a Telegram game, a low-friction safety loop may be desirable.

But it should be an intentional economic choice.

If the game is meant to make resource acquisition meaningful over weeks of play, this faucet can
dominate early-game economy.

### Possible alternatives

- forage cooldown;
- diminishing returns;
- daily/periodic safe-haven gathering;
- mostly flavor/rest with rare treasure;
- trivial rewards that do not compete with combat income.

---

## P2-3 — Free safe-haven travel removes dungeon attrition

A player can potentially:

1. clear dungeon floor;
2. travel to Emberdawn;
3. fully restore HP/MP;
4. travel back;
5. continue next floor.

Dungeon floor progress is persistent.

### Consequence

Dungeons do not function as endurance sequences.

Consumables and MP conservation matter much less between floors.

### Design choice

If dungeons are supposed to be a set of independent fights, this is fine.

If they are supposed to test attrition, consider:

- locking travel while a dungeon run is active;
- resetting floor progress when leaving;
- adding dungeon checkpoint/heal rules instead.

---

# What is already structurally good

Despite the correctness problems, the broad progression scaffold is solid.

## Zone progression

The zone level ranges hand off reasonably:

- Emberdawn: early game
- Whisperwood: early Chapter 1
- Hollowmere: around level 9+
- Sunspire: around level 16+
- Frostpeak: around level 23+
- Cinder: around level 31+
- Umbra: around level 39+
- Abyss: level 45 postgame

## Story progression

The chapter arcs have clear mechanical climaxes:

1. Rootbound Hollow
2. Sunken Shrine
3. Vault of Hours
4. Glacier Maw
5. Pyre Caldera
6. Sundered Throne
7. Endless Seam postgame

The story is not fundamentally in need of replacement.

The largest problems are runtime state transitions and encounter availability.

## Architecture potential

Separating:

- `src/content`
- `src/engine`
- renderers
- Telegram handlers

is a strong basis for automated progression validation.

The codebase is small enough that the content graph can be exhaustively audited in tests.

---

# Why the current tests miss these failures

## Current "quest satisfiable" test is only referential integrity

The existing test checks approximately:

- kill target enemy exists;
- collect target item exists;
- reach target zone exists.

That proves:

> the referenced ID is defined

It does **not** prove:

> the player can obtain enough of that target at the point in progression when the quest is active.

Thus `m11_toll` passes because `e_automaton` exists, even though four kills are impossible.

`m21_loyalty` passes because `e_crownsworn` exists, even though ten kills are impossible.

---

## Current zone-reachability test is also only set membership

The test collects:

- starting zones;
- every zone mentioned by any quest unlock;
- every zone mentioned by a dungeon reward.

Then it asserts each zone is present in that union.

It does not prove the quest or dungeon granting the zone unlock is itself reachable.

A locked quest chain could still make the test green.

---

## Current dungeon test unintentionally validates the wrong behavior

The dungeon test repeatedly calls `diveDungeon()` without actually winning each normal-floor battle.

Because `diveDungeon()` itself increments the floor, the test sees progression.

This means the test effectively validates:

> entering a dungeon battle advances the dungeon

which is precisely the behavior that should be considered a bug.

---

# Recommended new tests

The following tests should be added before or alongside implementation fixes.

## 1. Dungeon progress advances only on victory

Test:

1. enter floor 1;
2. inspect next-floor state;
3. confirm it has **not** advanced;
4. simulate victory;
5. call dungeon-victory normal-floor hook;
6. confirm floor becomes 2.

---

## 2. Flee does not advance dungeon floor

Test:

1. enter normal floor;
2. force successful flee;
3. dive again;
4. confirm same floor is presented.

---

## 3. Death does not advance dungeon floor

Test:

1. enter normal floor;
2. kill player;
3. revive;
4. return;
5. confirm same floor is pending.

---

## 4. Boss death does not permanently skip boss

Test:

1. reach boss floor;
2. lose;
3. revive;
4. return;
5. confirm boss remains available.

---

## 5. Cleared boss can actually be re-challenged

Test:

1. defeat boss;
2. confirm first-clear applied once;
3. start rechallenge;
4. defeat again;
5. confirm no second first-clear reward.

---

## 6. Overworld boss-ID collision cannot trigger dungeon bookkeeping

Test specifically for Abyss:

1. spawn `e_warden` from exploration origin;
2. defeat it;
3. assert:
   - no `seamCleared`;
   - no Endless Seam first-clear reward.

Then:

1. spawn Warden as `d_seam` boss origin;
2. defeat;
3. assert first clear occurs.

---

## 7. Dungeon boss cannot be entered before story gate

For each story dungeon, attempt to reach boss floor without completing the relevant gate quest.

Assert blocked with the correct narrative reason.

---

## 8. Full main-story progression simulation

This is the most important test.

Build a deterministic progression harness that starts from:

```ts
createPlayer(...)
```

and proves the player can reach:

```text
m1 → m2 → ... → m25
```

using only content available at each stage.

It does not have to simulate thousands of real combat turns.

The harness can abstract combat victory while still respecting:

- unlocked zones;
- encounter source tables;
- quest availability;
- item drop/acquisition sources;
- dungeon floor rules;
- level requirements;
- story gates.

The critical property is:

> no quest objective requires an enemy/item/location that is unavailable or finitely available below
> its required count.

---

## 9. Static encounter-capacity test

For every kill quest target:

- determine whether the enemy is repeatably available via exploration;
- otherwise determine the maximum number of times it can occur in finite one-time content.

If:

```text
required kills > maximum finite encounters
```

fail the test.

This would have caught both `m11` and `m21`.

---

## 10. Item acquisition-path test

For every collect quest target, verify at least one acquisition path exists before/during that
quest:

- repeatable enemy drop;
- treasure;
- shop;
- prior quest reward;
- dungeon reward.

For probabilistic drops, ensure the source is repeatable unless the item is guaranteed before the
finite source is exhausted.

---

## 11. Every equippable item has a source

For each weapon/armor/trinket:

- starting gear OR
- shop OR
- quest reward OR
- dungeon reward OR
- enemy drop.

Fail if unreachable.

---

## 12. Invalid skill action does not consume turn

Attempt:

- skill on cooldown;
- skill without MP.

Assert:

- enemy turn counter unchanged;
- player HP unchanged from enemy action;
- battle round unchanged.

---

## 13. Venom Cut weakens enemy offense

Apply Venom Cut.

Measure enemy outgoing damage with deterministic RNG.

Assert enemy damage is lower, while player offense remains unchanged.

---

## 14. Smoke Bomb guarantees escape from non-boss

Use Smoke Bomb in normal combat.

Assert:

- phase = `fled`;
- item consumed;
- no enemy action.

Against boss:

- confirm either blocked or behaves according to intended design.

---

## 15. Phoenix Cinder once per battle

Give player two Cinders.

Force lethal damage twice.

Assert:

- first lethal hit revives and consumes one;
- second lethal hit causes defeat;
- second item remains in bag for future battle.

---

## 16. Render functions do not mutate PlayerState

Clone player.

Call every renderer.

Assert deep equality after render.

This immediately catches notice clearing in the render layer.

---

## 17. Resend persists new `messageId`

Use a fake API/store where edit fails with a known recoverable error and send returns a new ID.

After callback finishes:

```ts
(await store.get(userId)).messageId === newMessageId;
```

---

## 18. `/start` sends a new live message

Existing player with old editable game message:

- run `/start`;
- assert a new message is sent;
- assert new message ID persisted;
- assert old callback is rejected as stale.

---

# Recommended repair sequence

## Phase 1 — make campaign progression valid

Do these before balancing.

### 1. Redesign dungeon state

Required capabilities:

- encounter provenance;
- floor advance on victory only;
- same floor after flee/death;
- floor treasure on victory;
- real cleared state;
- explicit boss rechallenge;
- no first-clear duplication.

### 2. Add story boss gates

Prefer boss-floor gates rather than blocking all dungeon access.

### 3. Fix `m11_toll`

Make Automatons repeatably available or redesign objective.

### 4. Fix `m21_loyalty`

Put Crownsworn into repeatable Umbral content or redesign quest.

### 5. Separate overworld Warden from dungeon-clear bookkeeping

Battle origin should determine dungeon hooks.

### 6. Add full main-story progression test

Only after this test is green should later balancing be trusted.

---

## Phase 2 — repair quest/item semantics

- refresh collect quests when inventory changes;
- decide acquisition-vs-delivery semantics;
- move Sunspire unlock to correct quest;
- audit `m22` key redundancy;
- verify every quest item has a repeatable/guaranteed acquisition source.

---

## Phase 3 — repair combat correctness

- Smoke Bomb;
- Venom Cut/enemy debuffs;
- Phoenix Cinder manual-use visibility;
- one Cinder activation per battle;
- invalid skills should not consume turn;
- make SPD mechanically meaningful.

---

## Phase 4 — repair equipment/forge/economy

- remove duplicate starting equipped gear from inventory;
- decide whether temper belongs to item or equipment slot;
- material requirement based on item/progression rather than current zone;
- apply forge percentage to item stats before aggregation;
- align shop tier with item level progression;
- verify tier-8 gear acquisition;
- verify every trinket acquisition path.

---

## Phase 5 — repair message lifecycle/persistence

- render must be pure;
- persist final message ID after resend;
- fix `/reset` message pointer;
- make `/start` explicitly send a new recentered message;
- tighten recoverable Telegram error matching.

---

## Phase 6 — rebalance

Only after progression correctness:

- XP curve;
- quest XP;
- boss XP;
- gold economy;
- forge costs;
- safe-haven farming;
- travel/heal attrition;
- drop rates;
- class power.

---

# Suggested implementation architecture for dungeons

A useful direction is to stop using only a numeric `dgn_*_floor` flag as implicit encounter state.

For example, persisted dungeon progress could conceptually become:

```ts
interface DungeonProgress {
  nextFloor: number;
  cleared: boolean;
  treasuresClaimed: number[];
}
```

Battle origin could be:

```ts
type BattleOrigin =
  | {
    kind: 'explore';
    zoneId: string;
  }
  | {
    kind: 'dungeon';
    zoneId: string;
    dungeonId: string;
    floor: number;
    isBoss: boolean;
  };
```

Then victory resolution can do:

```text
if explore:
    normal battle rewards only

if dungeon normal floor:
    grant battle rewards
    grant floor treasure if first clear
    advance floor

if dungeon boss:
    grant battle rewards
    mark clear
    grant first-clear once
    progress dungeon/story objective
```

Flee/death simply does not call the dungeon-success transition.

This one design change solves several currently separate bugs.

---

# Suggested content-integrity model

The current content integrity layer should evolve from:

> Does this ID exist?

to:

> Can this content be reached and consumed in the progression graph?

Useful graph concepts:

## Repeatable sources

- zone exploration enemy;
- shop;
- repeatable boss;
- repeatable dungeon encounter if implemented.

## Finite sources

- one-time dungeon floor;
- first-clear reward;
- one-time quest reward.

## Gate edges

- quest prerequisite;
- level requirement;
- zone unlock;
- boss gate;
- required item/flag.

Then a test can reason about whether an objective has enough capacity before the next gate.

Example:

```text
m11 requires 4 × e_automaton

repeatable field sources = 0
finite possible dungeon occurrences = 3

3 < 4 → fail
```

That is the kind of automated invariant this game needs.

---

# Documentation inconsistencies to clean up after fixes

Do not prioritize these above gameplay correctness.

## Quest count comment

`src/content/quests.ts` header says the main storyline has 24 quests, while the IDs run through
`m25`.

## README counts

README says:

- 8 zones;
- 8 dungeons.

The reviewed zone content has eight zones but only seven obvious dungeon definitions:

1. Rootbound Hollow
2. Sunken Shrine
3. Vault of Hours
4. Glacier Maw
5. Pyre Caldera
6. Sundered Throne
7. Endless Seam

Emberdawn Village has no dungeon.

## AGENTS death description

The documentation includes language about revival behavior that should be checked against the most
recent safe-haven implementation.

## Pure rendering claim

AGENTS says rendering is pure, but notice rendering currently mutates player state.

## `/start` re-centering claim

README says `/start` re-centers the game; current normal behavior edits the old tracked message if
possible.

---

# Acceptance criteria before calling progression "correct"

The game should satisfy all of these:

- [ ] A fresh player can complete `m1` through `m25` without modifying state manually.
- [ ] Every main quest objective has a reachable source at the time the quest becomes active.
- [ ] Required kill counts never exceed finite encounter capacity.
- [ ] Required collect items have guaranteed or repeatable acquisition paths.
- [ ] Every non-starting zone unlock is gated by actually completable content.
- [ ] Dungeon normal floors advance only after victory.
- [ ] Fleeing does not skip dungeon floors.
- [ ] Dying does not skip dungeon floors.
- [ ] Boss defeat does not permanently strand the player.
- [ ] Cleared bosses can be re-fought if the UI says they can.
- [ ] Boss first-clear rewards happen exactly once.
- [ ] Overworld enemies sharing a boss ID cannot trigger dungeon-clear bookkeeping.
- [ ] Story keys/flags actually gate the encounters described by the narrative.
- [ ] Smoke Bomb escapes as described.
- [ ] Venom Cut weakens the enemy, not the Rogue.
- [ ] Phoenix Cinder cannot be manually wasted unintentionally.
- [ ] Phoenix Cinder triggers no more than once per battle.
- [ ] Invalid skill actions do not consume a combat turn.
- [ ] SPD buffs affect at least one meaningful mechanic.
- [ ] Equipped items are not duplicated in the inventory model.
- [ ] Forge material cost cannot be downgraded by changing zones.
- [ ] Forge bonuses apply to the intended item's stats.
- [ ] Every equippable item has an acquisition route.
- [ ] Postgame rewards provide real value at level cap.
- [ ] Renderers do not mutate persisted state.
- [ ] Resent game-message IDs are persisted.
- [ ] `/reset` creates and persists a valid new live message.
- [ ] `/start` genuinely re-centers to a fresh live message.
- [ ] Old game-message callbacks are rejected after re-centering.
- [ ] Tests validate progression reachability, not merely ID existence.

---

# Final assessment

The current build has a good campaign skeleton, coherent chapter identities, sensible broad zone
level ranges, and a code structure that is well suited to automated validation.

The primary problem is **not** that the game needs a wholesale redesign.

The primary problem is that several pieces of content were authored under assumptions the engine
does not currently enforce:

- quest targets were assumed repeatable when they are not;
- dungeon floors were assumed victory-gated when they are start-gated;
- key items were assumed to gate boss access when they do not;
- dungeon encounter identity was assumed to be distinguishable from overworld identity when it is
  not;
- boss rematches were assumed to exist when the state machine blocks them;
- collect objectives were assumed to respond immediately to inventory state;
- items and skills were described with mechanics that the generic combat model does not implement.

The best next step is therefore:

> **Build tests that encode the intended state transitions first, then repair the engine/content
> until those tests pass.**

In particular, start with:

1. `m11_toll` reachability;
2. `m21_loyalty` reachability;
3. dungeon flee/death/victory state;
4. boss rematch;
5. early boss story gate;
6. Abyss overworld Warden vs dungeon Warden;
7. full `m1 → m25` progression simulation.

Once those are correct, economy and combat balancing will become much more trustworthy.
