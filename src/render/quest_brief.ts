/** Quest decisions disclose their work and transaction from live content (#190). */
import type { InputRichBlock } from 'grammy/types';
import type { DialogueChoice, Objective, QuestDef } from '../content/types.ts';
import type { PlayerState } from '../engine/types.ts';
import { DIALOGUES } from '../content/dialogues.ts';
import { ENEMIES, enemy } from '../content/enemies.ts';
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
  const field = ZONES.filter((z) =>
    z.explore.some((e) => (e.kind === 'battle' || e.kind === 'elite') && e.enemy === id)
  ).map((z) => ({
    emoji: z.safeHaven ? '🌾' : '🧭',
    text: `${z.name} (${z.safeHaven ? 'Forage' : 'Explore'})`,
  }));
  const dungeons = ZONES.filter((z) =>
    z.dungeon?.boss === id || z.dungeon?.floors.some((f) => f.enemies.includes(id))
  ).map((z) => {
    const d = z.dungeon!;
    const key = d.boss === id ? d.bossGate?.item : undefined;
    return {
      emoji: d.emoji,
      text: `${d.name} — ${z.name}${
        d.boss === id ? ` (boss; recommended Lv ${d.recommendedLevel})` : ' (Dungeon)'
      }${key ? `; bring ${itemName(key)}, consumed on the first boss victory` : ''}`,
    };
  });
  return [...field, ...dungeons];
}

/** Keep each activity's identity with its directions until the final line formatting. */
function objectiveSources(q: QuestDef, o: Objective): ObjectiveSource[] {
  if (o.kind === 'kill') return enemyPlaces(o.target);
  if (o.kind === 'dungeon') {
    const z = ZONES.find((z) => z.dungeon?.id === o.target);
    return z
      ? [{
        emoji: z.dungeon!.emoji,
        text: `${z.name} (Dungeon; recommended Lv ${z.dungeon!.recommendedLevel})`,
      }]
      : [];
  }
  if (o.kind === 'reach') {
    return [{
      emoji: '🚶',
      text: 'Travel along the roads to this region, then meet the contact below.',
    }];
  }
  if (o.kind === 'storyEvent') {
    const d = DIALOGUES.find((d) =>
      [q.startNpc, q.finishNpc].includes(d.npcId) &&
      d.nodes.some((n) =>
        (n.kind === 'line'
          ? n.effects ?? []
          : n.kind === 'choice'
          ? n.choices.flatMap((c) => c.effects ?? [])
          : []).some((e) => e.kind === 'storyEvent' && e.event === o.target)
      )
    );
    if (!d) return [];
    if (d.id === q.offerDialogue) {
      return [{ emoji: '🗣️', text: 'Recorded when you accept this conversation.' }];
    }
    const topic = npc(d.npcId)?.topics?.find((t) => t.dialogue === d.id);
    return [{
      emoji: '🗣️',
      text: `${npc(d.npcId)!.name} — ${zoneOfNpc(d.npcId)!.name}: ${topic?.label ?? q.name}.`,
    }];
  }
  const sources: ObjectiveSource[] = [];
  for (const z of ZONES) {
    if (z.dungeon?.floors.some((f) => f.treasure?.item === o.target)) {
      sources.push({
        emoji: z.dungeon.emoji,
        text: `First-visit caches in ${z.dungeon.name} — ${z.name}`,
      });
    }
  }
  const drops = ENEMIES.filter((e) => (e.drops?.[o.target] ?? 0) > 0);
  // A later field enemy must not displace an earlier dungeon source:
  // Mycelids supply Bram's iron before Hollowmere's Boglins are reachable.
  const source = drops.toSorted((a, b) => a.level - b.level)[0];
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
      if (reward.rewards.items?.[o.target]) {
        sources.push({ emoji: '📜', text: `Reward from ${reward.name}` });
      }
    }
  }
  return sources.slice(0, 2);
}

/** Only real catalog sources are named; these are directions, never extra objectives. */
export function objectiveSource(q: QuestDef, o: Objective): string {
  return objectiveSources(q, o).map((source) => `${source.emoji} ${source.text}`).join('\n');
}

function objectiveLabel(o: Objective): string {
  switch (o.kind) {
    case 'kill':
      return `Defeat ${enemy(o.target)!.name} ×${o.count ?? 1}`;
    case 'collect':
      return `Collect ${itemName(o.target)} ×${o.count ?? 1}`;
    case 'reach':
      return `Reach ${zone(o.target)!.name}`;
    case 'dungeon':
      return `Clear ${ZONES.find((z) => z.dungeon?.id === o.target)!.dungeon!.name}`;
    case 'storyEvent':
      return o.label!;
  }
}

export function questRewardText(p: PlayerState, q: QuestDef): string {
  const items = Object.entries(q.rewards.items ?? {}).map(([id, n]) => `${itemName(id)} ×${n}`);
  return [xpRewardLabel(p.level, q.rewards.xp), `${q.rewards.gold} gold`, ...items].join(' · ');
}

function rewardBlocks(p: PlayerState, q: QuestDef): InputRichBlock[][] {
  const rewards = [
    [para({
      type: 'bold',
      text: `${xpRewardLabel(p.level, q.rewards.xp)} · ${q.rewards.gold} gold`,
    })],
    ...Object.entries(q.rewards.items ?? {}).map(([id, n]) => [
      para({ type: 'bold', text: `${itemName(id)} ×${n}` }),
    ]),
  ];
  const unlocks = (q.rewards.unlockZones ?? []).filter((id) => !p.unlockedZones.includes(id));
  if (unlocks.length) {
    rewards.push([para(`Opens travel to: ${unlocks.map((id) => zone(id)!.name).join(', ')}.`)]);
  }
  return rewards;
}

export function questBriefBlocks(
  p: PlayerState,
  q: QuestDef,
  mode: 'offer' | 'progress' | 'turnIn' = 'offer',
): InputRichBlock[] {
  const blocks: InputRichBlock[] = [
    heading(`📜 ${q.name}`, 3),
    details('Quest context', [para(q.summary)]),
    heading('🎯 Objectives', 4),
  ];
  const qp = p.quests[q.id];
  const objectives: InputRichBlock[][] = [];
  for (const [i, o] of q.objectives.entries()) {
    const have = o.kind === 'collect' ? countOf(p, o.target) : qp?.counts[i] ?? 0;
    const progress = mode === 'offer' ? '' : ` — ${Math.min(have, o.count ?? 1)}/${o.count ?? 1}`;
    const text = [{ type: 'bold' as const, text: `${objectiveLabel(o)}${progress}` }];
    const source = mode === 'turnIn' ? '' : objectiveSource(q, o);
    objectives.push([para(source ? [...text, `\n${source}`] : text)]);
  }
  blocks.push(list(objectives), heading('📍 Completion', 4));
  const fin = questFinisher(q.id)!;
  blocks.push(para(`Finish with ${fin.npc.name} — ${fin.zone.name}.`));
  const goods = [...collectRequirements(q)].map(([id, n]) => `${itemName(id)} ×${n}`);
  blocks.push(
    para(
      goods.length > 0
        ? {
          type: 'bold',
          text: `${mode === 'turnIn' ? 'Hand over now' : 'At completion, hand over'}: ${
            goods.join(' · ')
          }. These leave your bag.`,
        }
        : 'Completion is a report; no items are handed over.',
    ),
  );
  blocks.push(
    heading(mode === 'turnIn' ? '🎁 Rewards now' : '🎁 Rewards on completion', 4),
    list(rewardBlocks(p, q)),
  );
  return blocks;
}

/** Called only for visible responses (or the one staged response). No mutation. */
export function choiceQuestBlocks(p: PlayerState, c: DialogueChoice): InputRichBlock[] {
  const blocks: InputRichBlock[] = [];
  const gains: InputRichBlock[][] = [];
  const consequences: InputRichBlock[][] = [];
  if (c.irreversible) {
    consequences.push([para({
      type: 'bold',
      text: 'Once confirmed, this decision cannot be changed.',
    })]);
  }
  for (const e of c.effects ?? []) {
    switch (e.kind) {
      case 'acceptQuest':
      case 'startQuest':
        blocks.push(...questBriefBlocks(p, quest(e.questId)!, 'offer'));
        break;
      case 'turnInQuest':
        blocks.push(...questBriefBlocks(p, quest(e.questId)!, 'turnIn'));
        break;
      case 'lockQuest':
      case 'failQuest': {
        const status = p.quests[e.questId]?.status;
        const started = status === 'active' || status === 'turnIn';
        const name = quest(e.questId)!.name;
        consequences.push([para({
          type: 'bold',
          text: started
            ? `Cancels ${name}. Progress is lost; this quest cannot be resumed or rewarded.`
            : `${e.kind === 'lockQuest' ? 'Permanently closes' : 'Permanently fails'}: ${name}.`,
        })]);
        break;
      }
      case 'resolveQuest': {
        const q = quest(e.questId)!;
        consequences.push([
          para({ type: 'bold', text: `Ends ${q.name} without its normal rewards.` }),
          para('Forgo:'),
          list(rewardBlocks(p, q)),
        ]);
        break;
      }
      case 'grantItem':
        gains.push([
          para({ type: 'bold', text: `Receive: ${itemName(e.itemId)} ×${e.qty ?? 1}.` }),
        ]);
        break;
      case 'unlockZone':
        if (!p.unlockedZones.includes(e.zoneId)) {
          gains.push([para(`Opens travel to: ${zone(e.zoneId)!.name}.`)]);
        }
        break;
      case 'removeItem':
        consequences.push([para({
          type: 'bold',
          text: `Hand over now: ${itemName(e.itemId)} ×${e.qty ?? 1}. These leave your bag.`,
        })]);
        break;
    }
  }
  if (gains.length) blocks.push(heading('🎁 Receive now', 4), list(gains));
  if (consequences.length || c.consequenceHint) {
    const warning = [heading('⚠️ Consequences', 4)];
    if (consequences.length) warning.push(list(consequences));
    if (c.consequenceHint) warning.push(para(c.consequenceHint));
    blocks.push({ type: 'blockquote', blocks: warning });
  }
  return blocks;
}
