/** #141: persisted content-identity validation.
 *
 * The stateVersion gate (`assertSupportedSaveVersion`) only proves a save
 * matches the current SCHEMA SHAPE. Pre-launch, content IDs may be renamed
 * or removed without a shape change, so a same-version save can still
 * reference content that no longer exists — and rendering/mutation then
 * hits non-null assertions or silently degrades.
 *
 * This module is the ONE central boundary for that problem: a pure,
 * non-mutating check that runs after the version gate and before any
 * gameplay mutation or render. It never repairs, relocates, or substitutes:
 * an unresolved identity is reported, and the save is refused.
 *
 * The persisted identity locations covered here (the high-risk ones; extend
 * the list when a new ID-bearing field is added). This module is not an
 * exhaustive runtime schema validator — post-launch compatibility is
 * enforced by the durable-ID policy, which requires every ID that can occur
 * in supported live saves to stay resolvable:
 *
 *  - currentZone, every unlockedZones entry, and the respawn haven
 *    (must resolve to a real SAFE haven zone, #160);
 *  - inventory and equipment item ids;
 *  - learned skill ids;
 *  - quest map keys and questOutcomes entries (a resolved record's named
 *    outcome must resolve against that quest's outcomes declaration, #146,
 *    and only a resolved record may carry one at all, #150);
 *  - ID-bearing flags (`forge_i_<itemId>`, gathering zone counters and recharge times);
 *  - storyReceipts (`choice:<dlg>:<node>:<choice>` / `line:<dlg>:<node>`);
 *  - decisions (authored decision id plus the EXACT dialogue/node/choice
 *    tuple an authored recordDecision effect can produce, #150);
 *  - storyEvents (must be an event current content emits or consumes);
 *  - the scene: view id, plus identity-bearing args (item, quest, NPC,
 *    topic, dialogue, node, staged confirmation choice, equip slot);
 *  - the active battle: enemy id, origin zone/dungeon/floor, travel
 *    edge/event provenance (must match the active journey), cooldown skill
 *    ids, effect instance defIds and sources, equipment proc keys, and
 *    staged reward drops;
 *  - the active journey (#159): edge id, variant id, endpoint zones, and
 *    the snapshotted plan's enemies/items/drop tables.
 */

import { dialogue, dialogueNode, DIALOGUES } from '../content/dialogues.ts';
import { ENEMIES, enemy } from '../content/enemies.ts';
import { item } from '../content/items.ts';
import { npc, quest, QUESTS } from '../content/quests.ts';
import { skill } from '../content/skills.ts';
import { zone, ZONES } from '../content/zones.ts';
import { route } from '../content/routes.ts';
import { dropTable } from '../content/loot.ts';
import type { StoryEffect, TravelEvent } from '../content/types.ts';
import type {
  BattleState,
  EffectSource,
  JourneyState,
  PlayerState,
  SceneState,
  ViewId,
} from './types.ts';

/** One unresolved persisted identity, in a readable form for logs/tests. */
export interface SaveIdentityProblem {
  /** The persisted family carrying the unresolved identity. */
  family: string;
  /** The unresolvable id or encoded reference, verbatim. */
  id: string;
  detail: string;
}

/** Thrown when a CURRENT-schema save references content that no longer
 * resolves. Distinct from SaveTooOldError/SaveTooNewError: the schema
 * version matched, but the identities inside did not. Pre-launch, handlers
 * refuse the load and direct the player to /reset; after launch this
 * signals corruption, a broken migration, or a contract-violating release
 * and must stay observable — never silently repaired. */
export class SaveUnresolvableError extends Error {
  constructor(public readonly problems: readonly SaveIdentityProblem[]) {
    super(
      'Save references content that no longer resolves: ' +
        problems.map((prob) => `${prob.family} '${prob.id}'`).join('; '),
    );
    this.name = 'SaveUnresolvableError';
  }
}

// ── Authored identity sets (derived once from the static catalogs) ────────

/** Enemy move names double as effect source/defId identities. */
const ENEMY_MOVE_NAMES: ReadonlySet<string> = new Set(
  ENEMIES.flatMap((enemyDef) => [
    ...enemyDef.moves.map((move) => move.name),
    ...(enemyDef.special ? [enemyDef.special.move.name] : []),
    ...(enemyDef.opening ? [enemyDef.opening.name] : []),
  ]),
);

const DIALOGUE_EFFECTS: readonly StoryEffect[] = DIALOGUES.flatMap((dlg) =>
  dlg.nodes.flatMap((node) => {
    if (node.kind === 'line') return node.effects ?? [];
    if (node.kind === 'choice') return node.choices.flatMap((choice) => choice.effects ?? []);
    return [];
  })
);

/** Story-event names current content can emit (dialogue effects) or consume
 * (quest storyEvent objectives). Anything else in a save is unresolvable. */
const STORY_EVENT_NAMES: ReadonlySet<string> = new Set([
  ...QUESTS.flatMap((questDef) =>
    questDef.objectives.flatMap((
      objective,
    ) => (objective.kind === 'storyEvent' ? [objective.target] : []))
  ),
  ...DIALOGUE_EFFECTS.flatMap((effect) => (effect.kind === 'storyEvent' ? [effect.event] : [])),
]);

/** Authored decision provenance (#150): decision id -> the exact
 * `(dialogueId:nodeId:choiceId)` tuples whose authored recordDecision effect
 * can persist it. Only choice-node effects are sources: a recordDecision on
 * a line node is rejected by content integrity, so a persisted decision is
 * legitimate only when THIS exact tuple authored it — each component id
 * resolving independently is not enough. */
const DECISION_PROVENANCE: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const dlg of DIALOGUES) {
    for (const node of dlg.nodes) {
      if (node.kind !== 'choice') continue;
      for (const choice of node.choices) {
        for (const effect of choice.effects ?? []) {
          if (effect.kind !== 'recordDecision') continue;
          const tuples = map.get(effect.id) ?? new Set<string>();
          tuples.add(`${dlg.id}:${node.id}:${choice.id}`);
          map.set(effect.id, tuples);
        }
      }
    }
  }
  return map;
})();

/** Compile-time-exhaustive view set: adding a ViewId obliges an entry. */
const KNOWN_VIEWS: Record<ViewId, true> = {
  tutorial: true,
  travel: true,
  journey: true,
  zone: true,
  npc: true,
  dialogue: true,
  battle: true,
  battleSkills: true,
  battleItems: true,
  inventory: true,
  item: true,
  equipment: true,
  equippedItem: true,
  skills: true,
  quests: true,
  shop: true,
  forge: true,
  death: true,
  character: true,
  help: true,
  reset: true,
};

const EQUIP_SLOTS = new Set(['weapon', 'armor', 'trinket']);
/** The forge temper flag prefix (`forge_i_<itemId>`) — engine/forge.ts. */
const FORGE_FLAG_PREFIX = 'forge_i_';
/** Class basic actions report as skill sources under this literal id. */
const BASIC_ACTION_ID = 'basic';

/** A persisted journey's plan events are plain authored data whose
 * references are all persisted identities (#159). */
function validateTravelEvents(owner: string, events: readonly TravelEvent[], bad: Report): void {
  for (const event of events) {
    if (!Number.isFinite(event.weight) || event.weight <= 0) {
      bad(owner, String(event.weight), 'event weight must be finite and positive');
    }
    if (event.kind === 'battle') {
      const def = enemy(event.enemy);
      if (!def) bad(owner, event.enemy, 'unknown travel battle enemy');
      else if (def.boss) bad(owner, event.enemy, 'boss enemy inside a route table');
    }
    if (event.kind === 'treasure') {
      if (event.item && !item(event.item)) bad(owner, event.item, 'unknown travel treasure item');
      if (event.dropTable && !dropTable(event.dropTable)) {
        bad(owner, event.dropTable, 'unknown travel drop table');
      }
    }
  }
}

/** The persisted journey (#159): every stored identity resolves, the
 * snapshot is internally consistent, and it matches its authored route. */
function validateJourney(journey: JourneyState, bad: Report): void {
  const routeDef = route(journey.edgeId);
  if (!routeDef) {
    bad('journey.edgeId', journey.edgeId, 'unknown route id');
  } else {
    if (routeDef.from !== journey.fromZone || routeDef.to !== journey.toZone) {
      bad('journey.endpoints', journey.edgeId, 'journey endpoints do not match the route');
    }
    if (
      journey.variantId !== 'base' &&
      !(routeDef.variants ?? []).some((variant) => variant.id === journey.variantId)
    ) {
      bad('journey.variantId', journey.variantId, 'unknown route variant id');
    }
  }
  if (!zone(journey.fromZone)) bad('journey.fromZone', journey.fromZone, 'unknown zone id');
  if (!zone(journey.toZone)) bad('journey.toZone', journey.toZone, 'unknown zone id');
  if (
    !Number.isInteger(journey.totalEvents) || journey.totalEvents <= 0 ||
    !Number.isInteger(journey.completedEvents) || journey.completedEvents < 0 ||
    journey.completedEvents > journey.totalEvents
  ) {
    bad(
      'journey.progress',
      `${journey.completedEvents}/${journey.totalEvents}`,
      'inconsistent journey progress',
    );
  }
  if (journey.plan.length === 0) {
    bad('journey.plan', journey.edgeId, 'a crossing carries no event table');
  }
  validateTravelEvents('journey.plan', journey.plan, bad);
}

type Report = (family: string, id: string, detail: string) => void;

/** Ids that legitimately appear as effect identities without being a single
 * catalog id: the basic-action literal, the derived 'sap' stacking identity
 * (effectDefId), skills, items, enemy move names and enemy ids. */
function effectIdentityResolvable(id: string): boolean {
  return id === BASIC_ACTION_ID || id === 'sap' || !!skill(id) || !!item(id) ||
    ENEMY_MOVE_NAMES.has(id) || !!enemy(id);
}

function validateEffectSource(source: EffectSource, bad: Report): void {
  switch (source.kind) {
    case 'skill':
      if (source.id !== BASIC_ACTION_ID && !skill(source.id)) {
        bad('battle.effectSources', source.id, 'unknown skill id');
      }
      return;
    case 'item':
      if (!item(source.id)) bad('battle.effectSources', source.id, 'unknown item id');
      return;
    case 'enemyMove':
      // Regular enemy moves report the move NAME; enemy openings report the
      // enemy id — both are authored identities.
      if (!ENEMY_MOVE_NAMES.has(source.id) && !enemy(source.id)) {
        bad('battle.effectSources', source.id, 'unknown enemy move or enemy id');
      }
      return;
    case 'encounter':
      if (!enemy(source.id)) bad('battle.effectSources', source.id, 'unknown enemy id');
      return;
  }
}

function validateBattle(battle: BattleState, bad: Report, journey?: JourneyState): void {
  if (!enemy(battle.enemy.id)) bad('battle.enemy', battle.enemy.id, 'unknown enemy id');
  const origin = battle.origin;
  if (origin.kind === 'explore' || origin.kind === 'elite') {
    if (!zone(origin.zoneId)) bad('battle.origin', origin.zoneId, 'unknown origin zone');
  } else if (origin.kind === 'travel') {
    // Travel provenance (#159): the edge resolves, the player IS on that
    // crossing, and the event index stands in the exact relation the
    // coordinator produces FOR THIS BATTLE'S PHASE (#167). A travel battle
    // without its matching journey is a corrupt combination — refused,
    // never guessed back into shape.
    const routeDef = route(origin.edgeId);
    if (!routeDef) {
      bad('battle.origin', origin.edgeId, 'unknown travel edge');
    } else if (routeDef.from !== origin.zoneId) {
      bad('battle.origin', origin.zoneId, 'travel origin is not the edge origin');
    }
    if (!journey) {
      bad('battle.origin', origin.edgeId, 'travel battle without an active journey');
    } else {
      if (journey.edgeId !== origin.edgeId) {
        bad('battle.origin', origin.edgeId, 'battle edge does not match the journey');
      }
      // Phase-aware progress relation (#167): an ACTIVELY FIGHTING (or
      // lost-but-unresolved) travel battle owns the PENDING roll — its
      // eventIndex IS the journey's completedEvents, because a battle
      // event consumes its roll only at its victory. A WON battle's roll
      // is already complete (eventIndex === completedEvents − 1). The
      // relation a save claims must match the phase it claims: a save
      // that marks the event complete while the fight is still live (or
      // vice versa) is a combination the coordinator cannot produce.
      const ownsPendingRoll = origin.eventIndex === journey.completedEvents;
      const rollAlreadyCompleted = origin.eventIndex === journey.completedEvents - 1;
      const relation = battle.phase === 'won'
        ? rollAlreadyCompleted
        : battle.phase === 'fled'
        ? false // flee clears the battle AND the crossing in one handler step
        : ownsPendingRoll; // 'active' and 'lost' both keep the roll pending
      if (
        !Number.isInteger(origin.eventIndex) || origin.eventIndex < 0 ||
        origin.eventIndex >= journey.totalEvents ||
        !relation
      ) {
        bad(
          'battle.origin',
          String(origin.eventIndex),
          `travel event index does not match the journey progress (${battle.phase} battle)`,
        );
      }
    }
  } else {
    const zoneDef = zone(origin.zoneId);
    if (!zoneDef) {
      bad('battle.origin', origin.zoneId, 'unknown origin zone');
    } else if (zoneDef.dungeon?.id !== origin.dungeonId) {
      bad('battle.origin', origin.dungeonId, 'unknown dungeon for origin zone');
    } else if (
      !Number.isInteger(origin.floor) || origin.floor < 1 ||
      origin.floor > zoneDef.dungeon.floors.length + 1
    ) {
      // Floors are 1-based; floors.length + 1 is the boss floor (world.ts).
      bad('battle.origin', String(origin.floor), 'floor outside the dungeon');
    } else {
      const dungeon = zoneDef.dungeon;
      const bossFloor = origin.floor === dungeon.floors.length + 1;
      if (origin.boss !== bossFloor || battle.enemy.isBoss !== bossFloor) {
        bad(
          'battle.origin',
          String(origin.floor),
          'boss classification does not match authored floor',
        );
      }
      const room = dungeon.floors[origin.floor - 1];
      if (!bossFloor && room.discovery) {
        bad('battle.origin', String(origin.floor), 'discovery floor cannot contain a battle');
      } else if (
        bossFloor ? battle.enemy.id !== dungeon.boss : !room.enemies.includes(battle.enemy.id)
      ) {
        bad('battle.enemy', battle.enemy.id, 'enemy does not belong to the authored dungeon floor');
      }
    }
  }
  for (const id of Object.keys(battle.cooldowns)) {
    if (id !== BASIC_ACTION_ID && !skill(id)) bad('battle.cooldowns', id, 'unknown skill id');
  }
  for (const inst of battle.effectInstances) {
    validateEffectSource(inst.source, bad);
    const defId = inst.defId;
    if (defId.startsWith('opening:')) {
      if (!enemy(defId.slice('opening:'.length))) {
        bad('battle.effectInstances', defId, 'unknown opening enemy id');
      }
    } else if (!effectIdentityResolvable(defId.split(':')[0])) {
      bad('battle.effectInstances', defId, 'unknown effect identity');
    }
  }
  for (const key of Object.keys(battle.procs ?? {})) {
    // Proc keys are `${itemId}:${triggerIndex}` (engine/types.ts).
    if (!item(key.split(':')[0])) bad('battle.procs', key, 'unknown item id');
  }
  for (const drop of battle.rewards?.drops ?? []) {
    if (!item(drop)) bad('battle.rewards', drop, 'unknown drop item id');
  }
  for (const drop of battle.rewards?.contextual ?? []) {
    if (!item(drop.item)) bad('battle.rewards.contextual', drop.item, 'unknown contextual item id');
  }
}

function validateReceipt(receipt: string, bad: Report): void {
  const parts = receipt.split(':');
  if (parts[0] === 'choice' && parts.length === 4) {
    const [, dlgId, nodeId, choiceId] = parts;
    const dlg = dialogue(dlgId);
    if (!dlg) return bad('storyReceipts', receipt, 'unknown dialogue id');
    const node = dialogueNode(dlg, nodeId);
    if (!node) return bad('storyReceipts', receipt, 'unknown dialogue node');
    if (node.kind !== 'choice' || !node.choices.some((choice) => choice.id === choiceId)) {
      bad('storyReceipts', receipt, 'unknown choice id');
    }
    return;
  }
  if (parts[0] === 'line' && parts.length === 3) {
    const [, dlgId, nodeId] = parts;
    const dlg = dialogue(dlgId);
    if (!dlg) return bad('storyReceipts', receipt, 'unknown dialogue id');
    if (!dialogueNode(dlg, nodeId)) bad('storyReceipts', receipt, 'unknown dialogue node');
    return;
  }
  bad('storyReceipts', receipt, 'unknown receipt format');
}

function validateScene(scene: SceneState, bad: Report): void {
  if (!(scene.view in KNOWN_VIEWS)) {
    bad('scene.view', scene.view, 'unknown view id');
    return; // arg meaning is unknowable without a known view
  }
  const arg = scene.arg ?? '';
  switch (scene.view) {
    case 'item':
      // arg is the item id whose detail is shown (#112).
      if (!item(arg)) bad('scene.arg', arg, 'unknown item id');
      return;
    case 'shop':
      // #187: arg2 selects an item only in buying mode; sell-mode arg2
      // remains pagination. Availability is rechecked by the shop itself.
      if (arg !== 'sell' && scene.arg2 !== undefined && !item(scene.arg2)) {
        bad('scene.arg2', scene.arg2, 'unknown shop item id');
      }
      return;
    case 'quests':
      // arg (when set) selects a quest detail.
      if (arg && !quest(arg)) bad('scene.arg', arg, 'unknown quest id');
      return;
    case 'npc': {
      const npcDef = npc(arg);
      if (!npcDef) return bad('scene.arg', arg, 'unknown NPC id');
      const sub = scene.arg2 ?? '';
      if (sub.startsWith('lore:')) {
        const topicId = sub.slice('lore:'.length);
        if (!(npcDef.topics ?? []).some((topic) => topic.id === topicId)) {
          bad('scene.arg2', sub, 'unknown NPC topic id');
        }
      } else if (sub.startsWith('q:')) {
        if (!quest(sub.slice(2))) bad('scene.arg2', sub, 'unknown quest id');
      }
      return;
    }
    case 'dialogue': {
      const dlg = dialogue(arg);
      if (!dlg) return bad('scene.arg', arg, 'unknown dialogue id');
      const node = dialogueNode(dlg, scene.arg2 ?? '');
      if (!node) return bad('scene.arg2', scene.arg2 ?? '', 'unknown dialogue node');
      const staged = scene.arg3 ?? '';
      if (staged.startsWith('confirm:')) {
        const choiceId = staged.slice('confirm:'.length);
        if (node.kind !== 'choice' || !node.choices.some((choice) => choice.id === choiceId)) {
          bad('scene.arg3', staged, 'unknown staged confirmation choice');
        }
      }
      return;
    }
    case 'equippedItem':
      if (!EQUIP_SLOTS.has(arg)) bad('scene.arg', arg, 'unknown equip slot');
      return;
    default:
      return; // remaining views carry no content identity in their args
  }
}

/** Pure, non-mutating persisted-identity check (#141): returns every
 * unresolved content identity it finds among the locations listed in the
 * module doc. An empty result means those identities all resolve against the
 * CURRENT content catalog. Never repairs, relocates, or substitutes —
 * detection only. */
export function findUnresolvedPersistedIds(player: PlayerState): SaveIdentityProblem[] {
  const problems: SaveIdentityProblem[] = [];
  const bad: Report = (family, id, detail) => problems.push({ family, id, detail });

  if (!zone(player.currentZone)) bad('currentZone', player.currentZone, 'unknown zone id');
  // The respawn haven (#160) must be a real zone that IS a safe haven: a
  // corrupt pointer must never silently relocate a death to a warzone or
  // a deleted settlement.
  const haven = zone(player.respawnHaven);
  if (!haven) bad('respawnHaven', player.respawnHaven, 'unknown zone id');
  else if (!haven.safeHaven) bad('respawnHaven', player.respawnHaven, 'not a safe-haven zone');
  for (const zoneId of player.unlockedZones) {
    if (!zone(zoneId)) bad('unlockedZones', zoneId, 'unknown zone id');
  }
  for (const entry of player.inventory) {
    if (!item(entry.id)) bad('inventory', entry.id, 'unknown item id');
  }
  for (const [slot, id] of Object.entries(player.equipment)) {
    if (id && !item(id)) bad('equipment', id, `unknown item id in slot ${slot}`);
  }
  for (const id of player.skills) {
    if (!skill(id)) bad('skills', id, 'unknown skill id');
  }
  for (const id of Object.keys(player.quests)) {
    if (!quest(id)) bad('quests', id, 'unknown quest id');
  }
  for (const [id, outcomeRecord] of Object.entries(player.questOutcomes)) {
    if (!quest(id)) {
      bad('questOutcomes', id, 'unknown quest id');
      continue;
    }
    if (outcomeRecord.kind === 'resolved') {
      // A named resolved outcome (#132) is declared content identity: a saved
      // value the quest does not declare — a typo, an undeclared quest, or a
      // cross-quest value — is recognizable by no authored condition. It is
      // reported, never repaired or substituted (#146).
      if (!quest(id)!.outcomes?.includes(outcomeRecord.outcome)) {
        bad(
          'questOutcomes',
          outcomeRecord.outcome,
          `${id} does not declare resolved outcome "${outcomeRecord.outcome}"`,
        );
      }
    } else if ((outcomeRecord as { outcome?: unknown }).outcome !== undefined) {
      // `outcome` is a resolved-only field (#150): a failed/locked record
      // carrying one is a malformed combination the runtime can never have
      // produced — and an outcome condition would otherwise match it as
      // though the resolution had happened. Refused, never repaired.
      bad('questOutcomes', id, `${id} carries a named outcome on a ${outcomeRecord.kind} record`);
    }
  }
  for (const key of Object.keys(player.flags)) {
    if (key.startsWith('dgn_')) {
      const known = ZONES.some((zoneDef) =>
        zoneDef.dungeon &&
        (key === `dgn_${zoneDef.dungeon.id}_boss` ||
          zoneDef.dungeon.floors.some((_, index) =>
            key === `dgn_${zoneDef.dungeon!.id}_cache_${index + 1}`
          ))
      );
      if (!known) bad('flags', key, 'unknown dungeon reward identity');
    }
    for (const prefix of ['gather_', 'gatherReset_']) {
      if (key.startsWith(prefix) && !zone(key.slice(prefix.length))) {
        bad('flags', key, 'unknown gathering zone id');
      }
    }
    if (key.startsWith(FORGE_FLAG_PREFIX) && !item(key.slice(FORGE_FLAG_PREFIX.length))) {
      bad('flags', key, 'unknown forged item id');
    }
  }
  for (const receipt of player.storyReceipts) validateReceipt(receipt, bad);
  for (const [id, decision] of Object.entries(player.decisions)) {
    // Provenance, not component resolvability (#150): the decision id must
    // be authored, and the exact (dialogue, node, choice) tuple it persisted
    // must be the one whose recordDecision effect can produce it. Mixing a
    // valid decision id with an unrelated valid dialogue choice is refused
    // — every component can resolve while the combination is impossible.
    const authored = DECISION_PROVENANCE.get(id);
    if (!authored) {
      bad('decisions', id, 'unknown decision id');
      continue;
    }
    if (!authored.has(`${decision.dialogueId}:${decision.nodeId}:${decision.choiceId}`)) {
      bad(
        'decisions',
        id,
        `no authored recordDecision matches ${decision.dialogueId}:${decision.nodeId}:${decision.choiceId}`,
      );
    }
  }
  for (const event of player.storyEvents) {
    if (!STORY_EVENT_NAMES.has(event)) bad('storyEvents', event, 'unknown story event');
  }
  validateScene(player.scene, bad);
  // The journey and its battle are validated TOGETHER (#159), and the
  // combination is checked against the player's live location (#167):
  // until the coordinator's final arrival, the player IS still at the
  // edge origin — a save claiming any other currentZone while a crossing
  // is live is a combination the runtime can never produce.
  if (player.journey && player.battle && player.battle.origin.kind !== 'travel') {
    bad('journey', player.journey.edgeId, 'active journey paired with a non-travel battle');
  }
  if (player.journey) {
    validateJourney(player.journey, bad);
    if (player.currentZone !== player.journey.fromZone) {
      bad(
        'currentZone',
        player.currentZone,
        `not the live crossing origin (${player.journey.fromZone}) — send /reset to start fresh`,
      );
    }
  }
  if (player.dungeonRun) {
    const run = player.dungeonRun;
    const dungeon = zone(run.zoneId)?.dungeon;
    if (!dungeon || dungeon.id !== run.dungeonId) {
      bad('dungeonRun', run.dungeonId, 'unknown dungeon for run zone');
    }
    if (player.currentZone !== run.zoneId) {
      bad('dungeonRun', run.zoneId, 'run is outside current zone');
    }
    if (player.journey) bad('dungeonRun', run.dungeonId, 'run cannot coexist with a journey');
    if (
      !Number.isInteger(run.nextFloor) || run.nextFloor < 1 ||
      (dungeon && run.nextFloor > dungeon.floors.length + 1)
    ) {
      bad('dungeonRun.nextFloor', String(run.nextFloor), 'floor outside the dungeon');
    }
    if (player.battle) {
      const battle = player.battle;
      const origin = battle.origin;
      if (
        origin.kind !== 'dungeon' || origin.zoneId !== run.zoneId ||
        origin.dungeonId !== run.dungeonId ||
        (battle.phase === 'won'
          ? origin.boss || origin.floor + 1 !== run.nextFloor
          : battle.phase !== 'active' || origin.floor !== run.nextFloor)
      ) {
        bad('dungeonRun', run.dungeonId, 'battle does not match run progress');
      }
    }
  } else if (
    player.battle?.origin.kind === 'dungeon' &&
    (player.battle.phase === 'active' ||
      (player.battle.phase === 'won' && !player.battle.origin.boss))
  ) {
    bad(
      'battle.origin',
      player.battle.origin.dungeonId,
      'unfinished dungeon battle sequence without a run',
    );
  }
  if (player.battle) validateBattle(player.battle, bad, player.journey);
  return problems;
}

/** Assert form of findUnresolvedPersistedIds: throws SaveUnresolvableError
 * listing every unresolved identity. Runs AFTER assertSupportedSaveVersion —
 * the version gate proves the schema, this proves the identities inside. */
export function assertResolvablePersistedIds(player: PlayerState): void {
  const problems = findUnresolvedPersistedIds(player);
  if (problems.length > 0) throw new SaveUnresolvableError(problems);
}
