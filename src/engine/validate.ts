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
 *  - currentZone and every unlockedZones entry;
 *  - inventory and equipment item ids;
 *  - learned skill ids;
 *  - quest map keys and questOutcomes entries (a resolved record's named
 *    outcome must resolve against that quest's outcomes declaration, #146);
 *  - ID-bearing flags (`forge_i_<itemId>`);
 *  - storyReceipts (`choice:<dlg>:<node>:<choice>` / `line:<dlg>:<node>`);
 *  - decisions (authored decision id + dialogue/node/choice provenance);
 *  - storyEvents (must be an event current content emits or consumes);
 *  - the scene: view id, plus identity-bearing args (item, quest, NPC,
 *    topic, dialogue, node, staged confirmation choice, equip slot);
 *  - the active battle: enemy id, origin zone/dungeon/floor, cooldown skill
 *    ids, effect instance defIds and sources, equipment proc keys, and
 *    staged reward drops.
 */

import { dialogue, dialogueNode, DIALOGUES } from '../content/dialogues.ts';
import { ENEMIES, enemy } from '../content/enemies.ts';
import { item } from '../content/items.ts';
import { npc, quest, QUESTS } from '../content/quests.ts';
import { skill } from '../content/skills.ts';
import { zone } from '../content/zones.ts';
import type { StoryEffect } from '../content/types.ts';
import type { BattleState, EffectSource, PlayerState, SceneState, ViewId } from './types.ts';

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
        problems.map((p) => `${p.family} '${p.id}'`).join('; '),
    );
    this.name = 'SaveUnresolvableError';
  }
}

// ── Authored identity sets (derived once from the static catalogs) ────────

/** Enemy move names double as effect source/defId identities. */
const ENEMY_MOVE_NAMES: ReadonlySet<string> = new Set(
  ENEMIES.flatMap((e) => [
    ...e.moves.map((m) => m.name),
    ...(e.special ? [e.special.move.name] : []),
    ...(e.opening ? [e.opening.name] : []),
  ]),
);

const DIALOGUE_EFFECTS: readonly StoryEffect[] = DIALOGUES.flatMap((d) =>
  d.nodes.flatMap((n) => {
    if (n.kind === 'line') return n.effects ?? [];
    if (n.kind === 'choice') return n.choices.flatMap((c) => c.effects ?? []);
    return [];
  })
);

/** Story-event names current content can emit (dialogue effects) or consume
 * (quest storyEvent objectives). Anything else in a save is unresolvable. */
const STORY_EVENT_NAMES: ReadonlySet<string> = new Set([
  ...QUESTS.flatMap((q) =>
    q.objectives.flatMap((o) => (o.kind === 'storyEvent' ? [o.target] : []))
  ),
  ...DIALOGUE_EFFECTS.flatMap((e) => (e.kind === 'storyEvent' ? [e.event] : [])),
]);

/** Authored decision ids (recordDecision effects in dialogue content). */
const DECISION_IDS: ReadonlySet<string> = new Set(
  DIALOGUE_EFFECTS.flatMap((e) => (e.kind === 'recordDecision' ? [e.id] : [])),
);

/** Compile-time-exhaustive view set: adding a ViewId obliges an entry. */
const KNOWN_VIEWS: Record<ViewId, true> = {
  tutorial: true,
  travel: true,
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

function validateBattle(b: BattleState, bad: Report): void {
  if (!enemy(b.enemy.id)) bad('battle.enemy', b.enemy.id, 'unknown enemy id');
  const origin = b.origin;
  if (origin.kind === 'explore' || origin.kind === 'elite') {
    if (!zone(origin.zoneId)) bad('battle.origin', origin.zoneId, 'unknown origin zone');
  } else {
    const z = zone(origin.zoneId);
    if (!z) {
      bad('battle.origin', origin.zoneId, 'unknown origin zone');
    } else if (z.dungeon?.id !== origin.dungeonId) {
      bad('battle.origin', origin.dungeonId, 'unknown dungeon for origin zone');
    } else if (
      !Number.isInteger(origin.floor) || origin.floor < 1 ||
      origin.floor > z.dungeon.floors.length + 1
    ) {
      // Floors are 1-based; floors.length + 1 is the boss floor (world.ts).
      bad('battle.origin', String(origin.floor), 'floor outside the dungeon');
    }
  }
  for (const id of Object.keys(b.cooldowns)) {
    if (id !== BASIC_ACTION_ID && !skill(id)) bad('battle.cooldowns', id, 'unknown skill id');
  }
  for (const inst of b.effectInstances) {
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
  for (const key of Object.keys(b.procs ?? {})) {
    // Proc keys are `${itemId}:${triggerIndex}` (engine/types.ts).
    if (!item(key.split(':')[0])) bad('battle.procs', key, 'unknown item id');
  }
  for (const drop of b.rewards?.drops ?? []) {
    if (!item(drop)) bad('battle.rewards', drop, 'unknown drop item id');
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
    if (node.kind !== 'choice' || !node.choices.some((c) => c.id === choiceId)) {
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
    case 'quests':
      // arg (when set) selects a quest detail.
      if (arg && !quest(arg)) bad('scene.arg', arg, 'unknown quest id');
      return;
    case 'npc': {
      const def = npc(arg);
      if (!def) return bad('scene.arg', arg, 'unknown NPC id');
      const sub = scene.arg2 ?? '';
      if (sub.startsWith('lore:')) {
        const topicId = sub.slice('lore:'.length);
        if (!(def.topics ?? []).some((t) => t.id === topicId)) {
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
        if (node.kind !== 'choice' || !node.choices.some((c) => c.id === choiceId)) {
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
export function findUnresolvedPersistedIds(p: PlayerState): SaveIdentityProblem[] {
  const problems: SaveIdentityProblem[] = [];
  const bad: Report = (family, id, detail) => problems.push({ family, id, detail });

  if (!zone(p.currentZone)) bad('currentZone', p.currentZone, 'unknown zone id');
  for (const z of p.unlockedZones) {
    if (!zone(z)) bad('unlockedZones', z, 'unknown zone id');
  }
  for (const entry of p.inventory) {
    if (!item(entry.id)) bad('inventory', entry.id, 'unknown item id');
  }
  for (const [slot, id] of Object.entries(p.equipment)) {
    if (id && !item(id)) bad('equipment', id, `unknown item id in slot ${slot}`);
  }
  for (const id of p.skills) {
    if (!skill(id)) bad('skills', id, 'unknown skill id');
  }
  for (const id of Object.keys(p.quests)) {
    if (!quest(id)) bad('quests', id, 'unknown quest id');
  }
  for (const [id, o] of Object.entries(p.questOutcomes)) {
    if (!quest(id)) {
      bad('questOutcomes', id, 'unknown quest id');
      continue;
    }
    // A named resolved outcome (#132) is declared content identity: a saved
    // value the quest does not declare — a typo, an undeclared quest, or a
    // cross-quest value — is recognizable by no authored condition. It is
    // reported, never repaired or substituted (#146).
    if (
      o.kind === 'resolved' &&
      (o.outcome === undefined || !quest(id)!.outcomes?.includes(o.outcome))
    ) {
      bad(
        'questOutcomes',
        o.outcome ?? id,
        `${id} does not declare resolved outcome "${o.outcome ?? ''}"`,
      );
    }
  }
  for (const key of Object.keys(p.flags)) {
    if (key.startsWith(FORGE_FLAG_PREFIX) && !item(key.slice(FORGE_FLAG_PREFIX.length))) {
      bad('flags', key, 'unknown forged item id');
    }
  }
  for (const receipt of p.storyReceipts) validateReceipt(receipt, bad);
  for (const [id, d] of Object.entries(p.decisions)) {
    if (!DECISION_IDS.has(id)) bad('decisions', id, 'unknown decision id');
    const dlg = dialogue(d.dialogueId);
    if (!dlg) {
      bad('decisions', d.dialogueId, 'unknown dialogue id');
      continue;
    }
    const node = dialogueNode(dlg, d.nodeId);
    if (!node) {
      bad('decisions', d.nodeId, 'unknown dialogue node');
      continue;
    }
    if (node.kind !== 'choice' || !node.choices.some((c) => c.id === d.choiceId)) {
      bad('decisions', d.choiceId, 'unknown choice id');
    }
  }
  for (const event of p.storyEvents) {
    if (!STORY_EVENT_NAMES.has(event)) bad('storyEvents', event, 'unknown story event');
  }
  validateScene(p.scene, bad);
  if (p.battle) validateBattle(p.battle, bad);
  return problems;
}

/** Assert form of findUnresolvedPersistedIds: throws SaveUnresolvableError
 * listing every unresolved identity. Runs AFTER assertSupportedSaveVersion —
 * the version gate proves the schema, this proves the identities inside. */
export function assertResolvablePersistedIds(p: PlayerState): void {
  const problems = findUnresolvedPersistedIds(p);
  if (problems.length > 0) throw new SaveUnresolvableError(problems);
}
