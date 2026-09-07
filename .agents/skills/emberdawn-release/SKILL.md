---
name: emberdawn-release
description: Use when an explicit public-launch decision is being made for Emberdawn, or when changing post-launch save compatibility, migration, or durable content-ID policy.
---

# Emberdawn release policy

The root `AGENTS.md` is the only source of truth for the current release phase; this skill does not
repeat its value. Read the current phase from root `AGENTS.md`: while it says PRE-LAUNCH, the
deferred rules below are inactive; once an explicitly approved launch changes root to LIVE, they
become active. Deployment, playtesting, database contents, tags, and `stateVersion` numbers do not
imply launch, and nothing may infer or automate the transition.

## Deferred rules (activate at public release only)

- Once an ID can be persisted by a live release, it is part of the durable save contract. Persisted
  content IDs must remain resolvable and must not be renamed, deleted, or reused casually.
- The contract covers nested and encoded identities as well as top-level catalog keys. Use the
  identity-location inventory in `src/engine/validate.ts` as a starting point; the live baseline
  must cover every identity that can appear in a supported save, including any the validator omits.
- Presentation fields may change freely only when they do not participate in persisted identities.
  Enemy move names currently serve as effect identities and are covered by the durable-ID contract.
- Retiring content may stop future acquisition while retaining lookup compatibility.
- Any intentional incompatible change requires an explicit versioned save migration (ordered
  `stateVersion` steps, never "state looks old" sniffing) or another deliberate compatibility
  design.
- Live users must never be directed to `/reset` as a substitute for supported compatibility.
- If an unknown ID nevertheless appears once these guarantees are active, it indicates corruption,
  tampering, a broken migration, or a contract-violating release — let it be observable rather than
  silently relocating the player or substituting unrelated content.

## Launch-transition checklist

When public launch is explicitly approved:

1. Change the authoritative phase in the root `AGENTS.md` from PRE-LAUNCH to LIVE.
2. Record the first live commit and the `CURRENT_STATE_VERSION` live saves are born with.
3. Capture a baseline manifest of every content-ID family that can appear in a supported save.
4. Add a CI test proving future catalogs remain a superset of that live baseline, unless the same
   change supplies and tests an explicit compatible migration. Introduce this test at launch, not
   before — a pre-launch baseline test would recreate the strictness the disposable-saves policy
   exists to avoid.
5. Activate the deferred post-launch migration and durable-save rules above.
6. Audit player-facing incompatible-save wording so it no longer describes live saves as disposable.
7. Do not infer or automate this transition merely because a deployment or version tag exists.

## Post-launch schema policy (deferred)

After launch, real saves are durable: bump `CURRENT_STATE_VERSION` and add an explicit ordered
migration from every supported live version (`stateVersion` steps, never "state looks old"
sniffing). Never tell live players to reset as a substitute for compatibility. The pre-launch
mechanics of the version gate are documented in `emberdawn-persistence`.
