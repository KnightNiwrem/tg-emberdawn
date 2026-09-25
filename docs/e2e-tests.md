# E2E player journeys

`tests/e2e/` runs the real bot handlers and webhook against an in-process Telegram Bot API emulator.
Each test creates a disposable memory store and virtual player, plays from `/start`, and checks chat
messages, button labels, and callback answers. Setup earns items and progression through gameplay;
tests do not seed or inspect player saves. These tests need loopback networking and no Telegram
credentials or database.

Run just these journeys:

```bash
env -u TEST_PG_URL deno test --allow-import --allow-env --allow-net --allow-read tests/e2e/
```

They also run in `deno task test`. See [verification.md](verification.md) for the full required
gates.

## Coverage

| File                   | Player journey                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboarding_test.ts`   | Each class plays basic action → skill → guard → potion → victory, reaches level 2, and opens Character and Inventory.                                                                             |
| `menus_test.ts`        | Shop details and Sources → buy → sell → bag; equipped details → unequip → equip; gather → Uses → craft; earn materials → temper → inspect; second bag page → nested details → drop the last item. |
| `battle_test.ts`       | Ordinary combat menus without spending a round; guard, skill, potion, victory and haven rest; failed flee and Smoke Bomb; defeat and revival; exhausted MP and ether recovery.                    |
| `quest_test.ts`        | Read Sparks of Trouble → defer then accept with Maren → defeat four rats → read the ready journal → return and report → receive the letter.                                                       |
| `dungeon_test.ts`      | Read and cancel entry → enter → win floor one → use carried supplies → leave → re-enter at floor one → flee with earned loot.                                                                     |
| `commands_test.ts`     | Command and menu Help; cancel reset mid-fight and finish it; delete through Character and choose a new class.                                                                                     |
| `live_message_test.ts` | Resume with `/start`, reject an old copy, and keep playing; a rapid double tap resolves one round.                                                                                                |

The former shallow picker, level-up, and menu-tour tests are folded into these journeys. The
injected webhook-secret, rate-limit, and acknowledgment-failure E2Es and their unused harness
controls were removed to focus this suite on player behavior. Boundary behavior remains covered in
`tests/webhook_test.ts`, `tests/callback_ack_test.ts`, and the other handler tests.

These are short, representative journeys through the opening regions. The dungeon journey covers an
early expedition and retreat; it does not claim a full boss clear or campaign completion.

## Repeatable gameplay and readable failures

`withPlayer` pins `Math.random` to 0.5 during each test body and restores it in `finally`.
`withRoll` scopes a different roll to an awaited action, selecting authored encounters, drops, or
flee outcomes. The game already resolves its default RNG through `Math.random`. This makes failures
reproducible without modifying production code. Keep these test bodies serial within their Deno
realm; overlapping worlds would share that random override.

`tap` accepts a label substring or regular expression and requires exactly one match. Repeated
labels use adjacent visible text, for example:

```ts
await player.tap('Details', { beside: 'Minor Potion' });
await player.tap('Details', { beside: 'Padded Vest' });
await player.tap('Make one batch', { beside: 'Brew Minor Potion' });
```

The harness reports the current text and available labels when a match is missing or ambiguous.
Disabled controls remain in the projection so tests can inspect the unaffordable purchase, depleted
skill, and missing-ingredients states. Battle loops have action limits and require visible victory
before continuing.

## Emulator library feedback from these tests

These observations concern the pinned `tg-bot-api-emulator` revision
`61ee49cbe3b14c14b96cd885c035365040cd81dc` in `deno.json`. Both inconveniences were encountered
while writing the journeys above and are handled locally in `tests/e2e/harness.ts`.

### 1. Selecting a button by what the player sees requires application code

The TypeScript client's `pressCallbackButton` takes a message ID and `callback_data`. Shop shelves
and Equipment each display several identical **Details** buttons; crafting displays repeated **Make
one batch** buttons. A label alone cannot identify the intended row. Selecting the potion or armor
therefore required walking the rich blocks, associating a row with its preceding text, and finding
the callback data ourselves.

The local `beside` selector handles the game's layout and rejects ambiguous matches. This also
caught two concrete ambiguous shortcuts during the work: the Cleric's `/MP$/` selector matched both
Smite and Mend Wounds, and `Equip` matched both Equip and Equipment. The tests now name the intended
action explicitly.

A useful library addition would expose buttons by readable label and structural location, allow
scoping to a row or section, and fail with the matching candidates when a selector is ambiguous.
Keep the raw callback API available for the double-tap scenario.

### 2. Rich-message assertions require a local presentation adapter

`getMessages` returns structured messages. The shop, inventory, recipe, and battle tests need
readable text, labels, and whether a control is disabled. Sources and Uses contain nested lists;
battle recaps contain blockquotes and expandable history. The suite must maintain `plainText`,
`blockText`, and `messageButtons` to inspect those messages. In particular, the old callback-only
projection omitted controls that had become disabled, so it could not assert the purchase and
healing-skill states the new journeys exercise.

A library projection for readable rich text and buttons, retaining disabled state and structural
location, would remove this duplicated adapter work. Raw message access is sufficient to complete
all these flows today. Our `screenText` includes the content of expandable blocks regardless of
their initial collapsed state; it is a content assertion, not a simulation of a Telegram client's
layout.
