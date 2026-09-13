# AGENTS.md — Emberdawn

## Project and supported scope

Emberdawn is a turn-based RPG about seeking hope for a future, played in Telegram private chats.
Deno + grammY use Bot API Rich Messages: buttons live in the message body, never `reply_markup`.
Normal play edits one live game message per player.

The BotFather setting prevents group membership. Group handling and custom-crafted callback payloads
are outside scope; preserve normal stale-tap protection, engine/story authority, and active-scene
requirements for confirmation actions.

## Release lifecycle — current status: PRE-LAUNCH

This section alone determines whether save compatibility obligations are active. Deployment,
playtesting, database contents, tags, and `stateVersion` numbers do not imply public launch.

- Releases move forward only. Ship functional reverts as new changes, not older binaries or schema
  downgrades. Failed database transactions still require rollback for atomicity.
- Development/playtest saves are disposable. Persisted-shape changes advance `stateVersion`; refuse
  older saves rather than adding PlayerState migrations. PostgreSQL schema migrations are separate.
- Content IDs may be added, renamed, or removed without aliases, tombstones, or recovery shims.
  Every current code/content reference must resolve. Refuse unresolved persisted IDs with a /reset
  pointer; never guess replacements or invent fallback state.
- Public launch requires an explicit decision. Use the release skill for launch preparation or
  post-launch compatibility policy; its deferred rules stay inactive until launch is approved.

## Shared contracts

- **Pure, ordered core.** `src/engine/` and `src/content/` use pure local gameplay code, with no
  Telegram, Deno-specific, external-package, handler, or persistence dependencies. Engine entry
  points remain synchronous; resolution finishes before render/persist. No event bus, detached
  mutation, or parallel mutation of one fight. Async I/O belongs at the boundary.
- **One live message.** Normal gameplay commits through `src/handlers/session.ts`; explicit /start
  sends a fresh live message and makes older copies stale. No extra button-bearing gameplay
  messages. Validate message identity and stamped `uiRev` before mutation. Preserve
  revisionless/stale-tap refusal and the documented newer-message adoption behavior.
- **Mutation authority.** User-associated updates hold `PlayerStore.withLock(userId)` around the
  whole load → mutate → render → save flow, never across user input. Story operations derive
  authority from live PlayerState and content, revalidate scene/contact/conditions, apply bundles
  transactionally, suppress retries with receipts, and keep terminal outcomes monotonic.
- **Wire and save formats.** Build/parse callback data only with `src/codec.ts`
  (`encodeCb`/`decodeCb`); the limit is 64 bytes. PlayerState, including BattleState, is plain JSON.
  Battle-scoped state belongs on BattleState; derived runtime context is not persisted.
- **Rendering and prose.** Rendering is a pure function of PlayerState. Rich text uses typed
  entities and `src/render/rich.ts`; HTML renders literally. Names/flavor are creative; mechanical
  summaries are generated from structured effects. Rules vocabulary: Shield, DEF/RES, round, action,
  beneficial/harmful effect.
- **Code clarity.** Domain names reveal intent, including tests, scripts, and callback parameters.
  Prefer `player`, `battle`, `questDef`, and role-named counters over single-letter domain
  variables. Compact wire keys/values and idiomatic index-only `i`/`j` loops remain exempt.
- **Secrets.** Never commit .env files, tokens, or local database files.

## Task-specific guidance

Select guidance by the behavior being changed or reviewed. Read only relevant skills and reference
sections; a file's location or a shared domain noun does not require every related skill. Prose-only
edits use narrative guidance. Changes to structured consequences, navigation, or progression also
need the matching behavioral guidance. If the harness does not load a skill, read its listed file.

| Task                                                                                          | Skill                                                                              |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Engine/I/O boundaries, live-message lifecycle, callback authority, locking, webhook behavior  | [emberdawn-architecture](.agents/skills/emberdawn-architecture/SKILL.md)           |
| Quest progression, dialogue navigation, choice authority, transactional story effects         | [emberdawn-story-and-quests](.agents/skills/emberdawn-story-and-quests/SKILL.md)   |
| Combat resolution/effects, encounter behavior, combat balance                                 | [emberdawn-combat](.agents/skills/emberdawn-combat/SKILL.md)                       |
| Save shapes, validation/versioning, persisted identities, store/schema behavior               | [emberdawn-persistence](.agents/skills/emberdawn-persistence/SKILL.md)             |
| Structured content definitions, progression, acquisition, economy                             | [emberdawn-content-authoring](.agents/skills/emberdawn-content-authoring/SKILL.md) |
| Authored player-facing prose, dialogue, UI copy                                               | [emberdawn-narrative-writing](.agents/skills/emberdawn-narrative-writing/SKILL.md) |
| Explicitly requested launch preparation or post-launch save compatibility policy              | [emberdawn-release](.agents/skills/emberdawn-release/SKILL.md)                     |
| Code-quality refactors, cleanup findings, or proposed changes to documented design trade-offs | [emberdawn-design-decisions](.agents/skills/emberdawn-design-decisions/SKILL.md)   |

## Completion and decision boundaries

Inspect `git status` before editing. Preserve existing work and continue when the requested changes
can be distinguished safely; use a separate worktree when useful. Ask about overlapping changes only
when a consequential ambiguity remains. Do not reset, stash, or commit unrelated work to obtain a
clean tree.

For implementation requests, continue through the requested behavior, relevant verification, fixes
for defects caused by the change, and affected documentation. Review changed production code for
clear naming, structure, and ownership as well as correctness. Finish when the requested outcome and
applicable checks are satisfied, or report a concrete blocker requiring input. An initial
implementation alone is not completion; this does not authorize unrelated cleanup.

Local edits and disposable test fixtures needed for the task can proceed without repeated approval.
Keep settled design choices during ordinary fixes; an explicit request to revisit one authorizes
that design work. Publishing, deployment, live webhook changes, and shared database mutations need
authorization covering the target and operation. Existing authorization remains valid; prepare and
verify the work before asking for any outstanding decision. Public launch remains a separate
explicit decision.

## Verification

During development, choose checks for the changed behavior. For code changes, run these CI gates on
the final candidate before committing; rerun checks when later edits invalidate their evidence:

```sh
deno task fmt:check
deno task lint
deno task check
TEST_PG_URL= deno task test
```

For documentation-only changes, run formatting and relevant documentation checks. Agent-guidance
changes use `deno test --allow-import --allow-read tests/agent_docs_test.ts`. Read-only reviews and
explanations do not require running every gate. CI still runs the full gate matrix.

Persistence/schema behavior changes also need `deno task test:pg:local`, which creates a private,
disposable Docker Postgres and removes only that run's container. Alternatively, run
`deno task test:pg` with `TEST_PG_URL` explicitly pointing to a disposable test database. That suite
performs real writes/deletions; the ordinary test task includes it whenever the variable is
nonempty. Never substitute an unverified database URL. Bot integration tests use fake credentials
and captured transport; they do not require a live bot. Report skipped or blocked checks accurately.

For requested code-quality analysis, `npx fallow` is advisory. Use
[code-quality guidance](docs/code-quality.md#accepted-boundaries); preserve the owner's deferred
unused-API/export cleanup scope. Do not auto-apply removals.
