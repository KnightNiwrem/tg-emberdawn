# Player copy redundancy review (#192)

**Reviewer:** Codex, 2026-09-05. **Reviewed revision:** `7a3a2cf56d202d87fca44b99c193441ace84d63b`,
after pushing the owner's requested removal of “Completion is a report; no items are handed over”
and “These leave your bag.”

**Disposition:** the requested deletions are shipped. The findings below are recommendations from
the subsequent review; they have **not** been applied to gameplay copy. This is a redundancy review,
not a blanket approval of every aspect of the content.

The recurring problem is explanatory copy that survives after the interface already communicates the
fact. Another pattern is dialogue defending against a hypothetical misunderstanding instead of
speaking naturally to the player. Keep requirements and unusual consequences explicit once; trust
familiar verbs such as **Finish with**, **Hand over**, and **Not now**.

## Scope and method

Read the authored prose extracted from the current catalogs, with dialogue node/choice identities
preserved, then inspected the relevant renderers to distinguish repetition across separate scenes
from duplication within one view. Extraction was an inventory aid; judgments were made by reading
the text in context, not by a word blacklist or classifier.

| Content                  | Reviewed scope                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Quests and conversations | 47 quest definitions; all 99 dialogues, including offer/report prompts, branching hints, and optional lore                                    |
| World                    | 10 zones, their NPC greetings/topics, recovery and exploration text; 7 dungeon descriptions; 20 directed routes and their variant/event prose |
| Items and skills         | Descriptions across 109 items and flavor across 48 skills, including authored effect narration where present                                  |
| Enemies and services     | Descriptions/narration across 56 enemies; names/descriptions in 5 shops and 3 forges                                                          |
| UI                       | Quest briefs, journal, NPC/dialogue screens, equipment and item details, shops/forge, travel, help, tutorial, and battle/menu copy            |

Generated combat rules were treated as necessary factual disclosure. This pass does not change quest
flow, receipts, effects, rewards, or save state. No live Telegram visual review is claimed.

## Recommended follow-ups

### 1. Remove the equipped-item explanation

[renderEquippedItemDetail](../src/render/menus.ts) prints
`Equipped: <slot>. This piece is worn, not carried.`

“Equipped” already communicates this. Keep `Equipped: <slot>.` The **Unequip** action and the
separate bag view provide the remaining context. This is the closest match to the two explanations
just removed from quest completion.

### 2. Show the quest completion contact once

[renderQuestDetail](../src/render/views.ts) includes the completion contact through
`questBriefBlocks()`, then adds it again near the Back button. An active **The Sealed Letter**
actually renders `Finish with Blacksmith Bram — Emberdawn Village.` twice. A ready quest repeats the
same destination as **Finish with** and **Return to**.

Use one completion-contact block, with the ready-state wording there if useful. Preserve the **Start
with** contact on offers: delivery quests can start and finish with different people, so that
distinction is meaningful.

### 3. Remove the second mechanical summary from branch hints

The three responses in [dlg_ferry_promise](../src/content/dialogues.ts), node `n3`, still have
authored hints that repeat quest starts, objectives, report destinations, and permanent exclusions.
[choiceQuestBlocks](../src/render/quest_brief.ts) now generates those facts alongside the hint on
both selection and confirmation screens.

Remove the mechanical restatement from the `promise` and `decline` hints. Keep only
`Your toxin work earns the keepers' trust.` for `vouch`, which adds context beyond the generated
facts. Continue showing the generated permanence and exact lockout warning for every committing
response.

The `keep` hint in [dlg_sq_shrine_pact_turnin](../src/content/quest_dialogues.ts), node `ta`,
repeats the generated grant and lost rewards as well. A concise remaining hint could be:
`The beacon remains unlit. The lantern is a keepsake with no combat effect.` Those facts are useful
and are not covered by the generated reward list.

### 4. Cut corrective asides from otherwise clear quest dialogue

These examples in [quest_dialogues.ts](../src/content/quest_dialogues.ts) state the real task, then
explain why an unmentioned alternative is wrong:

| Scene                             | Redundant wording                                                                       | Suggested change                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dlg_m5_arms_offer`, `o2`         | “The ore is your contribution; there is no coin fee for this job.”                      | Delete. Bram has just asked for iron and offered to pay for it. Retain that stronger equipment is **for sale**, since a free equipment grant would be a plausible misunderstanding. |
| `dlg_m11_toll_offer`, `o1`        | “You will not find it in their wreckage.”                                               | Delete. Ombra already says they have the key and will issue it after the patrol.                                                                                                    |
| `dlg_m22_umbral_key_turnin`, `t1` | “You need no royal key;”                                                                | Keep only “The stair opens onto the Sundered Throne.” Nothing on this screen asks the player to find another key.                                                                   |
| `dlg_sq_salamanders_offer`, `o1`  | “We count the creatures you face, not whole herds.”                                     | Delete. The structured objective already names individual Fire Salamanders and their count.                                                                                         |
| `dlg_sq_rats_offer`, `o2`         | “Leave the Ember Rats to Maren's patrol; this job is for the ordinary, oversized kind.” | Name **Giant Rats** in the preceding instruction and remove the aside. The exact species is also bold in the objective.                                                             |

The same habit appears in `dlg_ferry_aftermath`, nodes `a2`/`a3`:
`Your quest notes carry the tally.` The requested reminder can end with its directions; a player who
opens a quest journal expects it to track progress.

### 5. Replace repeated administrative turn-in prompts with NPC speech

The live catalog has **16** occurrences of `Ready to report on this work?` and **3** of
`Ready to hand over the requested goods?` in
[quest_dialogues.ts](../src/content/quest_dialogues.ts). They repeat the action button and flatten
differences between the NPCs. “Requested goods” is especially awkward when Pell is asking for his
mother's locket.

Keep the committing choice and its brief, but let its prompt belong to the scene. Examples:

- Pell's locket (`dlg_sq_locket_turnin`, `ta`): `Is that her locket?`
- Lyra's lamp shards (`dlg_sq_charm_turnin`, `ta`): `The lamp cups are ready.`
- Bram's ore (`dlg_sq_ore_turnin`, `ta`): `Let's see the iron.`
- Ferryman's beacon choice (`dlg_sq_shrine_pact_turnin`, `ta`): `Where shall the light go?`

The corresponding **Hand over** or **Report** label already tells the player what the tap does. Do
not remove the choice node or move its effects into an earlier narrative beat.

### 6. Describe conversation-quest completion without asking the player to confirm twice

The summaries for `m8_passage`, `m17_plea`, and `m22_umbral_key` in
[quests.ts](../src/content/quests.ts) add variations of **confirm your preparations/understanding**.
Sorrel's report prompt asks `Do you understand why Ignivar must be faced?` This can feel like a
comprehension check after the player has just read the explanation.

Describe the concrete next step instead: hear the account, take the supplies, or prepare for the
descent, as appropriate to the existing transaction.

The shrine parent needs particular care: `sq_shrine_pledge` says to choose a **permanent**
assignment and then return to **confirm your answer**. The answer is already permanent when its
confirmation commits; the later turn-in pays the parent quest. Suggested summary:
`Discuss the shrine's two jobs with the Ferryman. Choose one assignment, then collect the planning payment.`
Its `Say the answer stands` button could become `Collect the planning payment`. Keep the permanent
choice warning on the actual branch decision. The follow-up speech can simply offer that payment;
`Your choice stands whichever task you finish first` need not repeat the permanence rule.

### 7. Shorten forge and travel copy that explains the implementation

[renderForge](../src/render/views.ts) calls effects `fixed authored data`. That is an implementation
description with no player value. The useful statement is `Tempering does not change item effects.`
The preceding sentence lists every way another copy can be acquired: **forged, bought or looted**.
`All copies of this gear share your temper level.` communicates the unusual rule more directly.

The travel menu says `Every road leads somewhere specific` and
`A count is rolls, never promised
battles`, then explains the event mix again on departure
confirmation. The destination is already named on every route. One brief explanation is sufficient:
`Road events may be battles, quiet stretches, or useful finds.` Keep the event count and the
consequence of retreating to the departure zone; that consequence is useful planning information.

The Help screen also explains its single-message nature in both its opening and closing lines, and
full healing on haven arrival in both **Safe havens** and **Travel**. Keep each explanation once,
including the practical `/start` recovery instruction.

### 8. Keep one clear boss-escape warning

The under-level boss warning in [renderZone](../src/render/views.ts) says
`bosses cannot be fled: no escape, no Smoke Bomb, only defeat or victory.`

The consequence matters, but it does not need four formulations. Suggested ending:
`You cannot flee this fight, even with a Smoke Bomb.` Keep the boss level, recommendation, and
player level. This preserves the exception an experienced RPG player might otherwise get wrong.

### 9. Give early equipment distinct flavor when that content is next revised

[items.ts](../src/content/items.ts) reuses **8** default descriptions across **24** tier-1–3
equipment pieces: one description for each class's weapon or armor family. A shop can therefore show
`A warrior's answer to most questions.` three times beside different swords.

This is lower priority than repeated instructions. Give each piece one concrete material, maker, or
wear detail when revising early equipment. Do not add another summary of its stats. Most later gear,
consumables, and skill flavor is already short and does not need explanation removed.

## Information worth retaining

- Exact objectives, counts, locations, item handovers, rewards, travel unlocks, and lost reward
  packages. A player should not infer these from flavor or an icon.
- One permanence warning and the name of the branch that closes, attached to the relevant choice.
- Non-obvious rules: boss escape restrictions, a boss key consumed on victory, automatic item/skill
  activation, and forge mastery applying to every copy.
- A concrete reason for each quest and an outcome after it. An offer and a later report occur at
  different times; acknowledging the action afterward is not redundant UI explanation.
- Directions in the read-only journal and in an explicitly requested NPC reminder. These are
  independently usable views, so shared facts there are useful.
- Brief continuity about surviving enemies and replayable dungeons after a victory. Retain one
  relevant statement per view; do not erase the world's recovery or promise that all encounters
  disappear.

Suggested order for a later cleanup: same-screen duplicates and obvious explanatory asides first;
branch-hint consolidation next; voice-specific turn-in prompts and conversation-quest wording
afterward. The first two groups can shrink the screens without changing the story's pacing.
