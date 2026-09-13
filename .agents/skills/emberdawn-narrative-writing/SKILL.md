---
name: emberdawn-narrative-writing
description: Use when writing or revising Emberdawn player-facing narrative, UI copy, NPC dialogue, character voice, motifs, or editorial style.
---

# Emberdawn narrative writing

The canonical editorial contract for every authored player-facing string is
[docs/narrative-guide.md](../../../docs/narrative-guide.md). Read the sections relevant to the task
using the map below; combine routes when an edit spans several concerns. The guide remains the
authority for prose decisions.

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

## Read for the task

Section references below identify headings in `docs/narrative-guide.md`.

| Task                                             | Read                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spelling or punctuation only                     | The surrounding text and §3 **Punctuation & cadence**; for dialogue quotation marks, also §3a **Dialogue copy contract**. Preserve meaning, speaker, and consequences. If these change, use the corresponding routes below.                     |
| UI labels, errors, or explanations               | §2 **UI/system voice**; §4 **Mechanical/flavor boundary** for rules or reward wording; §3b **Quest clarity and continuity** for quest requirements, decisions, or consequences.                                                                 |
| NPC speech or a conversation                     | §2 **Character dialogue**: its shared guidance and the affected NPC's row, plus §3a **Dialogue copy contract**. Read §3b **Quest clarity and continuity** for continuity and §1 **Setting facts** for the speaker, region, and events involved. |
| Narration, setting, or lore                      | §1 **Setting facts**, including the affected regional facts; §2 **Narrator** for narration; §3b **Quest clarity and continuity** for progression, reports, or aftermath.                                                                        |
| Item descriptions, skill flavor, or battle lines | §4 **Mechanical/flavor boundary**; also §2 **Narrator** for in-world battle narration.                                                                                                                                                          |
| A substantial new scene                          | Combine the setting and applicable voice routes above, including dialogue and continuity guidance where relevant. Read §5 **Motifs** when choosing the scene's imagery.                                                                         |

For new or rephrased in-world prose, also read §3 **Punctuation & cadence** and §6 **Class
neutrality**. Read §5 **Motifs** when adding or revising imagery. A narrow copy fix need not load
unrelated setting facts or other NPC voice sheets; expand reading if the surrounding text exposes a
continuity or meaning change.

Check mechanical promises against structured effect data and §4. If the task also changes or reviews
dialogue flow, choice structure, quest lifecycle, or story effects, load
`emberdawn-story-and-quests`. Use the root `AGENTS.md` routes for affected content or combat
contracts.

For an editorial pass, read §7 **Validation boundary** for the boundary between automated checks and
editorial judgment, the existing authorization for AI review, and recording review scope, findings,
dispositions, and provenance in GitHub issues.
