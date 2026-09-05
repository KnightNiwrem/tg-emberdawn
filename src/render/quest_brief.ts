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
import { para } from './rich.ts';

function enemyPlaces(id: string): string[] {
  const field = ZONES.filter((z) =>
    z.explore.some((e) => (e.kind === 'battle' || e.kind === 'elite') && e.enemy === id)
  ).map((z) => `${z.name} (Explore)`);
  const dungeons = ZONES.filter((z) =>
    z.dungeon?.boss === id || z.dungeon?.floors.some((f) => f.enemies.includes(id))
  ).map((z) => {
    const d = z.dungeon!;
    const key = d.boss === id ? d.bossGate?.item : undefined;
    return `${d.name} — ${z.name}${
      d.boss === id ? ` (boss; recommended Lv ${d.recommendedLevel})` : ''
    }${key ? `; bring ${itemName(key)}, consumed on the first boss victory` : ''}`;
  });
  return [...field, ...dungeons];
}

/** Only real catalog sources are named; these are directions, never extra objectives. */
export function objectiveSource(q: QuestDef, o: Objective): string {
  if (o.kind === 'kill') return enemyPlaces(o.target).slice(0, 2).join('; ');
  if (o.kind === 'dungeon') {
    const z = ZONES.find((z) => z.dungeon?.id === o.target);
    return z ? `${z.name} (Dungeon; recommended Lv ${z.dungeon!.recommendedLevel})` : '';
  }
  if (o.kind === 'reach') {
    return 'Travel along the roads to this region, then meet the contact below.';
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
    if (!d) return '';
    if (d.id === q.offerDialogue) return 'Recorded when you accept this conversation.';
    const topic = npc(d.npcId)?.topics?.find((t) => t.dialogue === d.id);
    return `${npc(d.npcId)!.name} — ${zoneOfNpc(d.npcId)!.name}: ${topic?.label ?? q.name}.`;
  }
  const sources: string[] = [];
  for (const z of ZONES) {
    if (z.dungeon?.floors.some((f) => f.treasure?.item === o.target)) {
      sources.push(`First-visit caches in ${z.dungeon.name} — ${z.name}`);
    }
  }
  const drops = ENEMIES.filter((e) => (e.drops?.[o.target] ?? 0) > 0);
  // A later field enemy must not displace an earlier dungeon source:
  // Mycelids supply Bram's iron before Hollowmere's Boglins are reachable.
  const source = drops.toSorted((a, b) => a.level - b.level)[0];
  if (source) {
    sources.push(
      `Drops from ${source.name} — ${enemyPlaces(source.id)[0]} (may take several fights)`,
    );
  }
  // Prefer repeatable drops and early caches over later quest rewards that
  // may themselves require completing this quest (e.g. Bram's iron order).
  if (sources.length === 0) {
    for (const reward of QUESTS) {
      if (reward.rewards.items?.[o.target]) sources.push(`Reward from ${reward.name}`);
    }
  }
  return sources.slice(0, 2).join('; ');
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

export function questBriefBlocks(
  p: PlayerState,
  q: QuestDef,
  mode: 'offer' | 'progress' | 'turnIn' = 'offer',
): InputRichBlock[] {
  const blocks: InputRichBlock[] = [para({ type: 'bold', text: `📜 ${q.name}` }), para(q.summary)];
  const qp = p.quests[q.id];
  for (const [i, o] of q.objectives.entries()) {
    const have = o.kind === 'collect' ? countOf(p, o.target) : qp?.counts[i] ?? 0;
    const progress = mode === 'offer' ? '' : ` — ${Math.min(have, o.count ?? 1)}/${o.count ?? 1}`;
    blocks.push(para(`• ${objectiveLabel(o)}${progress}`));
    if (mode !== 'turnIn') blocks.push(para(`Where: ${objectiveSource(q, o)}`));
  }
  const fin = questFinisher(q.id)!;
  blocks.push(para(`Finish with ${fin.npc.name} — ${fin.zone.name}.`));
  const goods = [...collectRequirements(q)].map(([id, n]) => `${itemName(id)} ×${n}`);
  blocks.push(
    para(
      goods.length > 0
        ? `${mode === 'turnIn' ? 'Hand over now' : 'At completion, hand over'}: ${
          goods.join(' · ')
        }. These leave your bag.`
        : 'Completion is a report; no items are handed over.',
    ),
  );
  blocks.push(para(`🎁 Rewards: ${questRewardText(p, q)}`));
  const unlocks = (q.rewards.unlockZones ?? []).filter((id) => !p.unlockedZones.includes(id));
  if (unlocks.length) {
    blocks.push(para(`Opens travel to: ${unlocks.map((id) => zone(id)!.name).join(', ')}.`));
  }
  return blocks;
}

/** Called only for visible responses (or the one staged response). No mutation. */
export function choiceQuestBlocks(p: PlayerState, c: DialogueChoice): InputRichBlock[] {
  const blocks: InputRichBlock[] = [];
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
        blocks.push(para(`Permanently closes: ${quest(e.questId)!.name}.`));
        break;
      case 'resolveQuest':
        blocks.push(para(`Ends ${quest(e.questId)!.name} without its normal rewards.`));
        break;
      case 'grantItem':
        blocks.push(para(`Receive: ${itemName(e.itemId)} ×${e.qty ?? 1}.`));
        break;
      case 'removeItem':
        blocks.push(para(`Hand over: ${itemName(e.itemId)} ×${e.qty ?? 1}.`));
        break;
    }
  }
  return blocks;
}
