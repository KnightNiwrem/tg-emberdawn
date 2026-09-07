---
name: emberdawn-narrative-writing
description: Use when writing or revising Emberdawn player-facing narrative, UI copy, NPC dialogue, character voice, motifs, or editorial style.
---

# Emberdawn narrative writing

The canonical editorial contract for every authored player-facing string is
`docs/narrative-guide.md`. **Read that guide before authoring or revising any narrative text** —
setting facts, narrator/UI/character voices, per-NPC voice sheets, motif use, and punctuation are
all defined there, and prose decisions are checked against it.

Boundary with mechanics (see the root `AGENTS.md` invariant): names and flavor text are creative and
may be nonliteral, but player-facing mechanical summaries are generated from structured effect
specs. Do not duplicate mechanical quantities, rules, or reward summaries in authored prose. Item
descriptions (`ItemDef.desc`) and skill flavor (`SkillDef.flavor`) remain number-free under the
guide's specific convention; ordinary numerical narration elsewhere is permitted. Use the canonical
rules vocabulary (Shield, DEF/RES, round, action, beneficial/harmful effect) in generic effect
output.

Tone register: the game is about seeking hope for a future. Maintain overall hope without denying
real loss. Describe temporary setbacks as recoverable; state permanent exclusions, failures, and
forfeited rewards plainly.
