# Emberdawn — Narrative & Style Guide (#128)

The editorial contract for every authored player-facing string. It exists so prose decisions are
checkable against a document instead of a mood. Names and flavor remain creatively free (the
**Flavor is not rules** invariant in `AGENTS.md`); only generated mechanical summaries are binding,
and they are never authored here.

## 1. Setting facts (canonical, revised #189)

- The **Great Flame** is the world's original fire. Its warmth travels through roots, springs, and
  the hearth channels people built above them. It also carries renewal: seed growing into grain,
  winter yielding to spring, and daylight returning strongly enough to sustain both.
- A century ago, **King Aldric** lost his daughter during a famine. He divided the Flame to stop
  further change, storing its renewing light in his crown and leaving the land diminishing warmth.
  Night and day still occur; seasons grow less fruitful and hearths harder to light. **Stolen
  tomorrow** means this loss of renewal, not a world literally frozen at one instant. Aldric's grief
  explains his decision; it never excuses continuing to impose it on others.
- The player volunteers to help **Emberdawn Village**, which must choose between eating its
  dwindling seed grain and planting it. A **Dawncaller** carries hearth-light toward its source to
  restore it. This is a chosen responsibility, never a bloodline, class, or prophecy. The ember lamp
  is a narrative object, not equipment or a promised combat power.
- The mandatory story follows connected channels: **Whisperwood** roots trapped by Aranya's brood →
  **Hollowmere** waterworks dammed by Vosk → **Sunspire** daylight hoarded by the Chronolich for
  Aldric → **Frostpeak** spring warmth held by Jormunis → the **Cinder Wastes** source drained
  through Ignivar's royal binding → the **Umbral Spire**, where Aldric's crown holds the stolen
  light. Each region restores something distinct and provides a concrete lead.
- **Frostfire** is a sheltered branch of the Great Flame that preserves roots through winter and
  releases warmth at the thaw. **Ignivar** is its ancient guardian at the source, called the Last
  Flame. Defeating him breaks the hardened shell around a surviving ember; Sorrel tends that ember
  afterward. Jormunis is a guardian whose protection became imprisonment.
- **Vosk** profits from control of clean water. The **Sun Cult** receives a promise of exclusive
  daylight and guards the hoard with armed patrols. **Crownsworn** are bound by Aldric's crown. Not
  every obstacle is a villain: quest verbs distinguish predation, coercion, trapped memories, and
  guardians. The generated kill-event UI says **Defeat**, without prescribing death.
- Defeating Aldric releases the light (`crownRestored`, on dungeon first-clear). The later report
  awards his empty broken crown as a record; it does not restore the light a second time. The
  recovered world still needs planting, rebuilding, and care.
- The **Seam** is the wound beneath the world left by the sundering, reached through the **Abyss**.
  Maren crossed its edge in her youth and returned alive. **Echo of Maren** is the memory left
  there, not Maren dead, trapped, or secretly replaced. The **Warden of the Void** formed to contain
  the wound and now attacks anyone approaching it. Its defeat at the bottom settles the breach. A
  wandering reflection is insufficient. The old paths and their battle echoes remain accessible
  afterward; the finale never claims the dungeon has disappeared.
- The Ferryman's optional shrine assignment offers **The Shrine's Beacon** or **The Water Intake**.
  One funded assignment closes the other. Refusing a religious pledge incurs no inexplicable debt.
  Beacon light gathers in the Ferryman's lamp after the wisp patrol; normal completion relights the
  beacon, while the alternate resolution grants a **Wisp Lantern** keepsake and forgoes the normal
  reward. The lantern has no combat effect.
- Display names follow current catalogs. Sorrel uses **he/him** consistently. Odo is the
  **Slowsmith** at **Mirefoot Landing**, the rest stop between Whisperwood and Hollowmere.

The chapter and quest audit, including transaction and location corrections, is recorded in
[the campaign revision](campaign-revision.md). This canon supersedes the thinner setting account
reviewed in the earlier entries of `editorial-review.md`.

## 2. Voices

### Narrator (system-adjacent, in-world)

- Second person, present tense, plain declaratives. Concrete nouns over abstractions: what the
  player can see, hear, or feel.
- Can carry atmosphere ("Your shadow moves a half-second late here.") but never game vocabulary: no
  chapters, tiers, postgame, levels, or XP.
- Restraint with figurative language: one image per beat. No em-dash hinges, no `not X, but Y`
  reversals as a default rhythm.

### UI/system voice (out-of-world, but never coy)

- Clear, direct, actionable. Errors state the problem and the fix: "You no longer have enough Iron
  Chunk — the quest stays open."
- Labels may name game facts (Quest Log, Shop, Lv, "Recommended Lv 7") — the UI is the one place
  system terms are allowed, clearly as UI.
- Never jokes at the player's expense, never withholds information for tone. "You are nowhere.
  Somehow." is a defect; "You are far from any road. Travel to rejoin the world." is the register.

### Character dialogue

One voice sheet per recurring NPC. The differentiators that matter are **syntax, directness,
formality, goal, and humor** — not just the assigned metaphor family.

| NPC                   | Background & role                                                  | Immediate goal / fear                                           | Worldview (the Flame)                                                         | Syntax & formality                                     | Humor                                   | Recurring subjects                           |
| --------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------- | -------------------------------------------- |
| **Elder Maren**       | Village elder; keeper of the last ember; raised half the village   | Rally the village; fears the village learning to live with less | The dawn was promised; dim is not dark; hope is work                          | Short, warm, declarative; plainspoken, no ornament     | Dry, kind, rarely; never at someone     | The ember, the children, the roads, work     |
| **Blacksmith Bram**   | Sixth-generation smith; the forge is the family religion           | Keep the forge running; fears a dull edge on a hard day         | Tomorrow needs tools; a promise is something you hammer out                   | Clipped imperatives; shop-talk as metaphor; practical  | Gruff one-liners about work             | Ore, temper, edges, the anvil, the road east |
| **Healer Lyra**       | Village healer; triage nurse energy                                | Keep everyone walking; fears the season's fevers outpacing her  | The Flame keeps its own; mend what is in front of you                         | Efficient lists; softens only with children            | Wry about patients, never about pain    | Scrapes, fevers, rest, drink, the granary    |
| **Warden Tom**        | Career ranger; lost two rangers to the Hollow                      | Hold the paths; fears being blamed for the deep wood            | The wood is owed care; symptoms are not the sickness                          | Patrol-brief clipped; numbers and places               | Gallows-dry, rare                       | Paths, the Hollow, rangers, counts           |
| **Ranger Pell**       | Solitary tracker; speaks to the wood more than people              | Hunt the Woodfangs; fears being known                           | The wood forgives; it never explains                                          | Fragments; no greetings, no small talk                 | None visible                            | Spiders, tracks, noise, heirlooms            |
| **The Ferryman**      | Pole-man of the fen; kept ferrying through the drowning            | Get people across; fears losing passengers in the mist          | The swamp is patient with everyone; practical help matters more than a pledge | Aphoristic but concrete; trades sayings                | Steady, wry; the coin-for-crossing kind | The water, coin, shrine work, the east       |
| **Curator Ombra**     | Self-appointed record-keeper of a looted city                      | Keep honest books; fears unrecorded loss                        | Ledgers outlast looters; memory is a ledger too                               | Precise, noun-heavy; inventories feeling               | Bone-dry accounting jokes               | Records, hours, theft, provenance            |
| **Ice-Outcast Rho**   | Exiled for leaving watch to save a child; survived the freeze      | Watch the pass; fears a wake-up done wrong                      | The cold isn't cruel; some things must be woken carefully                     | Blunt frontier sentences; second-person warnings       | Deadpan sizing-up                       | The wyrm, promises, the cold, who went up    |
| **Ashen Monk Sorrel** | Monk tending Ignivar; once blamed him, now makes amends            | Be understood before the fight; fears the guardian dying blamed | Starving is not falling; despair is easy                                      | Sermonic cadence that keeps tripping into plain speech | Gentle, sad, seldom                     | The guardian, blame, hunger, morning         |
| **The Archivist**     | Court copyist who recorded the sundering order; keeps its evidence | Record everything; fears an unread page                         | Memory is the one wealth never stolen                                         | Formal, archival; long sentences with precise clauses  | Bibliographic irony only                | Records, pages, memory, the King             |
| **Echo of Maren**     | Memory of young Maren; living Maren returned home                  | Send the living back up; fears being mistaken for her           | A hope that kept walking is still hope                                        | Like Maren, but softer edges and distance              | Maren's dry warmth, faded               | The climb, the seam, the village below       |

Rules of thumb: an NPC's syntax survives paraphrase — if a line could be moved to another sheet
without edits, it is not in voice. Humor is a character asset, not narration filler. Modern
administrative vocabulary (paperwork, management, corrections, processing, HR-isms) is out of world
and out of every sheet.

## 3. Punctuation & cadence

- Dialogue uses typographic quotes and em dashes sparingly; prefer commas and full stops. No
  rhetorical fragment stacking in narration.
- A short line lands only after enough context, and only when it is in someone's voice.
- Imagery is motif-managed (see §5), not decorative filler.

### 3a. Dialogue copy contract (#133)

The conversation renderer owns speech presentation. Authored dialogue content obeys four rules, each
machine-checked in `tests/dialogue_copy_test.ts`:

1. **Punctuation ownership.** Prompts, choice labels, and NPC/player speech are stored WITHOUT
   surrounding quotation marks — the renderer adds the quote marks, the `You — …` attribution, and
   the speaker heading. Narration is stored unquoted and renders unquoted.
2. **One deferral.** Every choice node exposes at most one non-mutating exit: the renderer's "✋ Not
   now" deferral. Never author a second "Not yet" response beside it.
3. **One beat per node.** A node carries one complete speech or one meaningful stage direction.
   Never split a sentence into clause + "X says." attribution fragments — the heading already names
   the speaker. Keep a narrator node only when it adds visible action or blocking.
4. **Transactional staging.** No line before a committing choice may assert that choice's effects. A
   handover, reward, unlock, or completion is narrated only AFTER the commit — offer the thing
   before ("She holds out a wax-sealed letter."), hand it over after, via `choice.next` post-commit
   beats. Turn-in labels name the actual transaction: "Hand over the samples" where goods change
   hands; a report, arrival, or conclusion everywhere else.

### 3b. Quest clarity and continuity (#189, #190)

- Essential lore belongs on the mandatory path. Optional topics deepen a person or event; they never
  hide the only explanation of the task or the player's role.
- An offer explains **what happened, who needs help, what to do, where to do it, and whom to report
  to**. A report acknowledges the deed and supplies the next lead. A metaphor can follow an
  explanation; it cannot replace the target, direction, or consequence.
- The accepting or reporting screen must stand alone. `render/quest_brief.ts` displays exact
  objectives and counts, current catalog sources, the finisher and region, rewards, unlocks, and
  consumed collection goods. It also handles the selected permanent-choice confirmation. Counts,
  item effects, and rewards remain structured data. Keep these facts out of duplicate authored UI
  summaries.
- Quest decisions use native Rich Message headings and lists for objectives, completion, and rewards
  (#192). Only repeated narrative context may collapse; targets, directions, handover costs,
  rewards, and consequences stay expanded. State reward timing and disclose exact forfeited rewards.
  Distinguish cancelling active work from permanently closing an unaccepted branch. Keep each
  consequence with its response, and pair a single response with the non-mutating **Not now**
  deferral in one aligned button row. A confirmation repeats only the selected response.
- Narrate the scene where the contact actually stands. A report can describe evidence brought back
  or visible recovery there; it cannot replay a remote boss death as a present event.
- Do not claim an item enters or leaves the bag without the matching transaction. Reading Maren's
  letter retains it; Bram receives it at turn-in. Pell's locket is real loot, consumed on delivery.
  Ombra awards the Sunspire Key after the automaton report.
- Do not imply a new gate when the task only prepares the player. The emblems and sigils give
  context for the next boss quest; they do not mechanically open dungeon floor doors.
- Recovery changes descriptions on return visits through `ZoneDef.aftermath`, derived from existing
  flags. Describe bounded progress: surviving enemies, damaged buildings, repeatable echoes, and
  unfinished repair can remain after a victory.

## 4. Mechanical/flavor boundary (inherited from #120/#121)

- `SkillDef.flavor` and `ItemDef.desc` are creative; they may be boastful, nonliteral, or wrong
  about the world. They never carry numbers.
- The player-facing rules block is GENERATED from effect data (engine/mechanics.ts) in the canonical
  vocabulary: Shield, DEF/RES, round, action, beneficial/harmful effect. Editing prose never touches
  it.
- Battle narration (`spec.line`, `defaultInstanceLine`) is in-world and distinct from the rules
  summary, but generic effect output (grants, fades, dispels) still uses the canonical terms.

## 5. Motifs (use deliberately, not decoratively)

- **Ember/ash** — persistence inside loss. The village, the Wastes.
- **Morning/tomorrow** — the stolen thing itself; ration it so each recovery lands. Never as a
  sign-off on every outro.
- **Ledgers/records** — Ombra, the Archivist, the Ferryman's job ledger.
- **Roots/paths** — Tom, Pell, the Whisperwood's memory.
- **Hunger** — Ignivar's tragedy, the Wastes; never a synonym for evil. A motif recurs when the
  story situation earns it, and never twice in one screen without new information.

## 6. Class neutrality

The player is "you" or "Dawncaller". Never assign the player a weapon, a spell, or a class in
dialogue ("You have a sword" is a defect). If a line must reference the player's capability,
reference their deeds or their reputation, which every class has.

## 7. Validation boundary

No lexical parser, sentiment model, or AI detector polices this prose. The machine-checkable facts
stay in tests: speaker structure, ids, references, staging, rewards, class neutrality of reward
gear, and the absence of game system terms in in-world fields (quest_copy_test.ts). Everything else
here is editorial judgment, exercised by deliberate review — not by a mood, and not by a particular
class of reviewer: the project is AI-owned end to end (#152), so an authorized AI
implementor/reviewer may complete and sign an editorial pass. Review passes — their inventories,
dispositions, and provenance — are recorded in `docs/editorial-review.md`.
