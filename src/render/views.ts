/**
 * Hub renderers: zone, travel, shop, forge, character, quests, meta.
 * Pure functions (PlayerState, args) → InputRichMessage. Rich text uses
 * typed entities (bold/italic), never HTML strings.
 */

import type { InputRichBlock, InputRichMessage, RichText } from 'grammy/types';
import type { PlayerState } from '../engine/types.ts';
import type { QuestDef } from '../content/types.ts';
import { quest, QUESTS } from '../content/quests.ts';
import { CLASSES, MAX_LEVEL, xpForNextLevel } from '../engine/classes.ts';
import { statsOf, xpProgress } from '../engine/character.ts';
import { item, itemName, sellPrice } from '../content/items.ts';
import { currentStock } from '../engine/shops.ts';
import { zone } from '../content/zones.ts';
import { dungeonOf, dungeonProgressLine } from '../engine/world.ts';
import { questStatusLine } from '../engine/quests.ts';
import { countOf } from '../engine/inventory.ts';
import { MAX_TEMPER, temperCost, temperLevel } from '../engine/forge.ts';
import { banner, bar, buttonsRow, cbBtn, disabledBtn, heading, para, pct, quote } from './rich.ts';
import { encodeCb } from '../codec.ts';
import { noticesBlocks } from './parts.ts';

type Block = InputRichBlock;

// ── Zone hub (home) ───────────────────────────────────────────────────────

export function renderZone(p: PlayerState): InputRichMessage {
  const z = zone(p.currentZone)!;
  const s = statsOf(p);
  const c = CLASSES[p.classId];
  const d = dungeonOf(z);
  const blocks: Block[] = [
    heading(`${z.emoji} ${z.name}`, 3),
    ...noticesBlocks(p),
    para([
      { type: 'bold', text: `${c.emoji} ${p.name} · Lv ${p.level} ${c.name}` } as RichText,
      `\n❤️ ${p.hp}/${s.maxHp} ${bar(p.hp, s.maxHp)}\n💧 ${p.mp}/${s.maxMp} ${
        bar(p.mp, s.maxMp)
      }\n💰 ${p.gold} gold`,
    ]),
  ];
  if (z.safeHaven) blocks.push(para('🔥 Safe haven — full rest on arrival.'));
  if (d) blocks.push(para(`${d.emoji} ${d.name} — ${dungeonProgressLine(p, d)}`));

  blocks.push(
    buttonsRow([
      cbBtn(z.safeHaven ? '🌾 Forage' : '🧭 Explore', encodeCb({ v: 'zone', a: 'ex' }), 'success'),
      d
        ? cbBtn(`${d.emoji} Dive`, encodeCb({ v: 'zone', a: 'dg' }), 'primary')
        : disabledBtn('🗺️ —'),
      cbBtn('🚶 Travel', encodeCb({ v: 'zone', a: 'tv' })),
    ]),
    buttonsRow([
      cbBtn('🧍 Character', encodeCb({ v: 'zone', a: 'ch' })),
      cbBtn('🎒 Inventory', encodeCb({ v: 'zone', a: 'inv' })),
      cbBtn('📜 Quests', encodeCb({ v: 'zone', a: 'q' })),
      cbBtn('✨ Skills', encodeCb({ v: 'zone', a: 'sk' })),
    ]),
    buttonsRow([
      z.shop ? cbBtn('🏪 Shop', encodeCb({ v: 'zone', a: 'sh' })) : disabledBtn('🏪 —'),
      cbBtn('⚒️ Forge', encodeCb({ v: 'zone', a: 'fg' })),
      cbBtn('❓ Help', encodeCb({ v: 'meta', a: 'help' })),
    ]),
  );

  if (z.npcs.length > 0) {
    blocks.push(para('🗣️ Talk to:'));
    for (let i = 0; i < z.npcs.length; i++) {
      const npc = z.npcs[i]!;
      blocks.push(buttonsRow([cbBtn(npc.name, encodeCb({ v: 'zone', a: 'tk', arg: i }))], 'left'));
    }
  }
  return { blocks };
}

// ── Travel ────────────────────────────────────────────────────────────────

export function renderTravel(p: PlayerState): InputRichMessage {
  const blocks: Block[] = [
    heading('🧭 Travel', 3),
    ...noticesBlocks(p),
    para('Where the flame calls, follow.'),
  ];
  for (const zid of p.unlockedZones) {
    const z = zone(zid);
    if (!z) continue;
    const here = zid === p.currentZone;
    blocks.push(
      para(
        `${z.emoji} ${z.name} — Lv ${z.levels[0]}-${z.levels[1]}${here ? ' (you are here)' : ''}`,
      ),
    );
    if (!here) {
      blocks.push(
        buttonsRow(
          [cbBtn(`Go to ${z.name}`, encodeCb({ v: 'travel', a: 'go', arg: zid }))],
          'left',
        ),
      );
    }
  }
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'travel', a: 'bk' }))]));
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
function pageNav(pg: number, pages: number, pageCb: (n: number) => string): InputRichBlock {
  const nav = [];
  if (pg > 0) nav.push(cbBtn('⬅️ Prev', pageCb(pg - 1)));
  nav.push(cbBtn(`📄 ${pg + 1}/${pages}`, pageCb(pg)));
  if (pg < pages - 1) nav.push(cbBtn('Next ➡️', pageCb(pg + 1)));
  return buttonsRow(nav);
}

const SHOP_PAGE_SIZE = 6;

export function renderShop(p: PlayerState, page: number): InputRichMessage {
  const stock = currentStock(p);
  const pages = Math.max(1, Math.ceil(stock.length / SHOP_PAGE_SIZE));
  const pg = Math.min(Math.max(0, page), pages - 1);
  const slice = stock.slice(pg * SHOP_PAGE_SIZE, (pg + 1) * SHOP_PAGE_SIZE);
  const blocks: Block[] = [
    heading('🏪 Shop', 3),
    para(`💰 ${p.gold} gold — tap to buy:`),
    ...noticesBlocks(p),
  ];
  for (const id of slice) {
    const def = item(id);
    if (!def) continue;
    const owned = countOf(p, id);
    const afford = p.gold >= def.price;
    blocks.push(para([
      {
        type: 'bold',
        text: `${defEmoji(def.kind)} ${def.name} — ${def.price}g${
          owned > 0 ? ` (own ${owned})` : ''
        }`,
      } as RichText,
      { type: 'italic', text: def.desc ? `\n${def.desc}` : '' } as RichText,
    ]));
    blocks.push(buttonsRow([
      afford
        ? cbBtn(`Buy ${def.name}`, encodeCb({ v: 'shop', a: 'buy', arg: id }), 'success')
        : disabledBtn(`${def.name} — too costly`),
    ], 'left'));
  }
  blocks.push(...shopTail(pg, pages, '💱 Switch to selling', -1));
  return { blocks };
}

/** Shared shop tail: pagination + the toggle to the other shop mode. */
function shopTail(pg: number, pages: number, label: string, arg: number): Block[] {
  return [
    pageNav(pg, pages, (n) => encodeCb({ v: 'shop', a: 'p', arg: n })),
    shopFooter(label, arg),
  ];
}

export function renderSell(p: PlayerState, page: number): InputRichMessage {
  const sellable = p.inventory.filter((e) => item(e.id) && !item(e.id)!.unique);
  const pages = Math.max(1, Math.ceil(sellable.length / SHOP_PAGE_SIZE));
  const pg = Math.min(Math.max(0, page), pages - 1);
  const slice = sellable.slice(pg * SHOP_PAGE_SIZE, (pg + 1) * SHOP_PAGE_SIZE);
  const blocks: Block[] = [
    heading('💱 Sell', 3),
    para(`💰 ${p.gold} gold — tap to sell one:`),
    ...noticesBlocks(p),
  ];
  for (const entry of slice) {
    const def = item(entry.id)!;
    blocks.push(para(`${def.name} ×${entry.qty} — sells for ${sellPrice(def.id)}g`));
    blocks.push(
      buttonsRow(
        [cbBtn(`Sell ${def.name}`, encodeCb({ v: 'shop', a: 'sell', arg: def.id }))],
        'left',
      ),
    );
  }
  blocks.push(...shopTail(pg, pages, '🛒 Switch to buying', 0));
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

export function renderForge(p: PlayerState): InputRichMessage {
  const wc = temperCost(p, 'weapon');
  const ac = temperCost(p, 'armor');
  const blocks: Block[] = [
    heading('⚒️ The Forge', 3),
    para(
      "Temper your equipped gear. Each temper grants +8% to that item's own base stats. Max +5 — and the temper stays with the item.",
    ),
    ...noticesBlocks(p),
    para(
      `🗡️ ${p.equipment.weapon ? itemName(p.equipment.weapon) : '—'}: +${
        temperLevel(p, 'weapon')
      }/${MAX_TEMPER}\n` +
        `🛡️ ${p.equipment.armor ? itemName(p.equipment.armor) : '—'}: +${
          temperLevel(p, 'armor')
        }/${MAX_TEMPER}\n` +
        `💰 ${p.gold} gold`,
    ),
  ];
  blocks.push(
    buttonsRow([
      wc
        ? cbBtn(
          `Temper weapon — ${wc.gold}g + ${wc.materialQty}× ${itemName(wc.material)}`,
          encodeCb({ v: 'forge', a: 'w' }),
          'primary',
        )
        : disabledBtn('Weapon fully tempered'),
    ], 'left'),
    buttonsRow([
      ac
        ? cbBtn(
          `Temper armor — ${ac.gold}g + ${ac.materialQty}× ${itemName(ac.material)}`,
          encodeCb({ v: 'forge', a: 'a' }),
          'primary',
        )
        : disabledBtn('Armor fully tempered'),
    ], 'left'),
    buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'forge', a: 'bk' }))]),
  );
  return { blocks };
}

// ── Character sheet ───────────────────────────────────────────────────────

export function renderCharacter(p: PlayerState): InputRichMessage {
  const s = statsOf(p);
  const c = CLASSES[p.classId];
  const xp = xpProgress(p);
  const done = QUESTS.filter((q) => p.quests[q.id]?.status === 'done').length;
  const need = xpForNextLevel(p.level);
  const blocks: Block[] = [
    heading(`${c.emoji} ${p.name} — Lv ${p.level} ${c.name}`, 3),
    ...noticesBlocks(p),
    para(
      `❤️ ${p.hp}/${s.maxHp}  💧 ${p.mp}/${s.maxMp}\n` +
        `⚔️ ATK ${s.atk} · 🛡️ DEF ${s.def}\n` +
        `🔮 MAG ${s.mag} · ✨ RES ${s.res}\n` +
        `💨 SPD ${s.spd} · 🍀 LUK ${s.luck}`,
    ),
    para(
      p.level >= MAX_LEVEL
        ? '✨ XP: MAX'
        : `✨ XP: ${xp.current}/${need} (${pct(xp.current, need)})`,
    ),
    para(
      `💰 ${p.gold} gold\n` +
        `⚔️ Victories: ${p.stats.battlesWon} · ☠️ Deaths: ${p.stats.deaths}\n` +
        `👑 Bosses slain: ${p.stats.bossesSlain} · 📜 Quests done: ${done}`,
    ),
    quote({ type: 'italic', text: c.desc }),
    buttonsRow([
      cbBtn('🎒 Inventory', encodeCb({ v: 'zone', a: 'inv' })),
      cbBtn('⬅️ Back', encodeCb({ v: 'zone', a: 'hm' })),
    ]),
    buttonsRow([cbBtn('🗑️ Delete hero…', encodeCb({ v: 'meta', a: 'reset' }), 'danger')]),
  ];
  return { blocks };
}

// ── Quest log ─────────────────────────────────────────────────────────────

export function renderQuests(p: PlayerState): InputRichMessage {
  const blocks: Block[] = [heading('📜 Quest Log', 3), ...noticesBlocks(p)];
  const mains = QUESTS.filter((q) => q.main);
  const sides = QUESTS.filter((q) => !q.main);
  // A main quest ready to turn in stays the primary card (#15): dropping it
  // hid the only turn-in path for giverless quests (m3 onward) — the log
  // fell through to a prerequisite-locked "next" quest and dead-ended.
  const activeMain = mains.find((q) =>
    ['active', 'turnIn'].includes(p.quests[q.id]?.status ?? 'unavailable')
  );
  if (activeMain) {
    const ready = p.quests[activeMain.id]?.status === 'turnIn';
    blocks.push(para([{ type: 'bold', text: `🏅 Main: ${activeMain.name}` } as RichText]));
    blocks.push(para(questStatusLine(p, activeMain.id)));
    blocks.push(
      buttonsRow(
        [
          cbBtn(
            ready ? '🏁 Ready — view & turn in' : 'View',
            encodeCb({ v: 'quests', a: 'q', arg: activeMain.id }),
          ),
        ],
        'left',
      ),
    );
  } else {
    const next = mains.find((q) => p.quests[q.id]?.status === 'available');
    blocks.push(para(next ? '🟢 A main quest awaits!' : '🏅 The story continues soon…'));
    if (next) {
      blocks.push(
        buttonsRow(
          [cbBtn(`View: ${next.name}`, encodeCb({ v: 'quests', a: 'q', arg: next.id }))],
          'left',
        ),
      );
    }
  }
  const liveSides = sides.filter((q) =>
    ['available', 'active', 'turnIn'].includes(p.quests[q.id]?.status ?? 'unavailable')
  );
  blocks.push(para(`Side quests (${liveSides.length})`));
  for (const q of liveSides.slice(0, 8)) {
    const status = p.quests[q.id]?.status;
    const label = status === 'turnIn' ? '✅ ' : status === 'active' ? '⏳ ' : '🟢 ';
    blocks.push(
      buttonsRow(
        [cbBtn(`${label}${q.name}`, encodeCb({ v: 'quests', a: 'q', arg: q.id }))],
        'left',
      ),
    );
  }
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'zone', a: 'hm' }))]));
  return { blocks };
}

export function renderQuestDetail(p: PlayerState, id: string): InputRichMessage {
  const q: QuestDef | undefined = quest(id);
  const qp = p.quests[id];
  const blocks: Block[] = [];
  if (!q) {
    blocks.push(para('That quest is a mystery even to the Archivist.'));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'quests', a: 'bk' }))]));
    return { blocks };
  }
  blocks.push(heading(`${q.main ? '🏅' : '📜'} ${q.name}`, 4));
  blocks.push(quote({ type: 'italic', text: q.summary }));
  blocks.push(...noticesBlocks(p));
  const status = qp?.status ?? 'unavailable';
  if (status === 'active' || status === 'turnIn') {
    blocks.push(para(questStatusLine(p, id)));
  } else if (status === 'available') {
    blocks.push(para(`✔️ Requires level ${q.level}.`));
  }
  const itemRewards = Object.entries(q.rewards.items ?? {})
    .map(([iid, n]) => ` · ${itemName(iid)}${n > 1 ? ` ×${n}` : ''}`)
    .join('');
  blocks.push(para(`🎁 Rewards: ${q.rewards.xp} XP · ${q.rewards.gold} gold${itemRewards}`));
  const row = [];
  if (status === 'available') {
    row.push(cbBtn('🤝 Accept', encodeCb({ v: 'quests', a: 'a', arg: id }), 'success'));
  }
  if (status === 'turnIn') {
    row.push(cbBtn('🏁 Turn in', encodeCb({ v: 'quests', a: 't', arg: id }), 'success'));
  }
  row.push(cbBtn('⬅️ Back', encodeCb({ v: 'quests', a: 'bk' })));
  blocks.push(buttonsRow(row));
  return { blocks };
}

// ── Death ─────────────────────────────────────────────────────────────────

export function renderDeath(p: PlayerState): InputRichMessage {
  return {
    blocks: [
      banner('💀 You have fallen…'),
      ...noticesBlocks(p),
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
          '🛖 Towns are safe havens: no battles, and arriving fully heals you.\n' +
          '⚔️ Battles — Attack, Skills, Items, Guard, Flee.\n' +
          '📜 Quests — the main story clears the game; side quests pad your purse.\n' +
          '⚒️ Forge — temper gear to +5 for permanent stat boosts.\n' +
          '🚶 Travel — safe havens fully restore you.\n\n' +
          'Everything happens in this one message — /start re-centers it if it ever gets lost.',
      ),
      buttonsRow([cbBtn('⬅️ Back to the game', encodeCb({ v: 'zone', a: 'hm' }), 'primary')]),
    ],
  };
}

// ── Reset confirmation ──────────────────────────────────────────────────

export function renderResetConfirm(p: PlayerState): InputRichMessage {
  return {
    blocks: [
      banner('⚠️ Delete this hero?'),
      ...noticesBlocks(p),
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
      'The Great Flame is guttering — a king split it in half and hoarded its tomorrow. But embers are promises: someone has to carry the last light up the road and find the dawn. Choose who you will be on that road:',
    ),
  ];
  for (const cid of ['warrior', 'mage', 'rogue', 'cleric'] as const) {
    const c = CLASSES[cid];
    blocks.push(para([
      { type: 'bold', text: `${c.emoji} ${c.name} — ${c.tagline}` } as RichText,
      { type: 'italic', text: `\n${c.desc}` } as RichText,
    ]));
    blocks.push(
      buttonsRow(
        [cbBtn(`Play ${c.name}`, encodeCb({ v: 'meta', a: 'pick', arg: cid }), 'primary')],
        'left',
      ),
    );
  }
  return { blocks };
}
