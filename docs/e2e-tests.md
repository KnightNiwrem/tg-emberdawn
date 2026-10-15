# E2E player journeys

`tests/e2e/` runs the real bot handlers and webhook against an in-process Telegram Bot API emulator
(`createInProcessEmulator` from the emulator's TypeScript client). The bot calls the Bot API through
the emulator's in-process `fetch`; the emulator delivers updates to the bot's webhook over loopback
HTTP. Each test creates a disposable memory store and virtual player, plays from `/start`, and
checks chat messages, button labels, and callback answers. Setup earns items and progression through
gameplay; tests do not seed or inspect player saves. These tests need loopback networking for the
webhook and no Telegram credentials or database.

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

## Emulator library feedback: follow-up at 47050df

The suite was upgraded from `b328685da710337c055baf2c9b336cb3f9ecee75` to
`47050df252207f207cb16fafc4ecef19ff985281`, 702 emulator commits later. All 20 journeys pass with no
change to what they play or assert. Only the harness and the double-tap test needed edits, plus an
optional `fetch` on `createBot` so the bot can use the in-process emulator.

The emulator is still imported from jsDelivr (`cdn.jsdelivr.net/gh`). The first fetches of a newly
pinned commit can fail while jsDelivr has not cached its files yet:

- some edge servers answer 503 `No healthy backends` (Fastly error 54113);
- some answer a false 404 for a file that exists at the commit.

Retrying succeeds, but Deno fails the whole module graph on one failed import. It also caches a 404
as "not found", so a plain retry repeats it. `deno task cache:deps` (`scripts/cache-deps.sh`)
retries `deno cache --frozen` and reloads the module the previous attempt reported missing. CI runs
it before `check` and `test`, which fetch the emulator from jsDelivr on every run. CI's
`~/.cache/deno` entry is keyed by `deno.lock` and saved by the first job to finish. `fmt:check`,
`lint` and the Postgres job never load the emulator, so the entry usually holds no emulator modules.
Run the task locally when a pin bump fails to resolve.

### Breaking changes

| Change                                                                                                                                                                                                          | Effect on this suite                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every control action resolves to `ActionOutcome<T>`, `{ result, receipt }`. An action without a result resolves to its `ActionReceipt` alone. Reads such as `getMessages` and `getCallbackQuery` are unchanged. | Seven type errors in `harness.ts`: `createSession`, `createBot`, `createAccount`, `sendMessage`, `pressButton` and `pressCallbackButton`. There is no compatibility shim or deprecation period, so every caller has to unwrap `result`. The fix is mechanical.                                              |
| Webhook confirmation moved earlier. `update_confirmed` is now recorded when the complete 2xx response arrives, before any method named in a webhook reply runs.                                                 | No effect here. grammY's `webhookCallback` does not use webhook replies by default, so the bot answers only after its handler finishes, and `handled()` still means the handler is done. A bot that answers with a webhook reply can no longer treat `update_confirmed` as "the reply method ran".          |
| Server modules moved. Control contracts and the HTTP grammar now live under `src/api/`, and the in-process emulator lives under `clients/typescript/in_process/`.                                               | The old harness deep-imported `src/api/mod.ts` and `src/composition/session_lifecycle.ts`. Those paths still resolve at this commit, but they are internal and can move again. The harness now uses only the supported `clients/typescript/in_process/mod.ts` and `clients/typescript/mod.ts` entry points. |

### Improvements adopted

- **Action receipts as wait positions.** `send`, `tap` and the double-tap test now wait `after` the
  action's receipt. Before, they read `activity.position()` before acting, which cost one extra
  control request per player action.
- **The supported in-process emulator.** `createInProcessEmulator()` replaced the local bootstrap.
  That bootstrap served the emulator on a loopback port and resolved its handler late, because the
  public origin had to name a port that is known only once the server listens. Disposal now ends the
  emulator's sessions. As a side effect, test output no longer shows Deno's `request.signal`
  legacy-abort warning (see below).

### Regressions

None observed. Every journey passes, and the suite takes about as long as it did at `b328685`.

### Remaining gaps

1. **Webhooks cannot be delivered in process.**
   ([#298](https://github.com/KnightNiwrem/tg-bot-api-emulator/issues/298)) The in-process emulator
   sends webhook requests with the network `fetch`. The session lifecycle already takes a
   `WebhookTransport` (`NETWORK_WEBHOOK_TRANSPORT` in `src/composition/session_lifecycle.ts`), but
   `InProcessEmulatorOptions` does not expose it. A webhook-mode bot therefore still needs a
   loopback listener and `--allow-net`. With a transport option, this suite could hand webhook
   requests directly to `webhookCallback` and run without network access.
2. **Contradictory confirmation docs.**
   ([#299](https://github.com/KnightNiwrem/tg-bot-api-emulator/issues/299)) The client's
   `UpdateConfirmedEntry` doc comment (`clients/typescript/types.ts`) says a webhook confirmation
   comes "after any method the answer names has run". The server contract
   (`src/api/contracts/bot_activity.ts`) and `docs/features/webhooks.md` say it comes before that
   method runs, which is how the emulator now behaves.
3. **Stale in-process guide.**
   ([#300](https://github.com/KnightNiwrem/tg-bot-api-emulator/issues/300))
   `docs/clients/typescript/in-process-emulator.md` still waits after `activity.position()` and
   compares `reply_parameters` as `JSON.stringify` text. The getting-started guide it mirrors uses
   the action receipt and `parameters_json`.
4. **Loosely typed delivered updates.**
   ([#301](https://github.com/KnightNiwrem/tg-bot-api-emulator/issues/301)) `update_delivered`
   entries still type `update` as a loose object with only `update_id`, so `E2eWorld.delivered`
   keeps its `as unknown as Update` cast to read `message` and `callback_query`.
5. **No selector for preceding sibling text.**
   ([#302](https://github.com/KnightNiwrem/tg-bot-api-emulator/issues/302)) Unchanged from `b328685`
   (see below); `beside` remains.
6. **Deno 2.9 legacy-abort warning from the standalone server.**
   ([#303](https://github.com/KnightNiwrem/tg-bot-api-emulator/issues/303)) The standalone server
   (`deno task
   start`) prints
   `Deno.serve: request.signal aborts on successful responses (legacy behavior)` on its first Bot
   API call. The emulator binds `context.req.raw.signal` into Bot API calls, bot activity waits and
   inline-query waits. This predates `b328685`, where the old loopback harness printed the same
   warning. It does not affect in-process use. It should be checked before Deno makes the non-legacy
   behavior the default.

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
