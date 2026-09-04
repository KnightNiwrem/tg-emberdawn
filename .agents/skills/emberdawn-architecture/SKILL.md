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

- Each player has exactly one live game message (`p.messageId`). Every view change edits that
  message in place through `commit()` in `src/handlers/session.ts`. If the edit fails, `commit()`
  resends the message and re-points `p.messageId` at the new copy.
- Never send extra button-bearing messages during normal play. The only exceptions are the class
  picker and the post-reset picker, which render before a player exists.
- Backing out of an interaction or traveling resets the scene and bumps `uiRev`.

## Staleness and revision guard

- Taps on older message copies are answered with a toast and ignored (`isLiveMessage` via
  `tapIsCurrent`). Newer-than-tracked message ids are adopted, together with the render revision
  that copy was stamped with.
- Every committed render stamps its buttons with the player's `uiRev` (cycled 1..9999, embedded in
  callback data as `<view>:<rev>:<action>`). The router in `src/handlers/callbacks.ts` rejects
  revision mismatches BEFORE any mutation, so replays and double-taps on the same live message are
  no-ops. Every gameplay callback must carry its stamped revision; rev-less callbacks are rejected
  as stale.
- The only exception is the class picker (`m:pk:<class>`), which renders before a player exists and
  bypasses the staleness guard.
- Do not weaken this guard into "always process": stale taps corrupt pacing.

## callback_data budget

Telegram allows at most 64 bytes of `callback_data`. All callback strings are built and parsed only
through `src/codec.ts` (`encodeCb`/`decodeCb`). Add new controls there; never inline raw callback
strings in renderers or handlers.

## Locking and cross-instance consistency

Every update runs inside `PlayerStore.withLock(user)`:

- The bot's per-user promise chain serializes updates within one process.
- `PgStore.withLock` holds a Postgres transaction-scoped advisory lock on a dedicated connection
  around the whole load → mutate → save flow, which runs entirely on that same connection. Two bot
  instances can never interleave a read-modify-write for one player (no lost writes); concurrent
  updates for distinct players can never starve the connection pool; a failed section rolls back
  atomically and the lock releases with the transaction, so there is no explicit unlock to leak.
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
2. **Too-old or unversioned pre-launch save:** the save cannot be loaded, so a confirmation scene
   cannot be staged or persisted. An explicit `/reset` deletes it immediately and presents the class
   picker — this is the documented escape hatch for disposable development saves.
3. **Newer-version save:** refused without mutation or deletion, with a reply telling the player
   their progress is safe.

Case 2 is regression-tested in `tests/repair2_test.ts`.

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
  mechanics the same way (`triggerDisclosure` in `render/menus.ts`). Never re-type numbers in
  authored prose, and never replace the generated summary with a second hand-written description.
- Canonical rules vocabulary: **Shield** (the absorbable pool), **DEF/RES**, **round** (duration and
  tick unit), **action** (one actor's opportunity to act), **beneficial/harmful effect** (cleanse
  and dispel categories).
- Validation is structural: tests assert the renderer discloses every field of an effect spec. They
  must not lexically scan names or flavor for words like "ward" or "stun".
- Battle narration (`spec.line`, `defaultInstanceLine`) is distinct from the static rules summary
  and may use in-world wording, but generic effect output (shield grants, capacity fades, dispels)
  still uses the canonical terms: the pool is always "Shield" (never "ward"), durations are rounds,
  and removals name beneficial or harmful effects.
- The balance harness parses some of those generic lines (the SHIELD_FADE and SHIELD_WASTE regexes
  in `src/engine/balance.ts`). Keep them in sync if the copy changes.
