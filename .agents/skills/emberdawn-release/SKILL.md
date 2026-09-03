---
name: emberdawn-release
description: Use when planning or executing an explicit Emberdawn public launch or changing post-launch save compatibility policy.
---

# Release & Migration — Emberdawn

Operating guide for public release compatibility obligations, durable save contracts, and the launch
transition checklist.

> [!IMPORTANT]
> **Status: DEFERRED / INACTIVE** This entire document is inactive while the authoritative phase in
> root `AGENTS.md` is `PRE-LAUNCH`. Do not activate these rules until public launch is explicitly
> approved.

## 1. Authoritative Status Boundary

The release lifecycle status declared in root `AGENTS.md` is the sole source of truth for whether
public save-compatibility obligations are active.

- Deployments, playtest releases, database contents, Git tags, and `stateVersion` numbers do **not**
  imply public launch.
- Transition to `LIVE` occurs strictly through explicit approval and completion of the transition
  checklist below.

## 2. Deferred Post-Release Rules (Active at Public Release)

When the project transitions to `LIVE`, the following invariants become strictly binding:

### Durable Content Identity Contract

- Once an identifier can be persisted by a live release, it enters the permanent durable save
  contract.
- Persisted content IDs must remain resolvable and must never be casually renamed, deleted, or
  reassigned.
- **Persisted ID scope:**
  - `currentZone`;
  - Inventory and equipment item IDs;
  - Quest keys and tracking records;
  - Learned skill IDs;
  - Active-battle enemy IDs and effect source IDs;
  - Battle origin zone and dungeon IDs;
  - Scene arguments;
  - IDs encoded into persistent flags (e.g. `forge_i_<itemId>`);
  - Decision identifiers and choice IDs;
  - Story receipt key families (`line:<dialogueId>:<nodeId>` and
    `choice:<dialogueId>:<nodeId>:<choiceId>` persisted in `p.storyReceipts`).
- Presentation changes (display names, descriptions, flavor text) may change freely without
  violating persistence contracts.
- Retired content may cease being dropped or sold, but must remain resolvable in catalog lookups for
  existing players.

### Versioned Save Migrations

- Any intentional breaking schema modification requires an explicit, sequentially ordered migration
  step based on `stateVersion`.
- Heuristic "state looks old" sniffing is strictly forbidden.
- Live players must **never** be directed to `/reset` as a workaround for compatibility issues.

### Unknown Identifier Handling

- If an unknown persisted ID appears in live operation, it indicates corruption, tampering, a failed
  migration, or an incompatible release.
- Fail observably with clear diagnostic reporting. Do not silently relocate the player, guess a
  replacement, or overwrite the corrupted data.

## 3. Launch-Transition Checklist

When public launch is explicitly approved:

1. Change the authoritative phase in root `AGENTS.md` from `PRE-LAUNCH` to `LIVE`.
2. Record the first live commit hash and the baseline `CURRENT_STATE_VERSION` live saves are created
   with.
3. Generate a baseline catalog manifest capturing every content-ID family persistable in a supported
   save (including decision identifiers, choice IDs, and story receipt keys).
4. Add a CI test verifying that future catalogs remain a superset of that live baseline manifest (or
   provide an explicit, tested migration). Introduce this test at launch, not before.
5. Activate the deferred durable-save rules in this document.
6. Audit all player-facing incompatible-save copy to ensure live saves are never referred to as
   disposable.
7. Verify that no tooling or automation assumes launch status without reading root `AGENTS.md`.
