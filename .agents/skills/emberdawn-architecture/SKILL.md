---
name: emberdawn-architecture
description: Use when changing Emberdawn engine boundaries, handlers, the live-message lifecycle, callbacks, locking, the session or reset flow, webhook setup, or Telegram I/O.
---

# Emberdawn architecture

Detailed rules for the I/O boundary and the cross-process flow. The short cross-cutting rules that
apply to every change stay in the root `AGENTS.md`; this skill carries the implementation detail.

Authoritative code and tests: `src/handlers/session.ts`, `src/handlers/callbacks.ts`,
`src/codec.ts`, `src/bot.ts`, `src/webhook-server.ts`, `src/persistence/store.ts`, and
`tests/architecture_test.ts`.

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
  deleting the old save, as described below. Explicit `/start` replaces the live game message.
- Back and travel actions select the appropriate scene. Successful `commit()` owns the `uiRev`
  advance; scene selection does not independently bump it.

## Staleness and revision guard

- Every committed render stamps its buttons with the rendered `uiRev` (cycled 1..9999, embedded in
  callback data as `<view>:<rev>:<action>[:<arg>]`). Every gameplay callback must carry that
  revision.
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

## Locking and cross-instance consistency

Every user-associated update runs inside `PlayerStore.withLock(userId)`:

- The bot's per-user promise chain serializes updates within one process.
- `PgStore.withLock` holds a Postgres transaction-scoped advisory lock on a dedicated connection
  around the whole load → mutate → render → save flow. State queries reuse that same connection, so
  two bot instances cannot interleave a read-modify-write for one player. Reuse prevents the pool
  deadlock caused by lock holders requesting a second connection. Failed sections roll back database
  writes; Telegram sends and edits already delivered are outside that transaction. The lock releases
  with the transaction, so there is no explicit unlock to leak.
- `MemoryStore.withLock` is a passthrough for single-process tests.
- Never mutate player state outside the lock. Never hold the lock across user input.

## Ordered completion boundary

Telegram, network, and database code is asynchronous I/O around a deterministic game core. The
invariant is ordered completion, and it is regression-pinned by `tests/architecture_test.ts`
(synchronous API signatures, no pending work at return, observable ordering, and an import-graph
check). Three concepts stay separate:

1. **Ordered resolution (required).** One authoritative coordinator owns combat phases and nested
   sub-resolution; SPD determines the first actor; each action and effect fully resolves before the
   next begins; terminal state is checked immediately after every potentially lethal transition.
2. **Async syntax (neutral).** A Promise-returning function whose every step is awaited is still a
   single ordered flow. Never scan source for `async`/`await`/`Promise` tokens as an architecture
   test, and never hand-roll a TypeScript lexer to do it. Today's engine entry points are
   synchronous and stay that way; converting them is out of scope.
3. **Event-driven orchestration (unwanted for combat).** No listener-registration order, event bus,
   timer, microtask queue, or detached or background callback drives combat resolution; no unawaited
   state-mutating work; no `Promise.all` over mutations of the same fight. Traces stay caller-owned
   plain data returned by the active resolution, never asynchronously published events.

Async I/O belongs only at the boundary: receiving Telegram updates and grammY middleware,
serializing concurrent updates for the same user, Postgres and network I/O, sending and editing
Telegram messages, and webhook lifecycle and scripts. The boundary loads state, invokes the engine's
ordered resolution, renders and persists the completed result, and returns. It never interleaves
with resolution.

Terminology: "reactive trigger" (equipment) means an immediate nested synchronous call
(`runReactiveTriggers`); a "quest hook" (`onKill`/`onZoneEnter`/`onDungeonClear`) is an ordinary
directly invoked function; an "exploration event" is a data variant selected from content and
resolved by a switch; a "combat trace" is plain record entries appended by and returned from the
active synchronous resolution. None of these authorize an event bus.

## Import boundary

Gameplay modules (`src/engine`, `src/content`) depend only on local gameplay code — never grammy,
node:/npm:/jsr: packages, handlers, or persistence. This is enforced through the Deno compiler's own
dependency graph (`deno info --json`) in `tests/architecture_test.ts`, never by regex over source
text.

## Reset flow

`handleReset()` in `src/handlers/commands.ts` behaves differently depending on the save it finds:

1. **Supported current save:** `/reset` and the character menu's delete-hero control only stage an
   explicit Yes/No confirmation (the `reset` view). The confirmed `resetYes` deletes the save
   (`store.delete`) and delivers the stateless class picker in place (with a resend fallback).
   Delivery is attempted FIRST, so a failed delivery leaves the old save intact; nothing is
   persisted again until a class is picked through the normal no-player path (`pickClass`).
   No/cancel resumes the live scene — a pending fight stays a fight. A redelivered confirmation
   after deletion is a harmless no-op; once a new hero exists, the staleness guard rejects old reset
   callbacks. The delivery-before-delete guarantee applies only to this confirmed flow.
2. **Unsupported pre-launch save:** an old/unversioned save or a current-version save rejected by
   `assertResolvablePersistedIds()` cannot be loaded, so a confirmation scene cannot be staged or
   persisted. An explicit `/reset` deletes it immediately and presents the class picker — this is
   the documented escape hatch for disposable development saves.
3. **Newer-version save:** refused without mutation or deletion, with a reply telling the player
   their progress is safe.

Case 2 is regression-tested in `tests/repair2_test.ts` and `tests/save_identity_test.ts`.

## Webhook boundary

- Webhook mode fails closed without `WEBHOOK_SECRET`. The `X-Telegram-Bot-Api-Secret-Token` header
  is verified constant-time in `src/webhook-server.ts` BEFORE grammY parses the update. Polling mode
  needs no secret.
- Rotation procedure: choose a new secret, update the app environment, run
  `deno task webhook set <url>` with the same value, restart.
- `src/main.ts` selects webhook mode by default or polling mode with `BOT_POLLING=1`.

## Flavor versus mechanics (details)

- A skill or item's name and flavor (`SkillDef.flavor`, `ItemDef.desc`) are creative and may be
  nonliteral — never a rules source. The player-facing mechanical summary is generated from the
  structured effect specs by `src/engine/mechanics.ts`
  (`mechanicsText`/`mechanicsLines`/`consumableEffectLines`); equipment triggers disclose their
  mechanics the same way (`triggerDisclosure` in `render/menus.ts`). Never duplicate mechanical
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
