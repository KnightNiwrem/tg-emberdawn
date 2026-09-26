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

`tap` accepts a label substring, a regular expression, or the library's native `ButtonSelector`.
Native selector strings match the whole label; the short string form on `Player.tap` remains a
substring convenience. Ordinary taps use `account.pressButton`, and button/text assertions use the
library's `findButton`, `listButtons`, and `richMessageToPlainText`.

```ts
await player.tap({ label: /Details/, within: 'Minor Potion' });
await player.tap({ label: /Details/, within: 'Unequip armor' });
await player.tap(beside('Make one batch', 'Brew Minor Potion'));
```

`beside` is a small predicate for recipe headings that precede their button rows as sibling blocks.
The library supplies the block position and sibling list, and still owns finding exactly one match.
Explicit message snapshots use `findButton` plus the raw `pressCallbackButton` API to preserve the
captured callback revision for stale-tap checks. Battle loops have action limits and require visible
victory before continuing.

## Emulator library feedback: follow-up at b328685

The suite was upgraded from `61ee49cbe3b14c14b96cd885c035365040cd81dc` to
`b328685da710337c055baf2c9b336cb3f9ecee75`. All 20 existing journeys pass after adopting the new
client APIs. The harness is 72 lines shorter overall: the local rich-text traversal, button
projection, and ambiguity checking have been removed. This is a practical improvement to authoring
and maintaining these tests.

| Previous inconvenience                                             | Result with the new APIs                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local rich-text/block traversal for readable assertions            | Resolved for these flows by `richMessageToPlainText`, including Sources/Uses lists and collapsed battle history. Its output also includes button labels. |
| Custom button traversal and disabled-state projection              | Resolved by `listButtons` and `findButton`; tests inspect `'disabled' in selected.button` directly.                                                      |
| Custom label matching, ambiguity checking, and callback extraction | Ordinary taps now use `pressButton`. Native errors identify candidate labels, structural paths, and container text.                                      |
| Disambiguating repeated controls beside descriptive text           | Partly resolved: native `within` works for shop and equipment rows; recipe headings still need a predicate over preceding siblings.                      |

The shop probe also exercised the new client directly: `account.pressButton` bought a Minor Potion,
the projected text showed the increased bag count, and `findButton` found its disabled replacement
when the remaining gold was insufficient. An intentionally ambiguous `/Details/` selector reported
both candidates and their distinct block paths.

### Remaining inconvenience: matching preceding sibling text

This is the one remaining selector gap encountered while adapting the actual menu tests. `within`
searches containers enclosing a button. Emberdawn renders each recipe as a heading, ingredient and
output paragraphs, then a separate buttons block. That recipe title is a sibling, outside the
button's container.

For example, on the first crafting page, this native query finds no match despite the visible recipe
heading and its disabled control:

```ts
findButton(screen, {
  label: 'Ingredients or requirements missing',
  within: 'Make Fishing Rod',
});
```

Its error correctly lists the three disabled controls and their paths, but each container contains
only `Ingredients or requirements missing`; the recipe names are absent. The potion crafting journey
therefore uses the local `beside` predicate for both the enabled action and its disabled
replacement. It reads the siblings since the preceding buttons block through the library's public
container metadata. There is no need to extract callback data or implement a separate ambiguity
check.

Equipment has the same layout: `within: 'Padded Vest'` fails, but `within: 'Unequip armor'` succeeds
because that label shares the Details button's row. Shop selection with `within: 'Minor Potion'`
succeeds because the neighboring Buy button includes the item name. These behaviors were checked
against the rendered game screens.

A convenience selector for preceding sibling text, with that text included in failure diagnostics,
would remove the remaining recipe-specific adapter. The existing predicate API makes this a small
workaround rather than a blocker. `screenText` continues to assert content, including collapsed
blocks; it does not model the Telegram client's layout or expansion state.
