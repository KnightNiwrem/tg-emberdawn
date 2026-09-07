/**
 * Hub renderers: zone, travel, shop, forge, character, quests, meta.
 * Pure functions (PlayerState, args) → InputRichMessage. Rich text uses
 * typed entities (bold/italic), never HTML strings.
 */

import { renderItemReference } from './item_reference.ts';
import { itemReferenceRow } from './item_uses.ts';
import type { InputRichBlock, InputRichMessage, RichText } from 'grammy/types';
import type { PlayerState } from '../engine/types.ts';
import type { QuestDef } from '../content/types.ts';
import { npc, npcInZone, quest, questFinisher, QUESTS, questStarter } from '../content/quests.ts';
import { dialogue, dialogueNode } from '../content/dialogues.ts';
import { evalCondition } from '../engine/conditions.ts';
import { npcTopics } from '../engine/npc.ts';
import { CLASSES, MAX_LEVEL, xpForNextLevel } from '../engine/classes.ts';
import { statsOf, xpProgress } from '../engine/character.ts';
import { item, itemName, sellPrice } from '../content/items.ts';
import { resolveStock as offeringsAt, shopAt } from '../engine/shops.ts';
import { forgeAt, forgeCapability, temperBlock, temperCost } from '../engine/forge.ts';
import { materialSources } from '../engine/materials.ts';
import { gatheringOptions } from '../engine/gathering.ts';
import { recipeBlock, recipesAt } from '../engine/crafting.ts';
import { itemFactBlocks, itemMechanicsLines } from './menus.ts';
import { zone } from '../content/zones.ts';
import { routesFrom } from '../content/routes.ts';
import { forgeInZone, shopInZone } from '../content/facilities.ts';
import { bossGateBlock, dungeonOf, nextDungeonFloor, zoneDescription } from '../engine/world.ts';
import { resolveRoute, resolveRouteById, usableRoutesFrom } from '../engine/routes.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { levelLockedMain, questStatusLine } from '../engine/quests.ts';
import { countOf } from '../engine/inventory.ts';
import { temperBonusOf, temperLevel } from '../engine/forge.ts';
import {
  banner,
  buttonsRow,
  cbBtn,
  disabledBtn,
  divider,
  heading,
  para,
  pct,
  quote,
} from './rich.ts';
import { encodeCb } from '../codec.ts';
import { noticesBlocks } from './parts.ts';
import { choiceQuestBlocks, questBriefBlocks, questRewardText } from './quest_brief.ts';

type Block = InputRichBlock;

/** Identical status information in the normal and guided hubs (#183). */
function zoneHeader(player: PlayerState): Block[] {
  const zoneDef = zone(player.currentZone)!;
  const stats = statsOf(player);
  const classDef = CLASSES[player.classId];
  return [
    heading(`${zoneDef.emoji} ${zoneDef.name}`, 3),
    ...noticesBlocks({
      ...player,
      notices: player.notices.filter((line) =>
        line !== zoneDescription(player, zoneDef) &&
        line !== `🧭 You arrive at ${zoneDef.emoji} ${zoneDef.name}.`
      ),
    }),
    para([
      {
        type: 'bold',
        text: `${classDef.emoji} ${player.name} · Lv ${player.level} ${classDef.name}`,
      } as RichText,
      `\n❤️ ${player.hp}/${stats.maxHp} · 💧 ${player.mp}/${stats.maxMp} · 💰 ${player.gold}`,
    ]),
  ];
}

// ── Zone hub (home) ───────────────────────────────────────────────────────

export function renderZone(player: PlayerState): InputRichMessage {
  // Guided prologue (#69): while it runs, the hub renders ONLY the directed
  // action for the current step — travel, explore, shops and the NPC list
  // are withheld until the prologue releases the player into the real hub.
  if (player.tutorial !== 'done' && !player.battle) return renderTutorialHub(player);
  if (player.dungeonRun) return renderDungeonRun(player);
  if (player.scene.arg === 'gather') return renderGathering(player);
  if (player.scene.arg === 'craft') return renderCrafting(player);
  const zoneDef = zone(player.currentZone)!;
  const dungeon = dungeonOf(zoneDef);
  const blocks = zoneHeader(player);
  blocks.push(para({ type: 'italic', text: zoneDescription(player, zoneDef) }));
  if (zoneDef.safeHaven) {
    blocks.push(para('🔥 Safe haven · Full rest on arrival.'));
  } else {
    // Dangerous zones read differently (#164) — without implying that
    // every action out here is a fight.
    blocks.push(para('🌫️ Dangerous wilds · You can flee exploration battles.'));
  }
  if (dungeon && player.scene.arg === 'bossok') return renderDungeonEntrance(player);

  const activities = [cbBtn(
    zoneDef.safeHaven ? '🧭 Search' : '🧭 Explore',
    encodeCb({ v: 'zone', a: 'ex' }),
    'success',
  )];
  if (gatheringOptions(player).length) {
    activities.push(cbBtn('🧺 Gather', encodeCb({ v: 'zone', a: 'gp' })));
  }
  blocks.push(buttonsRow(activities));
  if (dungeon) {
    blocks.push(buttonsRow([
      cbBtn(`${dungeon.emoji} ${dungeon.name}`, encodeCb({ v: 'zone', a: 'dg' }), 'primary'),
    ]));
  }

  if (zoneDef.npcs.length) {
    blocks.push(para({ type: 'bold', text: 'Talk' }));
    for (let rowStart = 0; rowStart < zoneDef.npcs.length; rowStart += 2) {
      blocks.push(
        buttonsRow(
          zoneDef.npcs.slice(rowStart, rowStart + 2).map((npcEntry, offset) =>
            cbBtn(npcEntry.name, encodeCb({ v: 'zone', a: 'tk', arg: rowStart + offset }))
          ),
        ),
      );
    }
  }
  const services = [];
  if (shopAt(player)) services.push(cbBtn('🏪 Shop', encodeCb({ v: 'zone', a: 'sh' })));
  if (forgeAt(player)) services.push(cbBtn('⚒️ Temper', encodeCb({ v: 'zone', a: 'fg' })));
  if (recipesAt(player).length) {
    services.push(cbBtn('🛠️ Craft', encodeCb({ v: 'zone', a: 'cp', arg: 0 })));
  }
  if (services.length) blocks.push(para({ type: 'bold', text: 'Services' }), buttonsRow(services));
  blocks.push(
    para({ type: 'bold', text: 'Your hero' }),
    buttonsRow([
      cbBtn('🧍 Character', encodeCb({ v: 'zone', a: 'ch' })),
      cbBtn('🎒 Inventory', encodeCb({ v: 'zone', a: 'inv' })),
    ]),
    buttonsRow([
      cbBtn('📜 Quests', encodeCb({ v: 'zone', a: 'q' })),
      cbBtn('✨ Skills', encodeCb({ v: 'zone', a: 'sk' })),
    ]),
    buttonsRow([
      cbBtn('🚶 Travel', encodeCb({ v: 'zone', a: 'tv' })),
      cbBtn('❓ Help', encodeCb({ v: 'meta', a: 'help' })),
    ]),
  );
  return { blocks };
}

/** Run rules live at the entrance, never in the location's activity list. */
export function renderDungeonEntrance(player: PlayerState): InputRichMessage {
  const dungeon = zone(player.currentZone)!.dungeon!;
  const blocks: Block[] = [
    heading(`${dungeon.emoji} ${dungeon.name}`, 3),
    para(`Recommended Lv ${dungeon.recommendedLevel} · Your level: ${player.level}`),
    para(`${enemyDef(dungeon.boss)!.name} · Lv ${enemyDef(dungeon.boss)!.level}`),
    para(
      'Start at floor 1 and continue through the final chamber. Leaving, fleeing or defeat ends this attempt. Re-entry starts again at floor 1.',
    ),
    para(
      'No free rest or town services inside. Bring potions and ethers; you can use carried supplies between floors. Level-ups do not restore HP or MP during a run.',
    ),
    para('The boss cannot be fled, even with a Smoke Bomb. Earlier floors allow retreat.'),
  ];
  const gate = bossGateBlock(player, dungeon);
  if (gate) blocks.push(para(gate), para('You may explore the earlier floors, then leave.'));
  blocks.push(buttonsRow([
    cbBtn('Enter dungeon', encodeCb({ v: 'zone', a: 'dgb' }), 'primary'),
    cbBtn('Not now', encodeCb({ v: 'zone', a: 'hm' })),
  ]));
  return { blocks };
}

export function renderDungeonRun(player: PlayerState): InputRichMessage {
  const dungeon = zone(player.dungeonRun!.zoneId)!.dungeon!;
  const next = nextDungeonFloor(player, dungeon);
  const gate = next > dungeon.floors.length ? bossGateBlock(player, dungeon) : undefined;
  return {
    blocks: [
      heading(`${dungeon.emoji} ${dungeon.name}`, 3),
      ...noticesBlocks(player),
      para(`❤️ ${player.hp}/${statsOf(player).maxHp} · 💧 ${player.mp}/${statsOf(player).maxMp}`),
      para(
        next > dungeon.floors.length
          ? 'The final chamber lies ahead.'
          : `Next: floor ${next} of ${dungeon.floors.length + 1}`,
      ),
      ...(gate ? [para(gate)] : []),
      buttonsRow([
        ...(gate ? [] : [
          cbBtn(
            next > dungeon.floors.length ? 'Face the boss' : 'Continue',
            encodeCb({ v: 'zone', a: 'dg' }),
            'primary',
          ),
        ]),
        cbBtn('🎒 Supplies', encodeCb({ v: 'zone', a: 'inv' })),
      ]),
      para('Leaving ends this attempt. Your next entry starts at floor 1.'),
      buttonsRow([cbBtn('Leave dungeon', encodeCb({ v: 'zone', a: 'dx' }))]),
    ],
  };
}

/** Local materials and tool requirements remain visible before spending a charge. */
export function renderGathering(player: PlayerState): InputRichMessage {
  const blocks = zoneHeader(player);
  blocks.push(heading('🧺 Gathering sites', 4));
  const options = gatheringOptions(player);
  blocks.push(
    para(
      'All activities here share 3 gathering charges. They replenish 6 hours after the last charge is spent. Tools stay in your bag.',
    ),
  );
  if (options.length) {
    const first = options[0];
    blocks.push(para(
      `Stored charges: ${first.remaining}/3.` +
        (first.resetAt
          ? ` Recharges at ${
            new Date(first.resetAt).toISOString().replace('T', ' ').slice(0, 16)
          } UTC; your next gathering action checks the recharge.`
          : ''),
    ));
  } else blocks.push(para('There are no gathering sites here.'));
  for (const option of options) {
    blocks.push(heading(option.label, 4), para(option.requirements));
    if (option.tool) {
      blocks.push(para(`In bag: ${countOf(player, option.tool)}× ${itemName(option.tool)}.`));
    }
    const tables = option.baitTables
      ? Object.entries(option.baitTables)
      : [[undefined, option.yields] as const];
    for (const [bait, yields] of tables) {
      const total = yields.reduce((sum, yieldEntry) => sum + yieldEntry.weight, 0);
      blocks.push(
        para(
          (bait ? `${itemName(bait)} (have ${countOf(player, bait)}): ` : 'Finds: ') +
            yields.map((yieldEntry) =>
              `${itemName(yieldEntry.item)} ×${
                yieldEntry.min === yieldEntry.max
                  ? yieldEntry.min
                  : `${yieldEntry.min}–${yieldEntry.max}`
              } (${Math.round(yieldEntry.weight / total * 100)}%)`
            ).join(' · '),
        ),
      );
      const arg = bait ? (bait === 'm_worm_bait' ? 'fish_worm' : 'fish_grub') : option.activity;
      const missing = option.tool && countOf(player, option.tool) < 1
        ? `Needs ${itemName(option.tool)}`
        : bait && countOf(player, bait) < 1
        ? `Needs ${itemName(bait)}`
        : undefined;
      blocks.push(buttonsRow([
        missing ? disabledBtn(missing) : cbBtn(
          bait ? `🎣 Cast with ${itemName(bait)}` : option.label,
          encodeCb({ v: 'zone', a: 'ga', arg }),
          'primary',
        ),
      ]));
    }
  }
  blocks.push(
    para(
      'Tools and bait are sold at the village and ferry counters. Worms and grubs can also be gathered.',
    ),
  );
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'zone', a: 'hm' }))]));
  return { blocks };
}

/** Small local pages keep ingredients, results and actions together. */
export function renderCrafting(player: PlayerState): InputRichMessage {
  const blocks = zoneHeader(player);
  const recipes = recipesAt(player);
  const pages = Math.max(1, Math.ceil(recipes.length / 3));
  const requested = Number(player.scene.arg2 ?? 0);
  const page = Number.isFinite(requested)
    ? Math.max(0, Math.min(pages - 1, Math.floor(requested)))
    : 0;
  blocks.push(heading(`🛠️ Local workshops · ${page + 1}/${pages}`, 4));
  if (!recipes.length) blocks.push(para('There is no workshop here.'));
  for (const recipe of recipes.slice(page * 3, page * 3 + 3)) {
    const station =
      { cook: '🍲 Hearth', brew: '⚗️ Brewing bench', smelt: '⚒️ Forge bench' }[recipe.station];
    blocks.push(heading(recipe.name, 4), para(`${station} · Requires Lv ${recipe.level}`));
    blocks.push(
      para(
        `Inputs: ${
          recipe.inputs.map((mat) =>
            `${mat.qty}× ${itemName(mat.id)} (have ${countOf(player, mat.id)})`
          ).join(' · ')
        }
Fee: ${recipe.gold}g`,
      ),
    );
    for (const input of recipe.inputs.filter((mat) => countOf(player, mat.id) < mat.qty)) {
      const source = materialSources(input.id)[0];
      if (source) blocks.push(para(`${itemName(input.id)} — ${source}`));
    }
    blocks.push(para(`Makes: ${recipe.output.qty}× ${itemName(recipe.output.id)}`));
    const output = item(recipe.output.id);
    if (output) { for (const line of itemMechanicsLines(output)) blocks.push(para(line)); }
    const block = recipeBlock(player, recipe.id);
    if (block) blocks.push(para(block));
    blocks.push(
      buttonsRow([
        block
          ? disabledBtn('Ingredients or requirements missing')
          : cbBtn('Make one batch', encodeCb({ v: 'zone', a: 'cr', arg: recipe.id }), 'primary'),
      ]),
    );
  }
  const nav = [];
  if (page > 0) nav.push(cbBtn('◀️ Previous', encodeCb({ v: 'zone', a: 'cp', arg: page - 1 })));
  if (page + 1 < pages) nav.push(cbBtn('Next ▶️', encodeCb({ v: 'zone', a: 'cp', arg: page + 1 })));
  if (nav.length) blocks.push(buttonsRow(nav));
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'zone', a: 'hm' }))]));
  return { blocks };
}

// ── Guided prologue (#69) ────────────────────────────────────────────

/** The directed hub: ONE action per prologue step, status panels intact so
 * the player still learns to read their own bars. */
function renderTutorialHub(player: PlayerState): InputRichMessage {
  const blocks = zoneHeader(player);
  if (player.tutorial === 'maren') {
    blocks.push(banner('🔥 Your tale begins'));
    blocks.push(para(
      'The village hearth has failed to light this morning. Farmers wait beside sacks of seed they may have to eat instead of plant. You have come to help. Elder Maren calls you over to the ember she has kept alive.',
    ));
    blocks.push(
      buttonsRow([
        cbBtn('🧓 Speak with Elder Maren', encodeCb({ v: 'tut', a: 'maren' }), 'primary'),
      ]),
    );
  } else {
    // 'outskirts' and 'fight' (re-face after a fled fight) share one panel:
    // the controlled encounter is the only business out here.
    const again = player.tutorial === 'fight';
    blocks.push(banner('🌑 Just outside the village'));
    blocks.push(para(
      again
        ? 'The cinder mite is still beside the seed shed. You steady the ember lamp and prepare to face it again.'
        : 'A cinder mite scratches at the seed shed, scattering hot ash against the door. You set the ember lamp on a stone where it will be safe.',
    ));
    blocks.push(
      buttonsRow([
        cbBtn(
          again ? '⚔️ Face it again' : '⚔️ Face the cinder mite',
          encodeCb({ v: 'tut', a: 'face' }),
          'primary',
        ),
      ]),
    );
  }
  blocks.push(buttonsRow([cbBtn('❓ Help', encodeCb({ v: 'meta', a: 'help' }))]));
  return { blocks };
}

/** Maren's prologue brief (#69): the ember, the threat outside, the
 * send-off — spoken by Maren, in the game's register. */
export function renderTutorial(player: PlayerState): InputRichMessage {
  return {
    blocks: [
      heading('🧓 Elder Maren', 3),
      ...noticesBlocks(player),
      quote(
        '“The Great Flame once warmed our hearths and brought the spring. King Aldric divided it and kept its renewing light in his crown. Now the growing seasons shrink, and this village is running out of food. We can still change that.”',
      ),
      para(
        'Maren sets an ember lamp beside you. “A Dawncaller carries hearth-light back toward its source. That is work you can choose, and we will help you do it. First, stop the cinder mite outside our seed shed. Then come back to me. Bram and I have found a lead beneath the Whisperwood.”',
      ),
      buttonsRow([
        cbBtn('🔥 Take the ember and head out', encodeCb({ v: 'tut', a: 'out' }), 'success'),
        cbBtn('⬅️ Not yet', encodeCb({ v: 'zone', a: 'hm' })),
      ]),
    ],
  };
}

// ── Travel ────────────────────────────────────────────────────────────────

/** Authored risk vocabulary → player-facing descriptor (#164). The counts
 * are rolls, not battles — the wording never promises a fight. */
const RISK_TEXT: Record<string, string> = {
  sheltered: 'sheltered — a calm, welcoming stretch',
  mild: 'mild — mostly quiet, occasionally lively',
  wild: 'wild — expect trouble more often than not',
  perilous: 'perilous — an expedition; go restored',
};

function renderTravelConfirmation(player: PlayerState): InputRichMessage | undefined {
  // A hazardous-departure confirmation (#164): the staged panel replaces
  // the route list until confirmed or dismissed.
  const staged = player.scene.arg ?? '';
  if (staged.startsWith('go:')) {
    const edgeId = staged.slice('go:'.length);
    const plan = resolveRouteById(player, edgeId);
    const dest = plan ? zone(plan.to) : undefined;
    if (plan && dest) {
      const blocks: Block[] = [
        heading(`⚠️ ${plan.name ?? 'The road ahead'}`, 3),
        ...noticesBlocks(player),
        para(
          `${dest.emoji} ${dest.name} — Lv ${dest.levels[0]}-${dest.levels[1]}\n` +
            `${plan.eventCount} road event${plan.eventCount === 1 ? '' : 's'} · ${
              RISK_TEXT[plan.risk ?? 'wild'] ?? 'unrated'
            }`,
        ),
      ];
      if (plan.desc) blocks.push(para({ type: 'italic', text: plan.desc } as RichText));
      blocks.push(
        para(
          'Fleeing or retreating returns you to your departure point.',
        ),
      );
      blocks.push(
        buttonsRow([
          cbBtn(
            `🥾 Depart for ${dest.name}`,
            encodeCb({ v: 'travel', a: 'go', arg: edgeId }),
            'primary',
          ),
          cbBtn('✋ Not yet', encodeCb({ v: 'travel', a: 'bk' })),
        ]),
      );
      return { blocks };
    }
  }
  return undefined;
}

export function renderTravel(player: PlayerState): InputRichMessage {
  const confirmation = renderTravelConfirmation(player);
  if (confirmation) return confirmation;
  const blocks: Block[] = [
    heading('🧭 Travel', 3),
    ...noticesBlocks(player),
    para('Road events may be battles, quiet stretches, or useful finds.'),
  ];
  const routes = usableRoutesFrom(player);
  // Adjacent roads that are NOT currently usable get a clear line — the
  // map teaches adjacency, and a locked road names why. An edge hidden by
  // its author renders nothing at all (authored policy).
  for (const route of routesFrom(player.currentZone)) {
    if (routes.some((usableRoute) => usableRoute.id === route.id)) continue;
    const dest = zone(route.to);
    if (!dest) continue;
    const locked = !player.unlockedZones.includes(route.to);
    blocks.push(
      para(
        `🔒 ${route.name ?? 'A road'} → ${dest.emoji} ${dest.name} — ${
          locked ? 'not yours to walk yet' : 'closed for now'
        }.`,
      ),
    );
  }
  if (routes.length === 0) {
    blocks.push(para('No open road leads out of here yet.'));
  }
  for (const route of routes) {
    const plan = resolveRoute(player, route);
    const dest = zone(plan.to)!;
    const rolls = plan.eventCount === 0
      ? 'no road events — a safe crossing'
      : `${plan.eventCount} road event${plan.eventCount > 1 ? 's' : ''}`;
    const risk = RISK_TEXT[plan.risk ?? 'mild'] ?? 'unrated';
    blocks.push(para([
      { type: 'bold', text: `${plan.name ?? 'The road'} → ${dest.emoji} ${dest.name}` } as RichText,
      `\nLv ${dest.levels[0]}-${dest.levels[1]} · ${rolls}\n${risk}`,
    ]));
    if (plan.desc) blocks.push(para({ type: 'italic', text: plan.desc } as RichText));
    // The active secured/worsened variant is named when it differs (#164):
    // the road's current state is visible, never silent.
    if (plan.variantId !== 'base') {
      blocks.push(para(`✨ Current state: ${plan.name ?? plan.variantId}`));
    }
    // Destination services preview, when the destination authors them:
    // planning a supply run is part of reading the map.
    const services: string[] = [];
    if (dest.safeHaven) services.push('🔥 full rest');
    if (shopInZone(plan.to)) services.push('🏪 shop');
    if (forgeInZone(plan.to)) services.push('⚒️ forge');
    if (services.length > 0) blocks.push(para(`Known there: ${services.join(' · ')}`));
    blocks.push(
      buttonsRow(
        [cbBtn(`Take the road to ${dest.name}`, encodeCb({ v: 'travel', a: 'go', arg: route.id }))],
        'left',
      ),
    );
  }
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'travel', a: 'bk' }))]));
  return { blocks };
}

// ── Journey intermission (#159) ──────────────────────────────────────────

/** The persistent journey view: reconstructable from PlayerState — origin,
 * destination, progress, the latest road report, and the three controls
 * (continue, supplies, retreat). Consecutive quiet events appear as ONE
 * ordered report, never one tap apiece. */
export function renderJourney(player: PlayerState): InputRichMessage {
  const journey = player.journey;
  if (!journey) {
    return {
      blocks: [
        heading('🧭 On the road', 3),
        ...noticesBlocks(player),
        para('You are not on the road.'),
        buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'zone', a: 'hm' }))]),
      ],
    };
  }
  const from = zone(journey.fromZone);
  const to = zone(journey.toZone);
  const blocks: Block[] = [
    heading('🧭 On the road', 3),
    para([
      {
        type: 'bold',
        text: `${from?.emoji ?? ''} ${from?.name ?? journey.fromZone} → ${to?.emoji ?? ''} ${
          to?.name ?? journey.toZone
        }`,
      } as RichText,
      `\nCrossing events: ${journey.completedEvents}/${journey.totalEvents} resolved`,
    ]),
    ...noticesBlocks(player),
  ];
  if (journey.report.length > 0) {
    blocks.push(para(journey.report.join('\n')));
  }
  blocks.push(
    buttonsRow([cbBtn('➡️ Press on', encodeCb({ v: 'journey', a: 'go' }), 'primary')]),
    buttonsRow([
      cbBtn('🎒 Supplies', encodeCb({ v: 'zone', a: 'inv' })),
      cbBtn('↩️ Retreat to the origin', encodeCb({ v: 'journey', a: 'rt' }), 'danger'),
    ]),
  );
  return { blocks };
}

// ── Shop ──────────────────────────────────────────────────────────────────

/** Bottom action row shared by the buy and sell shop modes. */
function shopFooter(switchLabel: string, switchArg: number): InputRichBlock {
  return buttonsRow([
    cbBtn(switchLabel, encodeCb({ v: 'shop', a: 'p', arg: switchArg })),
    cbBtn('⬅️ Back', encodeCb({ v: 'shop', a: 'bk' })),
  ]);
}

/** Prev/page/Next navigation row shared by paged views. */
function pageNav(
  pageIndex: number,
  pages: number,
  pageCb: (page: number) => string,
): InputRichBlock {
  const nav = [];
  if (pageIndex > 0) nav.push(cbBtn('⬅️ Prev', pageCb(pageIndex - 1)));
  nav.push(cbBtn(`📄 ${pageIndex + 1}/${pages}`, pageCb(pageIndex)));
  if (pageIndex < pages - 1) nav.push(cbBtn('Next ➡️', pageCb(pageIndex + 1)));
  return buttonsRow(nav);
}

const SHOP_PAGE_SIZE = 6;

export function renderShop(player: PlayerState, page: number): InputRichMessage {
  const shop = shopAt(player);
  const stock = shop ? offeringsAt(player) : [];
  const pages = Math.max(1, Math.ceil(stock.length / SHOP_PAGE_SIZE));
  const pageIndex = Math.min(Math.max(0, page), pages - 1);
  const slice = stock.slice(pageIndex * SHOP_PAGE_SIZE, (pageIndex + 1) * SHOP_PAGE_SIZE);
  const blocks: Block[] = [
    heading(shop ? `🏪 ${shop.name}` : '🏪 Shop', 3),
    para(`💰 ${player.gold} gold — tap to buy:`),
    ...noticesBlocks(player),
  ];
  if (!shop) {
    blocks.push(para('There is no shop here.'));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'shop', a: 'bk' }))]));
    return { blocks };
  }
  if (shop.desc) blocks.push(para({ type: 'italic', text: shop.desc } as RichText));
  for (const offering of slice) {
    const itemId = offering.itemId;
    const def = item(itemId);
    if (!def) continue;
    const owned = countOf(player, itemId);
    const afford = player.gold >= offering.price;
    blocks.push(para([
      {
        type: 'bold',
        text: `${defEmoji(def.kind)} ${def.name} — ${offering.price}g${
          owned > 0 ? ` (own ${owned})` : ''
        }`,
      } as RichText,
    ]));
    // #187: every item has the same compact shelf presentation. Full
    // stats and generated effects live together in its shop detail.
    if (def.desc) blocks.push(para([{ type: 'italic', text: def.desc } as RichText]));
    blocks.push(buttonsRow([
      cbBtn('🔍 Details', encodeCb({ v: 'shop', a: 'view', arg: itemId })),
      afford
        ? cbBtn(`Buy ${def.name}`, encodeCb({ v: 'shop', a: 'buy', arg: itemId }), 'success')
        : disabledBtn(`${def.name} — too costly`),
    ], 'left'));
  }
  blocks.push(...shopTail(pageIndex, pages, '💱 Switch to selling', -1));
  return { blocks };
}

/** #187: inspect the CURRENT offering without bag ownership. Purchases
 * keep this scene open; Back clears the selection and restores its page.
 * Stock and price are resolved again on every render, including /start. */
export function renderShopItemDetail(
  player: PlayerState,
  itemId: string,
  page: number,
): InputRichMessage {
  const shop = shopAt(player);
  const offering = offeringsAt(player).find((entry) => entry.itemId === itemId);
  const def = item(itemId);
  const back = cbBtn('⬅️ Shop', encodeCb({ v: 'shop', a: 'p', arg: page }));
  if (!shop || !offering || !def) {
    return {
      blocks: [
        heading('🏪 Shop item', 4),
        para(
          shop
            ? 'This item is no longer stocked here. Return to the shop.'
            : 'There is no shop here.',
        ),
        buttonsRow([back]),
      ],
    };
  }
  const reference = renderItemReference(def.id, player.scene.arg3);
  if (reference) return reference;
  const blocks: Block[] = [
    heading(`${defEmoji(def.kind)} ${def.name}`, 4),
    para(
      `🏪 ${shop.name}\n💰 ${player.gold} gold · Price: ${offering.price}g\nIn bag: ${
        countOf(player, itemId)
      }`,
    ),
    ...noticesBlocks(player),
  ];
  const temper = temperBonusOf(player, itemId);
  if (temper > 0 && (def.kind === 'weapon' || def.kind === 'armor')) {
    blocks.push(para(
      `🔧 Forge mastery: +${
        Math.round(temper * 100)
      }% to the base stats below. Applies to every copy.`,
    ));
  }
  blocks.push(...itemFactBlocks(def));
  blocks.push(buttonsRow([
    player.gold >= offering.price
      ? cbBtn(`Buy · ${offering.price}g`, encodeCb({ v: 'shop', a: 'buy', arg: itemId }), 'success')
      : disabledBtn('Buy — too costly'),
  ]));
  blocks.push(itemReferenceRow(def.id));
  blocks.push(buttonsRow([back]));
  return { blocks };
}

/** Shared shop tail: pagination + the toggle to the other shop mode. */
function shopTail(pageIndex: number, pages: number, label: string, arg: number): Block[] {
  return [
    pageNav(pageIndex, pages, (page) => encodeCb({ v: 'shop', a: 'p', arg: page })),
    shopFooter(label, arg),
  ];
}

export function renderSell(player: PlayerState, page: number): InputRichMessage {
  // Selling is a shop-counter service (#161): the sell view exists only
  // where a shop stands, and the engine revalidates on every sale.
  const shop = shopAt(player);
  const sellable = shop
    ? player.inventory.filter((entry) => item(entry.id) && !item(entry.id)!.unique)
    : [];
  const pages = Math.max(1, Math.ceil(sellable.length / SHOP_PAGE_SIZE));
  const pageIndex = Math.min(Math.max(0, page), pages - 1);
  const slice = sellable.slice(pageIndex * SHOP_PAGE_SIZE, (pageIndex + 1) * SHOP_PAGE_SIZE);
  const blocks: Block[] = [
    heading(shop ? `💱 Sell — ${shop.name}` : '💱 Sell', 3),
    para(`💰 ${player.gold} gold — tap to sell one:`),
    ...noticesBlocks(player),
  ];
  if (!shop) {
    blocks.push(para('No merchant here would buy anything.'));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'shop', a: 'bk' }))]));
    return { blocks };
  }
  for (const entry of slice) {
    const itemDef = item(entry.id)!;
    blocks.push(para(`${itemDef.name} ×${entry.qty} — sells for ${sellPrice(itemDef.id)}g`));
    blocks.push(
      buttonsRow(
        [cbBtn(`Sell ${itemDef.name}`, encodeCb({ v: 'shop', a: 'sell', arg: itemDef.id }))],
        'left',
      ),
    );
  }
  blocks.push(...shopTail(pageIndex, pages, '🛒 Switch to buying', -2));
  return { blocks };
}

function defEmoji(kind: string): string {
  switch (kind) {
    case 'weapon':
      return '🗡️';
    case 'armor':
      return '🛡️';
    case 'trinket':
      return '💍';
    case 'consumable':
      return '🧪';
    case 'material':
      return '🧱';
    default:
      return '📜';
  }
}

// ── Forge ─────────────────────────────────────────────────────────────────

export function renderForge(player: PlayerState): InputRichMessage {
  const forge = forgeAt(player);
  if (!forge) {
    return {
      blocks: [
        heading('⚒️ Forge', 3),
        ...noticesBlocks(player),
        para('There is no forge here.'),
        buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'forge', a: 'bk' }))]),
      ],
    };
  }
  const weaponCost = temperCost(player, 'weapon');
  const armorCost = temperCost(player, 'armor');
  const caps = forgeCapability(player)!;
  const blocks: Block[] = [
    heading(`⚒️ ${forge.name}`, 3),
    ...(forge.desc ? [para({ type: 'italic', text: forge.desc } as RichText)] : []),
    para(
      "Temper your equipped gear. Each temper grants +8% to that item's base stats, up to +5. All copies of this gear share your temper level.",
    ),
    para('⚡ Tempering does not change item effects.'),
    ...noticesBlocks(player),
    para(
      `🗡️ ${player.equipment.weapon ? itemName(player.equipment.weapon) : '—'}: +${
        temperLevel(player, 'weapon')
      }/${caps.maxTemper}\n` +
        `🛡️ ${player.equipment.armor ? itemName(player.equipment.armor) : '—'}: +${
          temperLevel(player, 'armor')
        }/${caps.maxTemper}\n` +
        `💰 ${player.gold} gold`,
    ),
  ];
  for (const [label, cost] of [['Weapon', weaponCost], ['Armor', armorCost]] as const) {
    if (cost) {
      blocks.push(
        para(
          `${label}: ${cost.gold}g + ${
            cost.materials.map((mat) =>
              `${mat.qty}× ${itemName(mat.id)} (have ${countOf(player, mat.id)})`
            )
              .join(
                ' · ',
              )
          }`,
        ),
      );
    }
  }
  const weaponBlock = temperBlock(player, 'weapon');
  const armorBlock = temperBlock(player, 'armor');
  blocks.push(
    buttonsRow([
      weaponCost
        ? cbBtn(
          `Temper weapon — ${weaponCost.gold}g`,
          encodeCb({ v: 'forge', a: 'w' }),
          'primary',
        )
        : disabledBtn(weaponBlock ?? 'Weapon at this forge\u2019s limit'),
    ], 'left'),
    buttonsRow([
      armorCost
        ? cbBtn(
          `Temper armor — ${armorCost.gold}g`,
          encodeCb({ v: 'forge', a: 'a' }),
          'primary',
        )
        : disabledBtn(armorBlock ?? 'Armor at this forge\u2019s limit'),
    ], 'left'),
    buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'forge', a: 'bk' }))]),
  );
  return { blocks };
}

// ── Character sheet ───────────────────────────────────────────────────────

export function renderCharacter(player: PlayerState): InputRichMessage {
  const stats = statsOf(player);
  const classDef = CLASSES[player.classId];
  const xp = xpProgress(player);
  const done = QUESTS.filter((questDef) => player.quests[questDef.id]?.status === 'done').length;
  const need = xpForNextLevel(player.level);
  const blocks: Block[] = [
    heading(`${classDef.emoji} ${player.name} — Lv ${player.level} ${classDef.name}`, 3),
    ...noticesBlocks(player),
    para(
      `❤️ ${player.hp}/${stats.maxHp}  💧 ${player.mp}/${stats.maxMp}\n` +
        `⚔️ ATK ${stats.atk} · 🛡️ DEF ${stats.def}\n` +
        `🔮 MAG ${stats.mag} · ✨ RES ${stats.res}\n` +
        `💨 SPD ${stats.spd} · 🍀 LUK ${stats.luck}`,
    ),
    para(
      player.level >= MAX_LEVEL
        ? '✨ XP: MAX'
        : `✨ XP: ${xp.current}/${need} (${pct(xp.current, need)})`,
    ),
    para(
      `💰 ${player.gold} gold\n` +
        `⚔️ Victories: ${player.stats.battlesWon} · ☠️ Deaths: ${player.stats.deaths}\n` +
        `👑 Bosses slain: ${player.stats.bossesSlain} · 📜 Quests done: ${done}`,
    ),
    quote({ type: 'italic', text: classDef.desc }),
    buttonsRow([
      cbBtn('🎒 Inventory', encodeCb({ v: 'zone', a: 'inv' })),
      cbBtn('⬅️ Back', encodeCb({ v: 'zone', a: 'hm' })),
    ]),
    buttonsRow([cbBtn('🗑️ Delete hero…', encodeCb({ v: 'meta', a: 'reset' }), 'danger')]),
  ];
  return { blocks };
}

// ── Quest log ─────────────────────────────────────────────────────────────

const QUESTS_PAGE_SIZE = 8;

export function renderQuests(player: PlayerState, page = 0): InputRichMessage {
  const blocks: Block[] = [heading('📜 Quest Log', 3), ...noticesBlocks(player)];
  const mains = QUESTS.filter((questDef) => questDef.main);
  const sides = QUESTS.filter((questDef) => !questDef.main);
  // A main quest ready to turn in stays the primary card (#15): dropping it
  // hid the only visible turn-in path — the log fell through to a
  // prerequisite-locked "next" quest and dead-ended.
  const activeMain = mains.find((questDef) =>
    ['active', 'turnIn'].includes(player.quests[questDef.id]?.status ?? 'unavailable')
  );
  if (activeMain) {
    const ready = player.quests[activeMain.id]?.status === 'turnIn';
    blocks.push(para([{ type: 'bold', text: `🏅 Main: ${activeMain.name}` } as RichText]));
    blocks.push(para(questStatusLine(player, activeMain.id)));
    // The journal points at the physical contact (#65) — it never performs
    // the lifecycle action itself.
    if (ready) {
      const finisher = questFinisher(activeMain.id);
      if (finisher) blocks.push(para(`🏁 Return to ${finisher.npc.name} — ${finisher.zone.name}.`));
    }
    blocks.push(
      buttonsRow(
        [
          cbBtn(
            ready ? 'Ready — view details' : 'View',
            encodeCb({ v: 'quests', a: 'q', arg: activeMain.id }),
          ),
        ],
        'left',
      ),
    );
  } else {
    const next = mains.find((questDef) => player.quests[questDef.id]?.status === 'available');
    if (next) {
      const starter = questStarter(next.id);
      blocks.push(para('🟢 A main quest awaits!'));
      if (starter) blocks.push(para(`🤝 Start with ${starter.npc.name} — ${starter.zone.name}.`));
      blocks.push(
        buttonsRow(
          [cbBtn(`View: ${next.name}`, encodeCb({ v: 'quests', a: 'q', arg: next.id }))],
          'left',
        ),
      );
    } else {
      // Grind gaps are intentional, but invisible targets aren't (#33):
      // when the STORY has unlocked the next main quest and only the level
      // gates it, name it and show both numbers — with no accept path.
      // Quests still story-gated are never revealed.
      const locked = levelLockedMain(player);
      if (locked) {
        blocks.push(para([
          { type: 'bold', text: `🔒 Next: ${locked.name}` } as RichText,
          `\nRequires level ${locked.level} — you are ${player.level}. Train in the wilds: the dawn keeps.`,
        ]));
      } else if (mains.every((questDef) => player.quests[questDef.id]?.status === 'done')) {
        blocks.push(para('🏅 The story is complete — and the dawn holds.'));
      } else {
        blocks.push(para('🏅 The story continues soon…'));
      }
    }
  }
  const liveSides = sides.filter((questDef) =>
    ['available', 'active', 'turnIn'].includes(player.quests[questDef.id]?.status ?? 'unavailable')
  );
  // Pagination (#21): a completionist save can hold 18 live side quests at
  // once — the old slice(0, 8) stranded every later quest behind a page
  // that never rendered.
  const pages = Math.max(1, Math.ceil(liveSides.length / QUESTS_PAGE_SIZE));
  const pageIndex = Math.min(Math.max(0, page), pages - 1);
  const start = pageIndex * QUESTS_PAGE_SIZE;
  blocks.push(para(`Side quests (${liveSides.length})`));
  for (const questDef of liveSides.slice(start, start + QUESTS_PAGE_SIZE)) {
    const status = player.quests[questDef.id]?.status;
    const label = status === 'turnIn' ? '✅ ' : status === 'active' ? '⏳ ' : '🟢 ';
    blocks.push(
      buttonsRow(
        [cbBtn(`${label}${questDef.name}`, encodeCb({ v: 'quests', a: 'q', arg: questDef.id }))],
        'left',
      ),
    );
  }
  if (pages > 1) {
    blocks.push(
      pageNav(pageIndex, pages, (pageNum) => encodeCb({ v: 'quests', a: 'p', arg: pageNum })),
    );
  }
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'zone', a: 'hm' }))]));
  return { blocks };
}

export function renderQuestDetail(player: PlayerState, id: string): InputRichMessage {
  const questDef: QuestDef | undefined = quest(id);
  const questProgress = player.quests[id];
  const blocks: Block[] = [];
  if (!questDef) {
    blocks.push(para('That quest is unavailable. Return to the Quest Log.'));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'quests', a: 'bk' }))]));
    return { blocks };
  }
  blocks.push(...noticesBlocks(player));
  const status = questProgress?.status ?? 'unavailable';
  if (status === 'available' || status === 'active' || status === 'turnIn') {
    // The same actionable brief as the conversation, with no lifecycle controls.
    blocks.push(
      ...questBriefBlocks(
        player,
        questDef,
        status === 'available' ? 'offer' : status === 'turnIn' ? 'turnIn' : 'progress',
      ),
    );
    if (status === 'available') blocks.push(para(`✔️ Requires level ${questDef.level}.`));
    if (status === 'turnIn') blocks.push(para(questStatusLine(player, id)));
  } else {
    blocks.push(heading(`${questDef.main ? '🏅' : '📜'} ${questDef.name}`, 4));
    blocks.push(quote({ type: 'italic', text: questDef.summary }));
    blocks.push(para(questStatusLine(player, id)));
    blocks.push(
      para(
        player.questOutcomes[id]?.kind === 'resolved'
          ? 'This quest ended with an alternate outcome. Its normal rewards were not granted.'
          : `🎁 Rewards: ${questRewardText(player, questDef)}`,
      ),
    );
  }
  // Read-only journal (#65): no lifecycle buttons render here — accepting
  // and turning in happen face-to-face with the quest's configured NPC, in
  // the zone where they stand. The brief already names the finisher; an
  // available quest also needs its starter, who may be a different person.
  const starter = questStarter(id);
  if (status === 'available' && starter) {
    blocks.push(para(`🤝 Start with ${starter.npc.name} — ${starter.zone.name}.`));
  }
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'quests', a: 'bk' }))]));
  return { blocks };
}

// ── NPC topic menu (#123) ────────────────────────────────────────────────

/** The NPC topic-selection scene (#123): every currently available topic —
 * ready turn-ins, new offers, active business, authored lore — is rendered
 * as its own row (priority order emphasizes, never suppresses). The
 * default greeting is the concise header, so an NPC with no business still
 * exposes their authored conversation instead of flashing a notice. Pure
 * navigation: nothing here mutates. */
export function renderNpcTopics(player: PlayerState): InputRichMessage {
  const npcId = player.scene.arg ?? '';
  const def = npc(npcId);
  const blocks: Block[] = [];
  if (!def || !npcInZone(player.currentZone, npcId)) {
    blocks.push(para('Nobody there.'));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'npc', a: 'bk' }))]));
    return { blocks };
  }
  if (player.scene.arg2?.startsWith('lore:')) {
    const topic = def.topics?.find((topicItem) =>
      topicItem.id === player.scene.arg2!.slice('lore:'.length)
    );
    blocks.push(heading(`🗣️ ${def.name}`, 4));
    blocks.push(...noticesBlocks(player));
    if (topic?.text) blocks.push(quote({ type: 'italic', text: topic.text }));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'npc', a: 'op', arg: npcId }))]));
    return { blocks };
  }
  if (player.scene.arg2?.startsWith('q:')) {
    const questDef = quest(player.scene.arg2.slice('q:'.length));
    blocks.push(heading(`🗣️ ${def.name}`, 4));
    blocks.push(...noticesBlocks(player));
    if (questDef) {
      blocks.push(
        ...questBriefBlocks(
          player,
          questDef,
          player.quests[questDef.id]?.status === 'turnIn' ? 'turnIn' : 'progress',
        ),
      );
    }
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'npc', a: 'op', arg: npcId }))]));
    return { blocks };
  }
  blocks.push(heading(`🗣️ ${def.name}`, 4));
  blocks.push(quote({ type: 'italic', text: def.greeting }));
  blocks.push(...noticesBlocks(player));
  const topics = npcTopics(player, npcId);
  if (topics.length > 0) blocks.push(para('Choose a topic:'));
  for (const topic of topics) {
    blocks.push(
      buttonsRow([
        cbBtn(
          topic.label,
          encodeCb({ v: 'npc', a: topic.kind === 'lore' ? 'lore' : 'q', arg: topic.id }),
        ),
      ], 'left'),
    );
  }
  blocks.push(buttonsRow([cbBtn('👋 Leave', encodeCb({ v: 'npc', a: 'bk' }))]));
  return { blocks };
}

// ── Dialogue scene (#124) ────────────────────────────────────────────────

/** Renders ONE dialogue beat in the live message (#124): the panel
 * distinguishes NPC speech (quoted), authored player speech, and narrator
 * stage direction; Continue advances exactly one node and edits this same
 * message — no extra Telegram messages. Reopening a dialogue always
 * restarts it from the start node (documented policy); /start and rerenders
 * reproduce the CURRENT node because the scene persists (dialogue, node). */
export function renderDialogue(player: PlayerState): InputRichMessage {
  const dialogueDef = dialogue(player.scene.arg ?? '');
  const blocks: Block[] = [];
  const npcDef = dialogueDef ? npc(dialogueDef.npcId) : undefined;
  if (!dialogueDef || !npcDef || !npcInZone(player.currentZone, dialogueDef.npcId)) {
    blocks.push(para('That conversation has moved on.'));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'dlg', a: 'bk' }))]));
    return { blocks };
  }
  const node = dialogueNode(dialogueDef, player.scene.arg2 ?? '') ??
    dialogueNode(dialogueDef, dialogueDef.start)!;
  blocks.push(heading(`🗣️ ${npcDef.name}`, 4));
  blocks.push(...noticesBlocks(player));
  if (node.kind === 'line') {
    if (node.speaker === 'narrator') {
      blocks.push(para({ type: 'italic', text: node.text } as RichText));
    } else if (node.speaker === 'player') {
      blocks.push(quote(`You — “${node.text}”`));
    } else {
      blocks.push(quote(`“${node.text}”`));
    }
    const row = [];
    if (node.next) {
      row.push(
        cbBtn('➡️ Continue', encodeCb({ v: 'dlg', a: 'nx', arg: node.next }), 'primary'),
      );
    }
    row.push(
      cbBtn(node.next ? '👋 Leave' : '👋 End conversation', encodeCb({ v: 'dlg', a: 'bk' })),
    );
    blocks.push(buttonsRow(row));
    return { blocks };
  }
  if (node.kind === 'choice') {
    // Irreversible confirmation panel (#126): repeats the selection, states
    // permanence, offers the consequence hint, mutates NOTHING — Confirm
    // is the only mutating control, staged through arg3.
    if (player.scene.arg3?.startsWith('confirm:')) {
      const choice = node.choices.find((choice) =>
        choice.id === player.scene.arg3!.slice('confirm:'.length)
      );
      if (choice) {
        blocks.push(quote(`You — “${choice.label}”`));
        blocks.push(...choiceQuestBlocks(player, choice));
        blocks.push(
          divider(),
          buttonsRow([
            cbBtn(
              '✅ Confirm choice',
              encodeCb({ v: 'dlg', a: 'cf', arg: choice.id }),
              'danger',
            ),
            cbBtn('✋ Go back', encodeCb({ v: 'dlg', a: 'cc' })),
          ], 'left'),
        );
        return { blocks };
      }
    }
    // The choice list: the NPC prompt is visually separate from the
    // player's responses; every response whose condition currently passes
    // renders in authored order — no default selection (#126). Authored
    // `when` gates HIDE a response (a secret route), by design; re-render
    // is never authority — availability is revalidated at tap time.
    blocks.push(quote(`“${node.prompt}”`));
    const choices = node.choices.filter((choice) =>
      !choice.when || evalCondition(player, choice.when)
    );
    const defer = node.allowDeferral !== false;
    for (const choice of choices) {
      const brief = choiceQuestBlocks(player, choice);
      if (choices.length > 1 && brief.length) {
        blocks.push(divider(), heading(choice.label, 4));
      }
      blocks.push(...brief);
      const row = [
        cbBtn(
          choice.label,
          encodeCb({ v: 'dlg', a: 'ch', arg: choice.id }),
          choices.length === 1 ? 'primary' : undefined,
        ),
      ];
      if (choices.length === 1) {
        blocks.push(divider());
        if (defer) {
          row.push(cbBtn('✋ Not now', encodeCb({ v: 'dlg', a: 'bk' })));
        }
      }
      blocks.push(buttonsRow(row, 'left'));
    }
    if (defer && choices.length !== 1) {
      blocks.push(
        divider(),
        buttonsRow([cbBtn('✋ Not now', encodeCb({ v: 'dlg', a: 'bk' }))], 'left'),
      );
    }
    return { blocks };
  }
  // End node: the conversation concluded — only the exit remains.
  blocks.push(buttonsRow([cbBtn('👋 End conversation', encodeCb({ v: 'dlg', a: 'bk' }))]));
  return { blocks };
}

// ── Death ─────────────────────────────────────────────────────────────────

export function renderDeath(player: PlayerState): InputRichMessage {
  return {
    blocks: [
      banner('💀 You have fallen…'),
      ...noticesBlocks(player),
      quote('The dawn you seek is still ahead — and the Flame is not done with you.'),
      buttonsRow([cbBtn('🕯️ Rise again', encodeCb({ v: 'death', a: 'ok' }), 'success')]),
    ],
  };
}

// ── Help / meta ───────────────────────────────────────────────────────────

export function renderHelp(): InputRichMessage {
  return {
    blocks: [
      heading('🔥 Emberdawn — help', 3),
      para(
        'A turn-based RPG living inside this message.\n\n' +
          '🧭 Explore — seek battles, treasure and rest in the wilds.\n' +
          '🛖 Safe havens — no battles, and arriving fully heals you. Not every haven offers services.\n' +
          '🏪 ⚒️ Shops and forges live where they are built — each with its own stock and craft. Better gear means reaching the region that sells it.\n' +
          '⚔️ Battles — your free action, Skills, Items, Guard, Flee. Free actions are class-typed: Warrior/Rogue attack with ATK, Mage/Cleric with MAG. SPD pays off: outspeeding a foe slips its damaging blows aside (baseline 2%, hard cap 20%).\n' +
          '📜 Quests — the main story clears the game; side quests pad your purse.\n' +
          '🏰 Dungeons — each entry starts at floor 1. No free rest inside; bring supplies. Leaving or fleeing restarts your next attempt.\n' +
          '⚒️ Forges — temper gear up to +5 using regional materials and a fee. All copies of the same gear share its temper level.\n' +
          '🧺 Gathering — local plants, ores and fish; 3 shared charges per location replenish 6 hours after the last use. Picks and rods are reusable; fishing spends bait.\n' +
          '🛠️ Workshops — brew, cook and smelt where offered. Inspect materials in your bag for sources and uses.\n' +
          '🚶 Travel — follow roads between adjacent places. Starter roads are safe and immediate; farther roads have events such as battles, quiet stretches, or useful finds. Fleeing or retreating returns you to your departure point.\n\n' +
          'Use /start to find the game message again.',
      ),
      buttonsRow([cbBtn('⬅️ Back to the game', encodeCb({ v: 'zone', a: 'hm' }), 'primary')]),
    ],
  };
}

// ── Reset confirmation ──────────────────────────────────────────────────

export function renderResetConfirm(player: PlayerState): InputRichMessage {
  return {
    blocks: [
      banner('⚠️ Delete this hero?'),
      ...noticesBlocks(player),
      para(
        'This erases your character — level, gold, gear, every quest — and starts a brand-new tale. There is no undo.',
      ),
      buttonsRow([
        cbBtn('🔥 Yes — start over', encodeCb({ v: 'meta', a: 'resetYes' }), 'danger'),
        cbBtn('✋ No — keep playing', encodeCb({ v: 'meta', a: 'resetNo' }), 'primary'),
      ]),
    ],
  };
}

// ── Character creation ────────────────────────────────────────────────────

export function renderClassPicker(): InputRichMessage {
  const blocks: Block[] = [
    heading('🔥 Emberdawn', 2),
    para(
      'Spring comes later each year. The fields around Emberdawn no longer grow enough to feed the village. King Aldric stole the renewing light of the Great Flame, and someone must carry a living ember back to its source. You have come to help. Choose how you will face the road:',
    ),
  ];
  for (const classId of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    const classDef = CLASSES[classId];
    blocks.push(para([
      {
        type: 'bold',
        text: `${classDef.emoji} ${classDef.name} — ${classDef.tagline}`,
      } as RichText,
      { type: 'italic', text: `\n${classDef.desc}` } as RichText,
    ]));
    blocks.push(
      para(
        `Opens with ${classDef.basicAction.name} (free) and ${classDef.startingKit}. ${classDef.tradeoff} Complexity: ${classDef.complexity}.${
          classDef.beginnerPick ? ' ⭐ The forgiving first pick.' : ''
        }`,
      ),
    );
    blocks.push(
      buttonsRow(
        [cbBtn(
          `Play ${classDef.name}`,
          encodeCb({ v: 'meta', a: 'pick', arg: classId }),
          'primary',
        )],
        'left',
      ),
    );
  }
  return { blocks };
}
