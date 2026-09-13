---
name: emberdawn-architecture
description: Implement or review Emberdawn engine/I/O boundaries, live-message lifecycle, callback authority, locking, or webhook behavior.
---

# Emberdawn architecture

The root `AGENTS.md` owns the project-wide invariants and supported operating model. Read the
reference and section for the behavior being changed; an edit in a handler does not by itself
require every I/O contract.

| Task                                                                    | Reference                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Engine imports, synchronous entry points, resolution completion         | [Engine boundary](references/engine-boundary.md)     |
| Message delivery/editing, revision guards, callback encoding, reset     | [Message lifecycle](references/message-lifecycle.md) |
| Per-player transactions, connection reuse, webhook authentication/setup | [I/O boundary](references/io-boundary.md)            |

Gameplay mutations complete before rendering and persistence. Preserve message/revision and engine
authority checks when changing transport. `tests/architecture_test.ts` pins the engine boundary;
message and reset behavior have handler/integration tests beside their owning subsystem tests.

For authored prose or generated mechanical disclosure, use the relevant sections of
[the narrative guide](../../../docs/narrative-guide.md#4-mechanicalflavor-boundary-inherited-from-120121).
