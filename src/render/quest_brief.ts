/** Quest decisions disclose their work and transaction from live content (#190). */
import type { InputRichBlock } from 'grammy/types';
import type { DialogueChoice, Objective, QuestDef } from '../content/types.ts';
import type { PlayerState } from '../engine/types.ts';
import { DIALOGUES } from '../content/dialogues.ts';
import { ENEMIES, enemy } from '../content/enemies.ts';
import { GATHERING_SITES } from '../content/gathering.ts';
import { itemName } from '../content/items.ts';
import { npc, quest, questFinisher, QUESTS, zoneOfNpc } from '../content/quests.ts';
import { zone, ZONES } from '../content/zones.ts';
import { xpRewardLabel } from '../engine/character.ts';
import { countOf } from '../engine/inventory.ts';
import { collectRequirements } from '../engine/quests.ts';
import { details, heading, list, para } from './rich.ts';

interface ObjectiveSource {
  emoji: string;
  text: string;
}

function enemyPlaces(id: string): ObjectiveSource[] {
  const field = ZONES.filter((zoneDef) =>
    zoneDef.explore.some((encounter) =>
      (encounter.kind === 'battle' || encounter.kind === 'elite') && encounter.enemy === id
    )
  ).map((zoneDef) => ({
    emoji: zoneDef.safeHaven ? '🌾' : '🧭',
    text: `${zoneDef.name} (${zoneDef.safeHaven ? 'Forage' : 'Explore'})`,
  }));
  const dungeons = ZONES.filter((zoneDef) =>
    zoneDef.dungeon?.boss === id ||
    zoneDef.dungeon?.floors.some((floor) => floor.enemies.includes(id))
  ).map((zoneDef) => {
    const dungeon = zoneDef.dungeon!;
    const key = dungeon.boss === id ? dungeon.bossGate?.item : undefined;
    return {
      emoji: dungeon.emoji,
      text: `${dungeon.name} — ${zoneDef.name}${
        dungeon.boss === id ? ` (boss; recommended Lv ${dungeon.recommendedLevel})` : ' (Dungeon)'
      }${key ? `; bring ${itemName(key)}, consumed on the first boss victory` : ''}`,
    };
  });
  return [...field, ...dungeons];
}

/** Keep each activity's identity with its directions until the final line formatting. */
function objectiveSources(questDef: QuestDef, objective: Objective): ObjectiveSource[] {
  if (objective.kind === 'kill') return enemyPlaces(objective.target);
  if (objective.kind === 'dungeon') {
    const zoneDef = ZONES.find((zoneDef) => zoneDef.dungeon?.id === objective.target);
    return zoneDef
      ? [{
        emoji: zoneDef.dungeon!.emoji,
        text: `${zoneDef.name} (Dungeon; recommended Lv ${zoneDef.dungeon!.recommendedLevel})`,
      }]
      : [];
  }
  if (objective.kind === 'reach') {
    return [{
      emoji: '🚶',
      text: 'Travel along the roads to this region, then meet the contact below.',
    }];
  }
  if (objective.kind === 'storyEvent') {
    const matchedDialogue = DIALOGUES.find((dlg) =>
      [questDef.startNpc, questDef.finishNpc].includes(dlg.npcId) &&
      dlg.nodes.some((node) =>
        (node.kind === 'line'
          ? node.effects ?? []
          : node.kind === 'choice'
          ? node.choices.flatMap((choice) => choice.effects ?? [])
          : []).some((effect) => effect.kind === 'storyEvent' && effect.event === objective.target)
      )
    );
    if (!matchedDialogue) return [];
    if (matchedDialogue.id === questDef.offerDialogue) {
      return [{ emoji: '🗣️', text: 'Recorded when you accept this conversation.' }];
    }
    const topic = npc(matchedDialogue.npcId)?.topics?.find((topicDef) =>
      topicDef.dialogue === matchedDialogue.id
    );
    return [{
      emoji: '🗣️',
      text: `${npc(matchedDialogue.npcId)!.name} — ${zoneOfNpc(matchedDialogue.npcId)!.name}: ${
        topic?.label ?? questDef.name
      }.`,
    }];
  }
  const sources: ObjectiveSource[] = [];
  for (const zoneDef of ZONES) {
    if (zoneDef.dungeon?.floors.some((floor) => floor.treasure?.item === objective.target)) {
      sources.push({
        emoji: zoneDef.dungeon.emoji,
        text: `First-visit caches in ${zoneDef.dungeon.name} — ${zoneDef.name}`,
      });
    }
  }
  const drops = ENEMIES.filter((enemyDef) => (enemyDef.drops?.[objective.target] ?? 0) > 0);
  // A later field enemy must not displace an earlier dungeon source:
  // Mycelids supply Bram's iron before Hollowmere's Boglins are reachable.
  const source =
    drops.toSorted((leftEnemyDef, rightEnemyDef) => leftEnemyDef.level - rightEnemyDef.level)[0];
  if (source) {
    const place = enemyPlaces(source.id)[0];
    if (place) {
      sources.push({
        emoji: place.emoji,
        text: `Drops from ${source.name} — ${place.text} (may take several fights)`,
      });
    }
  }
  // Prefer repeatable drops and early caches over later quest rewards that
  // may themselves require completing this quest (e.g. Bram's iron order).
  if (sources.length === 0) {
    for (const reward of QUESTS) {
      if (reward.rewards.items?.[objective.target]) {
        sources.push({ emoji: '📜', text: `Reward from ${reward.name}` });
      }
    }
  }
  const gathering = GATHERING_SITES.filter((site) =>
    site.yields.some((drop) => drop.item === objective.target) ||
    Object.values(site.baitTables ?? {}).some((dropList) =>
      dropList.some((drop) => drop.item === objective.target)
    )
  ).map((site) => ({
    emoji: { forage: '🧺', mine: '⛏️', fish: '🎣' }[site.activity],
    text:
      `${site.activity === 'mine' ? 'Mine' : site.activity === 'fish' ? 'Fish' : 'Forage'} in ${
        zone(site.zoneId)!.name
      }` +
      (site.tool ? `; bring ${itemName(site.tool)}` : '') + (site.baitTables ? ' and bait' : ''),
  }));
  return [...sources.slice(0, 2), ...gathering];
}

/** Only real catalog sources are named; these are directions, never extra objectives. */
export function objectiveSource(questDef: QuestDef, objective: Objective): string {
  return objectiveSources(questDef, objective).map((source) => `${source.emoji} ${source.text}`)
    .join('\n');
}

function objectiveLabel(objective: Objective): string {
  switch (objective.kind) {
    case 'kill':
      return `Defeat ${enemy(objective.target)!.name} ×${objective.count ?? 1}`;
    case 'collect':
      return `Collect ${itemName(objective.target)} ×${objective.count ?? 1}`;
    case 'reach':
      return `Reach ${zone(objective.target)!.name}`;
    case 'dungeon':
      return `Clear ${
        ZONES.find((zoneDef) => zoneDef.dungeon?.id === objective.target)!.dungeon!.name
      }`;
    case 'storyEvent':
      return objective.label!;
  }
}

export function questRewardText(player: PlayerState, questDef: QuestDef): string {
  const items = Object.entries(questDef.rewards.items ?? {}).map(([id, count]) =>
    `${itemName(id)} ×${count}`
  );
  return [
    xpRewardLabel(player.level, questDef.rewards.xp),
    `${questDef.rewards.gold} gold`,
    ...items,
  ].join(' · ');
}

function rewardBlocks(player: PlayerState, questDef: QuestDef): InputRichBlock[][] {
  const rewards = [
    [para({
      type: 'bold',
      text: `${xpRewardLabel(player.level, questDef.rewards.xp)} · ${questDef.rewards.gold} gold`,
    })],
    ...Object.entries(questDef.rewards.items ?? {}).map(([id, count]) => [
      para({ type: 'bold', text: `${itemName(id)} ×${count}` }),
    ]),
  ];
  const unlocks = (questDef.rewards.unlockZones ?? []).filter((id) =>
    !player.unlockedZones.includes(id)
  );
  if (unlocks.length) {
    rewards.push([para(`Opens travel to: ${unlocks.map((id) => zone(id)!.name).join(', ')}.`)]);
  }
  return rewards;
}

export function questBriefBlocks(
  player: PlayerState,
  questDef: QuestDef,
  mode: 'offer' | 'progress' | 'turnIn' = 'offer',
): InputRichBlock[] {
  const blocks: InputRichBlock[] = [
    heading(`📜 ${questDef.name}`, 3),
    details('Quest context', [para(questDef.summary)]),
    heading('🎯 Objectives', 4),
  ];
  const questProgress = player.quests[questDef.id];
  const objectives: InputRichBlock[][] = [];
  for (const [index, objective] of questDef.objectives.entries()) {
    const have = objective.kind === 'collect'
      ? countOf(player, objective.target)
      : questProgress?.counts[index] ?? 0;
    const progress = mode === 'offer'
      ? ''
      : ` — ${Math.min(have, objective.count ?? 1)}/${objective.count ?? 1}`;
    const text = [{ type: 'bold' as const, text: `${objectiveLabel(objective)}${progress}` }];
    const source = mode === 'turnIn' ? '' : objectiveSource(questDef, objective);
    objectives.push([para(source ? [...text, `\n${source}`] : text)]);
  }
  blocks.push(list(objectives), heading('📍 Completion', 4));
  const finisher = questFinisher(questDef.id)!;
  blocks.push(para(`Finish with ${finisher.npc.name} — ${finisher.zone.name}.`));
  const goods = [...collectRequirements(questDef)].map(([id, count]) =>
    `${itemName(id)} ×${count}`
  );
  if (goods.length) {
    blocks.push(para({
      type: 'bold',
      text: `${mode === 'turnIn' ? 'Hand over now' : 'At completion, hand over'}: ${
        goods.join(' · ')
      }.`,
    }));
  }
  blocks.push(
    heading(mode === 'turnIn' ? '🎁 Rewards now' : '🎁 Rewards on completion', 4),
    list(rewardBlocks(player, questDef)),
  );
  return blocks;
}

/** Called only for visible responses (or the one staged response). No mutation. */
export function choiceQuestBlocks(player: PlayerState, choice: DialogueChoice): InputRichBlock[] {
  const blocks: InputRichBlock[] = [];
  const gains: InputRichBlock[][] = [];
  const consequences: InputRichBlock[][] = [];
  if (choice.irreversible) {
    consequences.push([para({
      type: 'bold',
      text: 'Once confirmed, this decision cannot be changed.',
    })]);
  }
  for (const effect of choice.effects ?? []) {
    switch (effect.kind) {
      case 'acceptQuest':
      case 'startQuest':
        blocks.push(...questBriefBlocks(player, quest(effect.questId)!, 'offer'));
        break;
      case 'turnInQuest':
        blocks.push(...questBriefBlocks(player, quest(effect.questId)!, 'turnIn'));
        break;
      case 'lockQuest':
      case 'failQuest': {
        const status = player.quests[effect.questId]?.status;
        const started = status === 'active' || status === 'turnIn';
        const name = quest(effect.questId)!.name;
        consequences.push([para({
          type: 'bold',
          text: started
            ? `Cancels ${name}. Progress is lost; this quest cannot be resumed or rewarded.`
            : `${
              effect.kind === 'lockQuest' ? 'Permanently closes' : 'Permanently fails'
            }: ${name}.`,
        })]);
        break;
      }
      case 'resolveQuest': {
        const questDef = quest(effect.questId)!;
        consequences.push([
          para({ type: 'bold', text: `Ends ${questDef.name} without its normal rewards.` }),
          para('Forgo:'),
          list(rewardBlocks(player, questDef)),
        ]);
        break;
      }
      case 'grantItem':
        gains.push([
          para({ type: 'bold', text: `Receive: ${itemName(effect.itemId)} ×${effect.qty ?? 1}.` }),
        ]);
        break;
      case 'unlockZone':
        if (!player.unlockedZones.includes(effect.zoneId)) {
          gains.push([para(`Opens travel to: ${zone(effect.zoneId)!.name}.`)]);
        }
        break;
      case 'removeItem':
        consequences.push([para({
          type: 'bold',
          text: `Hand over now: ${itemName(effect.itemId)} ×${effect.qty ?? 1}.`,
        })]);
        break;
    }
  }
  if (gains.length) blocks.push(heading('🎁 Receive now', 4), list(gains));
  if (consequences.length || choice.consequenceHint) {
    const warning = [heading('⚠️ Consequences', 4)];
    if (consequences.length) warning.push(list(consequences));
    if (choice.consequenceHint) warning.push(para(choice.consequenceHint));
    blocks.push({ type: 'blockquote', blocks: warning });
  }
  return blocks;
}
