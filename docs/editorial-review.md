# Editorial Review Record

Durable provenance for player-facing prose review (#134, #149). `docs/narrative-guide.md` remains
the canonical editorial contract; this file only records **who reviewed what, against which commit,
and with what disposition**. It is not a prose specification, and no lexical blacklist, sentiment
model, or AI detector backs it — the machine-checkable facts stay in the test suite
(`tests/dialogue_copy_test.ts`, `tests/quest_copy_test.ts`, `tests/dialogue_test.ts`).

## Status of this record

- **Review method:** AI-owned editorial pass (Claude, agent session), complete. Emberdawn is owned
  and implemented end to end by AI agents (#152); the editorial role is deliberately role-neutral —
  the requirement is a deliberate review against the guide, with traceable scope and dispositions,
  not a particular species of reviewer. An authorized AI implementor/reviewer exercises editorial
  judgment and signs this record; honest provenance is kept rather than relabeled.
- **Reviewed state:** full corpus at commit `4bd86be` — the post-#133 dialogue structure, with the
  #147 Ferryman parent/aftermath rework and the #148 m5_arms staging rework applied — plus a focused
  Category 4 re-review of the #153 authored battle-narration diff (`4bd86be..cb10ff1`, signed
  2026-09-04 by the Kilo agent session; recorded in Category 4 below). Categories 1–3, 5, and 6 have
  no authored-prose changes since `4bd86be` (the #150/#152 work touches engine validation and
  governance documentation only).
- **Disposition:** **COMPLETE.** All six categories below are judged with per-category dispositions;
  the sign-off checklist at the bottom is filled from that evidence. Independent review — by another
  AI agent or a human contributor — is OPTIONAL: useful, but not a hidden launch requirement unless
  the owner explicitly makes it one (#152).

## Review method

For each category below, the inventoried files at the named commit were read and judged by the
guide, especially:

- Does each recurring NPC differ in syntax, directness, formality, motive, and humor — not only
  motif vocabulary? (guide §2 voice sheets)
- Does narration use concrete action and observation more often than abstract portent?
- Are clipped fragments earned by the speaker/scene?
- Are morning/tomorrow, memory, promise, ledger, and personification motifs rationed across adjacent
  screens? (guide §5)
- Do quest verbs respect non-villainous enemies and obstacles? (guide §1)
- Is the player class-neutral? (guide §6)
- Does any authored narration accidentally become a second rules summary? (guide §4)
- Are UI errors clear about both the problem and the recovery action? (guide "UI/system voice")
- Are intentional guide departures specific and defensible?

Per category the record states: reviewer, date + commit SHA, disposition (approved / edited /
intentionally retained), and the rationale for any material deviation kept on purpose. A future
re-review follows the same procedure — it is role-neutral by design (#152).

## Inventory and disposition

Reviewer for all categories: Claude (AI agent session), an authorized AI reviewer per #152. Date:
2026-09-04, against commit `4bd86be`. Category 4 supplemental re-review (the #153 authored-line
diff): Kilo (AI agent session), also an authorized AI reviewer per #152. Date: 2026-09-04, against
the `4bd86be..cb10ff1` diff range.

### 1. Quest summaries and dialogue

**Files:** `src/content/quests.ts` (47 quest `name`/`summary` fields),
`src/content/quest_dialogues.ts` (~2,940 lines: offer, conversation, and turn-in dialogues for every
quest), quest-tied conversations in `src/content/dialogues.ts` (`dlg_ferry_promise`,
`dlg_ferry_aftermath`).

**Disposition: retained.**

- Summaries are concrete and in-world; verbs respect non-villainous foes (`m14_emblem` "Release the
  Frost Wraiths from their vigil", `sq_stag` "Put the corrupted stag to rest", `m19_ignivar` "free
  the flame, don't just end the fight", `sq_yetis` "Drive the glacier yetis from the pass before
  they drive you").
- The #133 copy contract (unquoted stored speech, one deferral, one beat per node, transactional
  staging) is machine-checked corpus-wide; #148 added the m5_arms targeted staging regression.
- #147's new pledge-parent prose (`sq_shrine_pledge`, its offer/turn-in dialogues, the reworked
  pledge/aftermath conversations) was drafted against the Ferryman voice sheet (ledger/water
  aphoristics) and is reviewed against that sheet here: **retained** — the register holds (belief as
  bookkeeping, the water's patience), no voice drift into another character's syntax, and the
  parent/aftermath beats stay concrete.

### 2. NPC greetings, topics, and recurring-character dialogue

**Files:** `src/content/zones.ts` (11 NPC `greeting` fields + static topic texts),
`src/content/dialogues.ts` (ambient conversations `dlg_maren_flame`, `dlg_bram_forge`).

**Disposition: retained.**

- Voice differentiation reads as structural, not just motif-assigned: Maren (warm declaratives),
  Bram (clipped imperatives, shop-talk), Lyra (triage lists), Tom (patrol-brief counts), Pell
  (fragments, no small talk), Ferryman (aphoristic trades), Ombra (precise inventories), Rho (blunt
  second-person warnings), Sorrel (sermonic cadence tripping into plain speech), Archivist (formal
  long clauses), Echo (Maren with softer edges).
- Static topic text is stored WITH typographic quotes (Lyra's `lyra_work`) while greetings are
  stored WITHOUT (the renderer adds them — the #122/Pell regression). The two surfaces are presented
  differently by design; reviewed deliberately: **kept** — greetings are speech the renderer frames,
  lore topics are excerpted in-world documents whose quotes are part of the text. Recorded as an
  intentional departure below rather than left as an open asymmetry.

### 3. World, zone, exploration, dungeon, and travel narration

**Files:** `src/content/zones.ts` (9 zone `desc` fields, ~35 authored explore-event texts:
treasure/rest/flavor, dungeon `desc` fields). Travel/arrival lines are generated by the renderer,
not authored prose.

**Disposition: retained.**

- Explore texts are second person, present tense, concrete ("You boil swamp water and rest. Barely
  restful."), one image per beat, no system vocabulary (guarded by the `quest_copy_test` leak checks
  for zone descs).

### 4. Enemy and battle narration

**Files:** `src/content/enemies.ts` (56 enemies: names, emoji, `desc`, move names, authored effect
`line`s, opening lines), plus authored `spec.line` battle narration on equipment triggers in
`src/content/items.ts`.

**Disposition: retained, with the one recorded defect fixed (#153).**

- Periodic/status battle narration uses canonical terms with `{n}` interpolation where supported;
  the generated rules summary (`src/engine/mechanics.ts`) remains the sole binding explanation.
- The concrete defect recorded at review time — equipment trigger `line`s hardcoding amounts and
  durations that duplicate their structured spec fields — was fixed under **#153**: authored battle
  narration is qualitative, `{n}` reports only resolver-supplied values, and a narrowly scoped
  integrity check (`tests/battle_lines_test.ts`) rejects duplicated mechanical numbers. The exact
  figures surface once through the generated summaries and live effect rows.
- **Supplemental re-review (Kilo, AI agent session, 2026-09-04, `4bd86be..cb10ff1`):** the #153
  rewrites of authored `EffectSpec.line` prose in `src/content/enemies.ts` (enemy move lines),
  `src/content/items.ts` (equipment-trigger lines), and `src/content/skills.ts` (skill lines) were
  read as a diff against the guide. The replacement lines are qualitative and in-world ("🕸️ The
  webbing binds your legs — Webbed!", "⏳ Sand falls upward — the foe is Slowed."), keep the
  canonical status names, carry no copied amounts or durations, and use `{n}` only where the value
  is resolver-supplied (the Wardstone ward absorb, Bloodsurge's healed HP). Binding figures now
  surface once through the generated summaries and live effect rows. Disposition: **retained** — the
  fix holds the flavor/rules boundary (guide §4); no new prose defects found.

### 5. Item and skill names/flavor

**Files:** `src/content/items.ts` (107 items: names, `desc`, trigger names), `src/content/skills.ts`
(48 skills: names, `flavor`).

**Disposition: intentionally retained per the #120/#134 boundary.** Names and flavor stay creatively
unrestricted — playful, nonliteral, even mechanically misleading; they were **not** "corrected" into
rules text, and none carry the binding mechanical summary.

### 6. UI/system/error copy

**Files:** `src/render/views.ts`, `src/render/menus.ts`, `src/render/battle.ts`, user-facing engine
lines (`src/engine/quests.ts` ready/cancellation lines, `src/engine/story.ts` grant/unlock lines),
handler toasts in `src/handlers/`.

**Disposition: retained.**

- Errors state problem and remedy ("You no longer have enough Iron Chunk — the quest stays open."),
  never joke at the player's expense, and canonical vocabulary (Shield, DEF/RES, round, action,
  beneficial/harmful effect) is used on factual mechanical surfaces. System terms appear only in
  clearly system-labeled UI (Quest Log, Lv, shop tiers).

## Intentional guide departures kept on purpose

- **Pell's silence** — "Pell doesn't say thank you. Rangers never do." A voice-sheet-driven
  departure from warmth; earned by character, kept.
- **Battle narration adjacent to mechanics** — `spec.line`s are in-world and deliberately distinct
  from the generated rules block; kept, with the duplicated-number drift risk fixed under #153.
- **Static topic quoting asymmetry** — noted above; deliberately kept after review: greetings are
  renderer-framed speech, lore topics are in-world excerpts whose quotes belong to the text.

## Recent authored-prose provenance (for the reviewer's attention)

- `deca034` / #133: corpus-wide dialogue restructuring.
- `e72ade6` / #134: mechanical-copy determinism + targeted NPC/weapon/armor corrections.
- `c5247f6` / #147: new pledge-parent quest copy and reworked Ferryman pledge/aftermath prose.
- `4bd86be` / #148: m5_arms offer/turn-in re-staging.
- `cb10ff1` / #153: qualitative battle-narration rewrites (enemy move lines, equipment-trigger
  lines, skill lines); duplicated numeric mechanics removed and re-reviewed in Category 4 above.

All five carry render/flow tests for their machine-checkable facts; none introduced a lexical
acceptance gate.

## Editorial sign-off (completed #152)

Signed by the authorized AI implementor/reviewer per the owner clarification in #152 (Emberdawn is
AI-owned end to end). Provenance is recorded honestly: the full-corpus reviewer is the Claude agent
session named above; the #153 supplemental Category 4 re-review was signed by the Kilo agent session
recorded in Category 4. No human participation is implied or invented. Independent review by another
agent or a human remains optional.

- [x] Reviewer: Claude (AI agent session), authorized editorial reviewer (#152); #153 supplemental
      re-review by the Kilo agent session, also authorized (#152)
- [x] Review date and commit SHA: 2026-09-04, `4bd86be`; Category 4 supplement 2026-09-04,
      `4bd86be..cb10ff1`
- [x] Category 1 — quest summaries/dialogue: retained (#147 prose reviewed against the voice sheet)
- [x] Category 2 — NPC greetings/topics/recurring dialogue: retained (quoting asymmetry decided)
- [x] Category 3 — world/exploration/dungeon narration: retained
- [x] Category 4 — enemy and battle narration: retained; duplicated-numbers defect fixed and
      reviewed under #153 (supplemental diff review above)
- [x] Category 5 — item and skill flavor (creatively unrestricted): intentionally retained
- [x] Category 6 — UI/system/error copy: retained
- [x] Recurring NPC voice sheets checked against their shipped corpus
- [x] World-event and UI/system copy explicitly included
- [x] Material intentional departures documented above still defensible
- [x] Names/flavor left creatively non-binding; generated summaries remain the sole rules source
