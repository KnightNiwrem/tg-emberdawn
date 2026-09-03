---
name: emberdawn-narrative-writing
description: Use when writing or revising Emberdawn player-facing narrative, UI copy, NPC dialogue, voice, motifs, or editorial style.
---

# Narrative Writing — Emberdawn

Operating guide and router for authored prose, character dialogue, UI copy, and world narrative.

## Canonical Editorial Guide

All authored player-facing text in Emberdawn must adhere to the editorial standards defined in:

- `docs/narrative-guide.md`

Before writing or editing dialogue scenes, quest descriptions, item flavor text, skill descriptions,
notices, or NPC voice lines, **read `docs/narrative-guide.md` in full**.

## Summary of Core Principles

1. **Theme & Register:** Emberdawn is about _seeking hope for a future_ — the player is a
   **Dawncaller**, the Sundered King is despair hoarding tomorrow, and each chapter recovers a piece
   of the dawn. Setbacks are real but framed as "not yet", never "never".
2. **Three Distinct Voices:**
   - **Narrator Voice:** Observant, grounded, second-person present ("You step into the snow").
   - **UI / System Voice:** Clean, functional, neutral notices ("📜 Quest ready to turn in").
   - **Character / NPC Voice:** Distinct per-character voice sheets with unique syntax, vocabulary,
     formality, goals, and cadence. Consult the voice sheets in `docs/narrative-guide.md`.
3. **Mechanics vs. Flavor:** Mechanics summaries are generated programmatically via
   `src/engine/mechanics.ts`. Authored flavor prose (`flavor`, `desc`) must never quote raw stat
   numbers or make conflicting mechanical claims.
4. **Canonical Rules Terms:** The pool is always **Shield** (never "ward"), durations are
   **rounds**, turns are **actions**, and cleanses/dispels target **beneficial/harmful effects**.
5. **Editorial Review Boundary:** General narrative voice and tone evaluation remain matters of
   editorial judgment. Automated suites (`tests/quest_copy_test.ts`) strictly verify targeted
   factual invariants:
   - Rejecting meta terms ("chapter", "postgame") in in-world descriptions and greetings;
   - Rejecting modern administrative jargon ("paperwork", "management", "corrections", "diplomacy")
     in quest names and summaries;
   - Rejecting non-canonical hyphenated NPC references (e.g. "Echo-of-Maren" instead of "Echo of
     Maren");
   - Rejecting embedded quotation marks (`"`, `“`, `”`) in NPC greetings (the renderer supplies
     quotes);
   - Requiring high-tier gear descriptions (tier 4+) to differ from starter gear descriptions.
