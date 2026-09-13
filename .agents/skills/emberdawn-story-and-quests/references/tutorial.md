# Tutorial and prologue

Authoritative code and tests: `src/engine/tutorial.ts`, `src/handlers/tutorial.ts`,
`src/engine/types.ts`, `tests/tutorial_test.ts`.

For changes to shared combat behavior, load `emberdawn-combat`. For changes to the quests offered
after release into the hub, read [Quest lifecycle and contacts](quests.md). For changes to authored
coaching or release prose, load `emberdawn-narrative-writing`.

## Guided prologue

Fresh heroes run a directed prologue before the real hub opens: Elder Maren's ember brief → one
controlled battle vs `e_cinder_mite` (a `tutorial`-flagged level-1 fixture) → the ember reward →
release into the real hub. The engine enforces basic action → skill → Guard → item lesson beats in
order and prevents victory until they are complete. A scripted nonlethal hit after Guard makes the
item lesson reachable. Coaching explains the current beat inside the live battle;
`tests/tutorial_test.ts` checks the flow across classes. The balance harness checks sampled fights
under its configured policy, not every possible action sequence. The reward tops up heroes to at
least level 2 and replaces the lesson's potion. Release guidance points to Maren's Sparks of Trouble
quest, the Outskirts, and later Whisperwood travel, with level, flee, road-event, and safe-haven
advice.

- State is `player.tutorial` (`'maren' → 'outskirts' → 'fight' → 'done'`). `/start` resumes the
  current step, tutorial handlers revalidate the step so replays are refused, the uiRev guard kills
  double-taps, and the reward is flag-idempotent.
- During the prologue the zone view renders only the directed action (progressive disclosure —
  travel, explore, shop, and the NPC list are withheld).
