---
name: emberdawn-architecture
description: Use when changing or reviewing Emberdawn engine/I/O boundaries, message lifecycle, callback handling, locking, reset, or webhook behavior.
---

# Emberdawn architecture

Rules for the I/O boundary and cross-process flow. The root `AGENTS.md` invariants and the shared
boundaries below apply throughout. Source and test paths in this skill and its references are
relative to the repository root.

## Read for the task

Read the references for the contracts being changed or reviewed; combine routes when the task
crosses them. A review confined to the shared import or ordered-completion boundary can use the
sections below and `tests/architecture_test.ts` directly.

| When changing or reviewing...                                                | Read                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Live-message delivery, `/start`, callback encoding, revisions, or staleness  | [Message lifecycle and callbacks](references/message-lifecycle.md)    |
| Locking, load/mutate/save coordination, database rollback, or reset behavior | [State coordination and reset](references/state-and-reset.md)         |
| Webhook authentication, polling/webhook selection, or secret rotation        | [Webhook boundary](references/webhooks.md)                            |
| Generated effect summaries, mechanical vocabulary, or generic battle output  | [Flavor and mechanics disclosure](references/mechanics-disclosure.md) |

## Supported transport and deployment

The root AGENTS.md records the private-chat-only BotFather setting, forward-only releases, and
exclusion of custom-crafted callback payloads. Do not add group session ownership or binary rollback
support. Database transaction rollback remains required for failed updates.

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
