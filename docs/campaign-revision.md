# Campaign revision: a dawn worth recovering

Owner-authorized narrative rebase, 2026-09-05. Tracked in
[#189](https://github.com/KnightNiwrem/tg-emberdawn/issues/189),
[#190](https://github.com/KnightNiwrem/tg-emberdawn/issues/190), and
[#191](https://github.com/KnightNiwrem/tg-emberdawn/issues/191). Base:
`0ee4768baf30c070abfd99406fe34e10381dbecf`. The accompanying fix commit is the reviewed revision.
Canon lives in [the narrative guide](narrative-guide.md).

## Findings and editorial decisions

The previous story named its themes before establishing their meaning. “Hoarded tomorrow”,
“hearth-roads”, “the wood keeps heart enough to hope”, and “the door was never locked, only mourned
shut” supplied mood but little a new player could act on. Many quests replaced the last instruction
screen with a generic acceptance prompt. The player needed to remember unexplained language and
consult a journal that itself hid objectives when available or ready to turn in.

The revision makes the loss observable: the village's growing season is failing, its hearth will not
stay lit, and its seed grain may become its last food. The player volunteers to carry an ember;
Maren, Bram, and Lyra continue work at home. The first fight protects a seed shed. The first quest
protects grain. The letter then identifies a warm channel below cold soil, with a map, a location,
and a ranger who can guide the investigation. These are reasons to move, rather than a prophecy.

Aldric's theft now has an intelligible motive and mechanism. After losing his daughter during a
famine, he tried to prevent further change by dividing the original fire and keeping renewal for
himself. The world still has days and seasons, but less power to sustain growth. The crown's drain
and the regional obstructions explain why local action matters before the final confrontation.
Understanding his loss does not require forgiving his continuing choices.

## Mandatory chapter sequence

| Region                  | Immediate work and beneficiary                                                                                 | Recovery                                                                                   | Next lead                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Village and Whisperwood | Protect grain, read Maren's findings, clear the approach, obtain supplies, defeat Aranya, steady the hearth    | Warmth moves through the roots again; the village can maintain its hearth                  | Bram's map follows the same channel to the shrine at Hollowmere               |
| Hollowmere              | Trace toxin in leeches, defeat Vosk, hear Ombra's actual request                                               | Shrine sluices run; clean water begins returning to the fen                                | Sunspire's clocks are drawing from the recovered channel                      |
| Sunspire                | Break armed cult patrols, disable automatons, receive Ombra's key, defeat the Chronolich                       | Stored daylight returns; the clocks move beyond their repeated hour                        | Maps identify the still-frozen Frostfire branch and Rho's warning             |
| Frostpeak               | Recover the wardens' emblems, learn Jormunis's failed guardianship, free the Frostfire                         | The thaw begins and exposes the Cinder road                                                | Rho sends news to Sorrel at the Flame's source                                |
| Cinder Wastes           | Hear Sorrel's confession, remember the dead keepers, prepare a hearth for Ignivar, break his shell and binding | Ignivar survives as an ember; the crown's drain is broken                                  | The exposed binding reveals the road to Aldric's tower                        |
| Umbral Spire            | Release Crownsworn, hear the actual court history, defeat Aldric, report his defeat                            | The crown releases renewal at the boss victory; the later report preserves the empty crown | The Archivist explains the remaining wound and living Maren's earlier journey |
| Abyss                   | Meet Maren's memory, overcome the Warden at the bottom of the Endless Seam                                     | The breach stops draining the world; its old echo paths remain                             | A return home to planting, repair, and people who kept a place for the player |

All 28 main quests and 19 side quests have revised summaries and offer/report text. The 99-dialogue
registry preserves established navigation and decision identities. All 12 NPCs have concrete,
distinct greetings and optional history. All ten regions and seven dungeons have coherent physical
descriptions; region aftermath is visible both on arrival and at the hub.

## Specific task and transaction repairs

| Earlier mismatch                                                 | Implemented behavior                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Pell claimed recovery after eight spiders, without a locket item | Woodfang Spiders can drop Pell's Locket while the collection quest needs it; Pell consumes that item on delivery              |
| Automatons supposedly dropped the Sunspire Key                   | Ombra owns and issues the key after the patrol report; source and receipt narration agree                                     |
| Bram narrated equipping the player before the descent            | Bram offers paid stock; the player chooses and purchases their own class-compatible equipment                                 |
| Letter reading sounded like an earlier handover                  | The player holds it open during reading; only the later handover removes it                                                   |
| Frost Emblems and Cinder Sigils supposedly opened floors         | The objects identify wardens and prepare a vigil; the established boss quest gates remain authoritative                       |
| Several reports narrated remote deaths beside the NPC            | Reports show local evidence and observations; post-commit beats describe the resulting transaction                            |
| “Keep the light” promised a possession with no object            | The alternate choice grants a real Wisp Lantern keepsake, clearly forgoing normal quest rewards and offering no combat effect |
| Refusing a shrine pledge mysteriously created a debt             | The player chooses one funded job: beacon or water intake; both help local people and explicitly close the other assignment   |
| The crown restored the world both at victory and later report    | Victory releases the light; the report awards an empty broken crown as evidence                                               |
| The finale closed a dungeon that remained playable               | The breach settles, leaving paths and echo trials accessible                                                                  |
| Sorrel changed pronouns; the Echo implied living Maren had died  | Sorrel consistently uses he/him; the Echo explicitly distinguishes herself from Maren, who returned home                      |

## Decision presentation

A new offer's committing screen includes the quest name, purpose, exact targets and counts, valid
sources, finisher and region, normal rewards, newly opened travel, and the collection goods that
will be surrendered. A ready report keeps the objective list and previews the precise goods leaving
the bag. An active NPC reminder and the read-only journal use the same presentation.

For example, Bram's acceptance screen names **Iron Chunk ×2**, the early Rootbound Hollow caches and
Mycelid Drones, **Blacksmith Bram — Emberdawn Village**, the later item handover, and the actual XP,
gold, and potion reward. It does not point to Boglins beyond the region this quest helps unlock. The
offer explains that better equipment becomes available for purchase.

Permanent shrine choices show the actual task, reward, and closed alternative before confirmation.
The confirmation shows only the selected transaction. Hidden responses remain hidden. Reward
previews use the existing XP-to-gold conversion at the level cap. Rendering does not accept,
complete, or reconcile quests; the existing engine remains the authority.

## Editorial scope and retained choices

Reviewed: all quest summaries; all quest/ambient dialogue lines, prompts, labels and consequences;
all NPC greetings and topics; region/dungeon descriptions and recovery copy; relevant exploration,
route and facility prose; quest items and connected materials; class picker and tutorial directions;
journal, NPC reminder, and dialogue decision output. The material descriptions now identify real
objects rather than “air branded with sorrow”.

Retained: class/skill identities and equipment mechanics, combat coefficients, encounter placement,
quest XP and gold rewards, routes, the pre-launch reset policy, and the existing story transaction
model. Fantasy imagery remains where it adds atmosphere without hiding an instruction. NPCs retain
recognizable syntax: Maren's practical warmth, Bram's workshop directness, Pell's terse
observations, Ombra's precise accounting of people, Rho's blunt responsibility, Sorrel's remorse,
and the Archivist's implication in the original order.

Dungeon rematches represent echoes of the original trial. Clearing an area does not promise the
removal of every surviving foe, a destroyed building, or all later hazards. The level curve still
has training gaps; this revision clarifies the next task and its recommended dungeon level rather
than changing the progression economy.

## Validation and save checkpoint

Version **13** is the new authoritative pre-launch checkpoint. All numbered earlier versions and
unversioned development saves are refused unchanged and directed to `/reset`. No migration, alias,
tombstone, or replacement state is introduced. The PostgreSQL schema is unchanged; JSONB continues
to store the current plain-JSON player state. Public launch has not occurred.

The new behavioral tests cover committing-screen disclosure for every quest, usable early iron
sources, physical letter and locket handovers, selected branch confirmation, a replay-safe lantern
reward, capped reward display, conditional region recovery, compact choice screens, and rejection of
every earlier numbered save version. Existing story authority, progression, reset, callback, content
integrity, and PostgreSQL tests remain part of validation.

The locket adds a 25% quest-relevant drop to Woodfang Spiders, replacing the former eight-kill side
objective with retrieval of one actual object. Its extra loot roll shifts subsequent seeded draws in
the balance harness. The reviewed snapshot changes only 24 spider/Whisperwood cells out of 111; all
affected loss and timeout rates remain zero, and mean winning-fight duration moves by at most 0.13
rounds. Combat stats, powers, and rewards are unchanged. All-class campaign completion and broad
progression-envelope gates also pass. The snapshot is deliberately refreshed for the new content
catalog, rather than changing random-number consumption in combat to preserve old samples.
