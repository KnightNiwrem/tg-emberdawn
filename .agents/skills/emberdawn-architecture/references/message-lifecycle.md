# Message lifecycle and callbacks

Authoritative code and tests: `src/handlers/session.ts`, `src/handlers/callbacks.ts`,
`src/handlers/commands.ts`, `src/codec.ts`, `src/bot.ts`, `tests/repair2_test.ts`,
`tests/save_identity_test.ts`, `tests/callback_ack_test.ts`.

For changes to reset cases or the lock/transaction around delivery, also read
[State coordination and reset](state-and-reset.md).

## One live message per player

- Each player has exactly one live game message (`player.messageId`). Normal gameplay view changes
  edit it through `commit()` in `src/handlers/session.ts`. Initial delivery and explicit `/start`
  re-centering send a fresh live message; `/start` deliberately clears the tracked pointer first,
  and older copies become stale.
- When editing a tracked message, `commit()` resends and updates `player.messageId` only when
  Telegram reports it is missing or no longer editable (the `RESENDABLE` list). Other edit failures
  — including rate limits and oversized messages — surface instead of resending. "Message is not
  modified" succeeds without advancing the rendered revision.
- Never send additional button-bearing messages during normal gameplay. The class picker and
  post-reset picker are stateless onboarding screens; confirmed reset delivers the picker before
  deleting the old save, as described in [Reset flow](state-and-reset.md#reset-flow). Explicit
  `/start` replaces the live game message.
- Back and travel actions select the appropriate scene. Successful `commit()` owns the `uiRev`
  advance; scene selection does not independently bump it.

## Staleness and revision guard

- Every committed render stamps its buttons with the rendered `uiRev` (cycled 1..9999, embedded in
  callback data as `<view>:<rev>:<action>[:<arg>]`). Every gameplay callback must carry that
  revision.
- `loadPlayer` classifies one store read and validates its version and persisted identities before
  any message adoption, mutation, or render. Commands and callbacks share this gate.
- The router uses `tapIsCurrent` in `src/handlers/session.ts` before gameplay mutation. It rejects
  revisionless taps before any adoption, and answers taps on older message copies with a stale
  toast. For the tracked message, a revision mismatch is stale, so replays and double-taps after a
  committed revision advance are no-ops. A newer-than-tracked message copy is deliberately adopted
  as authoritative, together with its stamped revision; this updates `messageId` and `uiRev` before
  gameplay proceeds.
- The only exception is the class picker (`m:pk:<class>`), which renders before a player exists and
  bypasses the staleness guard.
- Do not weaken this guard into "always process": stale taps corrupt pacing.

## callback_data budget

Telegram allows at most 64 bytes of `callback_data`. All callback strings are built and parsed only
through `src/codec.ts` (`encodeCb`/`decodeCb`). Add new controls there; never inline raw callback
strings in renderers or handlers.
