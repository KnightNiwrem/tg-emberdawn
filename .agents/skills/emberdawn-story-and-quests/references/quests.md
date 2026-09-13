# Quest lifecycle and contacts

Implementation: `src/engine/quests.ts`, `src/content/quests.ts`, and
`src/content/quest_dialogues.ts`. Changes to named outcomes, conditions, or bundled lifecycle
effects also use [story transactions](transactions.md).

## Quest state machine

- States: unavailable → available → active → turnIn → done. `syncAvailability` is idempotent; call
  it after xp gains, zone entry, and turn-ins.
- Objectives tick through engine hooks: `onKill`, `onZoneEnter`, `onDungeonClear`; collect
  objectives read the bag live. Conversation progression uses explicit story events; see the
  [NPC conversation contract](npc-topics.md#npc-topic-menus).
- Every hook returns the quests its event just made turn-in-ready. `refreshProgress()` is the single
  active→turnIn transition authority: readiness is announced exactly once, by the surface that
  caused it. `resolveVictory` collects ready ids from drops, the kill, the availability refresh,
  dungeon bookkeeping, and first-clear rewards, and appends one deduped `questReadyLine`
  (`📜 “<name>” is ready to turn in!` — the one shared formatter) per quest after all of the
  victory's mutations. `arriveAt()` puts it in the arrival lines; the dialogue interaction puts it
  in the interaction notices. It is never re-derived at render time and never re-announced for an
  already-`turnIn` quest.
- Random quest-kind item drops are relevance-capped (`questDropAllowed`) to the largest matching
  collect requirement among available, active, or turnIn quests. They stop when the bag reaches that
  cap or no open quest needs the item. Completing one quest does not block drops another open quest
  needs; materials and consumables are not capped.

## Quest lifecycle contacts and physical authority

- Every quest carries explicit lifecycle contacts: `startNpc` offers it and `finishNpc` accepts the
  turn-in. Usually the same NPC, but delivery flows hand quests between people (m2_letter: Maren
  starts, Bram finishes). The finisher is never inferred from a talk objective.
- `acceptQuest`/`turnInQuest` take the acting NPC id and require it to be the quest's configured
  starter/finisher AND standing in the player's current zone (`contactRefusal` inside the engine).
  Quest status alone never authorizes, and no handler path can bypass this.
- Both contacts must resolve to real NPCs placed in exactly one zone, and those zones must be
  reachable at the quest's point in the progression (content-integrity tested). Resolve contacts
  through the canonical helpers in `src/content/quests.ts` (`questStarter`/`questFinisher`/
  `zoneOfNpc`/`npcInZone`). There is no quest-log-only fallback: m23_aldric starts and ends with the
  Archivist's throne-room send-off, and sq_locket belongs to Ranger Pell in the Whisperwood.
- Destination quests start in the preceding region and finish with the destination contact, so the
  journey stays the point instead of an arrive-then-accept loop: m5 Bram→Ferryman, m9
  Ferryman→Ombra, m13 Ombra→Rho, m16 Rho→Sorrel, m20 Sorrel→Archivist, m24 Archivist→Echo.
  Intro/outro text speaks as the contact who hands the quest over or receives it.
- Every quest start shares one objective-reconciliation policy: `beginQuest` in
  `src/engine/quests.ts`, the same core `acceptQuest` uses (ever-visited reach targets reconcile
  identically). `startQuest` honors the on-site starter authority: a dialogue can only start a quest
  whose own contact is standing right there, and readiness/rewards reuse the same central
  authorities as every other path.

## Quest log

The quest log is a read-only journal: it renders no lifecycle buttons, the codec cannot even express
`q:a:`/`q:t:`, and it only names the physical contact ("Start with X — Zone." / "Return to Y —
Zone."). Log navigation can never act on a quest.
