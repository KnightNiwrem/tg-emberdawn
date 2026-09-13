---
name: emberdawn-persistence
description: Implement or review Emberdawn save shapes, validation/versioning, persisted identities, or store/schema behavior.
---

# Emberdawn persistence

The root `AGENTS.md` owns the current release phase. Use `emberdawn-release` when explicitly
preparing launch or changing post-launch compatibility policy; its deferred rules do not apply
during pre-launch development.

| Task                                                                                 | Reference                                                                                                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Scene/player/battle shape, constructors, version acceptance, persisted ID validation | Relevant section of [save format](references/save-format.md)                                                                                  |
| Store reads/writes, transaction/connection lifetime, cross-instance locking          | `src/persistence/store.ts` and [locking contract](../emberdawn-architecture/references/io-boundary.md#locking-and-cross-instance-consistency) |
| PostgreSQL schema setup                                                              | `src/persistence/migrate.ts` and `tests/persistence_pg_test.ts`                                                                               |

`PlayerStore` has `PgStore` (Postgres/JSONB) and `MemoryStore` (tests) implementations. MemoryStore
clones reads and writes so mutations require an explicit save; its lock is a single-process
passthrough, not a transaction emulator. PostgreSQL schema migrations are separate from PlayerState
save migrations.

Persistence/schema behavior changes need the PostgreSQL round-trip check. Follow the root
verification guidance for a disposable database; setting `TEST_PG_URL` enables real database writes.
