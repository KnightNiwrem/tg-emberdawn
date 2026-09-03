/**
 * Hub renderers: zone, travel, shop, forge, character, quests, meta.
 * Pure functions (PlayerState, args) → InputRichMessage. Rich text uses
 * typed entities (bold/italic), never HTML strings.
 */

import type { InputRichBlock, InputRichMessage, RichText } from 'grammy/types';
import type { PlayerState } from '../engine/types.ts';
import type { QuestDef } from '../content/types.ts';
import { npc, npcInZone, quest, questFinisher, QUESTS, questStarter } from '../content/quests.ts';
import { dialogue, dialogueNode } from '../content/dialogues.ts';
import { evalCondition } from '../engine/conditions.ts';
import { npcTopics } from '../engine/npc.ts';
import { CLASSES, MAX_LEVEL, xpForNextLevel } from '../engine/classes.ts';
import { statsOf, xpProgress, xpRewardLabel } from '../engine/character.ts';
import { item, itemName, sellPrice } from '../content/items.ts';
import { currentStock } from '../engine/shops.ts';
import { itemMechanicsLines } from './menus.ts';
import { zone } from '../content/zones.ts';
import { dungeonOf, dungeonProgressLine, nextDiveIsBoss } from '../engine/world.ts';
import { enemy as enemyDef } from '../content/enemies.ts';
import { levelLockedMain, questStatusLine } from '../engine/quests.ts';
import { countOf } from '../engine/inventory.ts';
import { MAX_TEMPER, temperCost, temperLevel } from '../engine/forge.ts';
import { banner, bar, buttonsRow, cbBtn, disabledBtn, heading, para, pct, quote } from './rich.ts';
import { encodeCb } from '../codec.ts';
import { noticesBlocks } from './parts.ts';

type Block = InputRichBlock;

// ── Zone hub (home) ───────────────────────────────────────────────────────

export function renderZone(p: PlayerState): InputRichMessage {
  // Guided prologue (#69): while it runs, the hub renders ONLY the directed
  // action for the current step — travel, explore, shops and the NPC list
  // are withheld until the prologue releases the player into the real hub.
  if (p.tutorial !== 'done' && !p.battle) return renderTutorialHub(p);
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
  if (d) {
    // Authored readiness surfaced (#73): the recommended level rides the
    // dungeon line so the boss's tune point is never a hidden dependency.
    const rec = d.recommendedLevel !== undefined ? ` · Recommended Lv ${d.recommendedLevel}` : '';
    blocks.push(para(`${d.emoji} ${d.name} — ${dungeonProgressLine(p, d)}${rec}`));
  }

  // Under-level boss confirmation (#73): the boss floor is inescapable, so
  // diving into it below the authored readiness level demands an informed,
  // explicit choice — a full-screen warning instead of the action rows.
  if (
    d &&
    p.scene.arg === 'bossok' &&
    nextDiveIsBoss(p, d) &&
    d.recommendedLevel !== undefined &&
    p.level < d.recommendedLevel
  ) {
    const boss = enemyDef(d.boss);
    blocks.push(banner('☠️ Readiness warning'));
    blocks.push(para(
      `${boss?.name ?? 'The boss'} waits at Lv ${
        boss?.level ?? '?'
      }. This fight is tuned for Lv ${d.recommendedLevel} — you are Lv ${p.level} — and bosses cannot be fled: no escape, no Smoke Bomb, only defeat or victory.`,
    ));
    blocks.push(
      buttonsRow([
        cbBtn('⚔️ Face it anyway', encodeCb({ v: 'zone', a: 'dgb' }), 'danger'),
        cbBtn("⬅️ Not yet — I'll prepare", encodeCb({ v: 'zone', a: 'hm' }), 'primary'),
      ]),
    );
    return { blocks };
  }

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
      cbBtn('🏪 Shop', encodeCb({ v: 'zone', a: 'sh' })),
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

// ── Guided prologue (#69) ────────────────────────────────────────────

/** The directed hub: ONE action per prologue step, status panels intact so
 * the player still learns to read their own bars. */
function renderTutorialHub(p: PlayerState): InputRichMessage {
  const s = statsOf(p);
  const c = CLASSES[p.classId];
  const z = zone(p.currentZone)!;
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
  if (p.tutorial === 'maren') {
    blocks.push(banner('🔥 Your tale begins'));
    blocks.push(para(
      "Every Dawncaller starts at the hearth. Elder Maren keeps the village's last ember — and its oldest hope. She is waiting for you.",
    ));
    blocks.push(
      buttonsRow([
        cbBtn('🧓 Speak with Elder Maren', encodeCb({ v: 'tut', a: 'maren' }), 'primary'),
      ]),
    );
  } else {
    // 'outskirts' and 'fight' (re-face after a fled fight) share one panel:
    // the controlled encounter is the only business out here.
    const again = p.tutorial === 'fight';
    blocks.push(banner('🌑 Just outside the village'));
    blocks.push(para(
      again
        ? "The ash settles — the cinder mite is still out there, and Maren's ember still wants its first dawn."
        : 'Past the last hearth-light, the ash stirs: a cinder mite, small and wayward. A perfect first lesson.',
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
export function renderTutorial(p: PlayerState): InputRichMessage {
  return {
    blocks: [
      heading('🧓 Elder Maren', 3),
      ...noticesBlocks(p),
      quote(
        '"The Flame dims a little more each season — but dim is not dark, and we are not done. Take this ember, Dawncaller. A small light is still a light."',
      ),
      para(
        'She nods toward the fields. "A cinder mite has wandered from the ash, just past the hearth-light. It will not greet you politely. Go — and teach it what hope hits like."',
      ),
      buttonsRow([
        cbBtn('🔥 Take the ember and head out', encodeCb({ v: 'tut', a: 'out' }), 'success'),
        cbBtn('⬅️ Not yet', encodeCb({ v: 'zone', a: 'hm' })),
      ]),
    ],
  };
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
    ]));
    // #120: GENERATED mechanics (bag effect + triggers) then optional
    // flavor — visibly separate blocks, numbers only in the mechanics.
    const mech = itemMechanicsLines(def);
    if (mech.length > 0) blocks.push(para(mech.join('\n')));
    if (def.desc) blocks.push(para([{ type: 'italic', text: def.desc } as RichText]));
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
      "Temper your equipped gear. Each temper grants +8% to that item's base stats, up to +5. Mastery binds to the pattern: every copy of this gear you ever own — forged, bought or looted — carries your forge-work.",
    ),
    para(
      '⚡ Triggered item effects are fixed authored data — tempering never changes their chance, potency or duration.',
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

const QUESTS_PAGE_SIZE = 8;

export function renderQuests(p: PlayerState, page = 0): InputRichMessage {
  const blocks: Block[] = [heading('📜 Quest Log', 3), ...noticesBlocks(p)];
  const mains = QUESTS.filter((q) => q.main);
  const sides = QUESTS.filter((q) => !q.main);
  // A main quest ready to turn in stays the primary card (#15): dropping it
  // hid the only visible turn-in path — the log fell through to a
  // prerequisite-locked "next" quest and dead-ended.
  const activeMain = mains.find((q) =>
    ['active', 'turnIn'].includes(p.quests[q.id]?.status ?? 'unavailable')
  );
  if (activeMain) {
    const ready = p.quests[activeMain.id]?.status === 'turnIn';
    blocks.push(para([{ type: 'bold', text: `🏅 Main: ${activeMain.name}` } as RichText]));
    blocks.push(para(questStatusLine(p, activeMain.id)));
    // The journal points at the physical contact (#65) — it never performs
    // the lifecycle action itself.
    if (ready) {
      const fin = questFinisher(activeMain.id);
      if (fin) blocks.push(para(`🏁 Return to ${fin.npc.name} — ${fin.zone.name}.`));
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
    const next = mains.find((q) => p.quests[q.id]?.status === 'available');
    if (next) {
      const st = questStarter(next.id);
      blocks.push(para('🟢 A main quest awaits!'));
      if (st) blocks.push(para(`🤝 Start with ${st.npc.name} — ${st.zone.name}.`));
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
      const locked = levelLockedMain(p);
      if (locked) {
        blocks.push(para([
          { type: 'bold', text: `🔒 Next: ${locked.name}` } as RichText,
          `\nRequires level ${locked.level} — you are ${p.level}. Train in the wilds: the dawn keeps.`,
        ]));
      } else if (mains.every((q) => p.quests[q.id]?.status === 'done')) {
        blocks.push(para('🏅 The story is complete — and the dawn holds.'));
      } else {
        blocks.push(para('🏅 The story continues soon…'));
      }
    }
  }
  const liveSides = sides.filter((q) =>
    ['available', 'active', 'turnIn'].includes(p.quests[q.id]?.status ?? 'unavailable')
  );
  // Pagination (#21): 16 side quests exist and a completionist save can have
  // 9+ live at once — the old slice(0, 8) stranded every later quest behind
  // a page that never rendered.
  const pages = Math.max(1, Math.ceil(liveSides.length / QUESTS_PAGE_SIZE));
  const pg = Math.min(Math.max(0, page), pages - 1);
  const start = pg * QUESTS_PAGE_SIZE;
  blocks.push(para(`Side quests (${liveSides.length})`));
  for (const q of liveSides.slice(start, start + QUESTS_PAGE_SIZE)) {
    const status = p.quests[q.id]?.status;
    const label = status === 'turnIn' ? '✅ ' : status === 'active' ? '⏳ ' : '🟢 ';
    blocks.push(
      buttonsRow(
        [cbBtn(`${label}${q.name}`, encodeCb({ v: 'quests', a: 'q', arg: q.id }))],
        'left',
      ),
    );
  }
  if (pages > 1) {
    blocks.push(pageNav(pg, pages, (n) => encodeCb({ v: 'quests', a: 'p', arg: n })));
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
  // Reward preview reflects the real economy (#42): at the summit the XP
  // portion renders as its conversion, never XP the player cannot receive.
  blocks.push(
    para(
      `🎁 Rewards: ${xpRewardLabel(p.level, q.rewards.xp)} · ${q.rewards.gold} gold${itemRewards}`,
    ),
  );
  // Read-only journal (#65): no lifecycle buttons render here — accepting
  // and turning in happen face-to-face with the quest's configured NPC, in
  // the zone where they stand. The log NAMES that contact instead.
  const starter = questStarter(id);
  const finisher = questFinisher(id);
  if (status === 'available' && starter) {
    blocks.push(para(`🤝 Start with ${starter.npc.name} — ${starter.zone.name}.`));
  }
  if ((status === 'active' || status === 'turnIn') && finisher) {
    blocks.push(
      para(
        status === 'turnIn'
          ? `🏁 Return to ${finisher.npc.name} — ${finisher.zone.name}.`
          : `Finish with ${finisher.npc.name} — ${finisher.zone.name}.`,
      ),
    );
  }
  blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'quests', a: 'bk' }))]));
  return { blocks };
}

/** NPC-interaction quest view (#64): the ONLY surface whose buttons can
 * accept or turn in a quest. Action callbacks carry the npcq view tag, and
 * BOTH the handler and the engine revalidate contact and location before
 * mutating — buttons here are an offer, never the authorization. */
export function renderQuestInteraction(
  p: PlayerState,
  questId: string,
  npcId: string,
): InputRichMessage {
  const q: QuestDef | undefined = quest(questId);
  const blocks: Block[] = [];
  if (!q) {
    blocks.push(para('That quest is a mystery even to the Archivist.'));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'npcq', a: 'bk' }))]));
    return { blocks };
  }
  const talker = npc(npcId);
  blocks.push(heading(`${q.main ? '🏅' : '📜'} ${q.name}`, 4));
  if (talker) {
    blocks.push(quote({ type: 'italic', text: `You speak with ${talker.name}.` }));
  }
  blocks.push(quote({ type: 'italic', text: q.summary }));
  blocks.push(...noticesBlocks(p));
  blocks.push(para(questStatusLine(p, questId)));
  const row = [];
  const status = p.quests[questId]?.status ?? 'unavailable';
  // Buttons render only when this conversation is with the configured
  // contact, standing in this very zone — the engine re-checks anyway.
  if (status === 'available' && npcId === q.startNpc && npcInZone(p.currentZone, q.startNpc)) {
    row.push(cbBtn('🤝 Accept', encodeCb({ v: 'npcq', a: 'a', arg: questId }), 'success'));
  }
  if (status === 'turnIn' && npcId === q.finishNpc && npcInZone(p.currentZone, q.finishNpc)) {
    row.push(cbBtn('🏁 Turn in', encodeCb({ v: 'npcq', a: 't', arg: questId }), 'success'));
  }
  row.push(cbBtn('⬅️ Back', encodeCb({ v: 'npcq', a: 'bk' })));
  blocks.push(buttonsRow(row));
  return { blocks };
}

// ── NPC topic menu (#123) ────────────────────────────────────────────────

/** The NPC topic-selection scene (#123): every currently available topic —
 * ready turn-ins, new offers, active business, authored lore — is rendered
 * as its own row (priority order emphasizes, never suppresses). The
 * default greeting is the concise header, so an NPC with no business still
 * exposes their authored conversation instead of flashing a notice. Pure
 * navigation: nothing here mutates. */
export function renderNpcTopics(p: PlayerState): InputRichMessage {
  const npcId = p.scene.arg ?? '';
  const def = npc(npcId);
  const blocks: Block[] = [];
  if (!def || !npcInZone(p.currentZone, npcId)) {
    blocks.push(para('Nobody there.'));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'npc', a: 'bk' }))]));
    return { blocks };
  }
  if (p.scene.arg2?.startsWith('lore:')) {
    const topic = def.topics?.find((t) => t.id === p.scene.arg2!.slice('lore:'.length));
    blocks.push(heading(`🗣️ ${def.name}`, 4));
    blocks.push(...noticesBlocks(p));
    if (topic?.text) blocks.push(quote({ type: 'italic', text: topic.text }));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'npc', a: 'op', arg: npcId }))]));
    return { blocks };
  }
  if (p.scene.arg2?.startsWith('q:')) {
    const q = quest(p.scene.arg2.slice('q:'.length));
    blocks.push(heading(`🗣️ ${def.name}`, 4));
    blocks.push(...noticesBlocks(p));
    if (q) {
      blocks.push(para([{ type: 'bold', text: q.name } as RichText]));
      blocks.push(para(questStatusLine(p, q.id)));
    }
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'npc', a: 'op', arg: npcId }))]));
    return { blocks };
  }
  blocks.push(heading(`🗣️ ${def.name}`, 4));
  blocks.push(quote({ type: 'italic', text: def.greeting }));
  blocks.push(...noticesBlocks(p));
  const topics = npcTopics(p, npcId);
  if (topics.length > 0) blocks.push(para('Choose a topic:'));
  for (const t of topics) {
    blocks.push(
      buttonsRow([
        cbBtn(
          t.label,
          encodeCb({ v: 'npc', a: t.kind === 'lore' ? 'lore' : 'q', arg: t.id }),
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
export function renderDialogue(p: PlayerState): InputRichMessage {
  const d = dialogue(p.scene.arg ?? '');
  const blocks: Block[] = [];
  const npcDef = d ? npc(d.npcId) : undefined;
  if (!d || !npcDef || !npcInZone(p.currentZone, d.npcId)) {
    blocks.push(para('That conversation has moved on.'));
    blocks.push(buttonsRow([cbBtn('⬅️ Back', encodeCb({ v: 'dlg', a: 'bk' }))]));
    return { blocks };
  }
  const node = dialogueNode(d, p.scene.arg2 ?? '') ?? dialogueNode(d, d.start)!;
  blocks.push(heading(`🗣️ ${npcDef.name}`, 4));
  blocks.push(...noticesBlocks(p));
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
    if (p.scene.arg3?.startsWith('confirm:')) {
      const choice = node.choices.find((c) => c.id === p.scene.arg3!.slice('confirm:'.length));
      if (choice) {
        blocks.push(banner('⚠️ This decision cannot be changed'));
        blocks.push(quote(`You — “${choice.label}”`));
        blocks.push(para('Once confirmed, this choice is permanent. There is no undo.'));
        if (choice.consequenceHint) {
          blocks.push(para({ type: 'italic', text: choice.consequenceHint } as RichText));
        }
        blocks.push(
          buttonsRow([
            cbBtn(
              `✅ Confirm: ${choice.label}`,
              encodeCb({ v: 'dlg', a: 'cf', arg: choice.id }),
              'danger',
            ),
            cbBtn('✋ Go back', encodeCb({ v: 'dlg', a: 'cc' })),
          ]),
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
    for (const c of node.choices) {
      if (c.when && !evalCondition(p, c.when)) continue;
      blocks.push(
        buttonsRow([cbBtn(c.label, encodeCb({ v: 'dlg', a: 'ch', arg: c.id }))], 'left'),
      );
    }
    if (node.allowDeferral !== false) {
      blocks.push(buttonsRow([cbBtn('✋ Not now', encodeCb({ v: 'dlg', a: 'bk' }))]));
    }
    return { blocks };
  }
  // End node: the conversation concluded — only the exit remains.
  blocks.push(buttonsRow([cbBtn('👋 End conversation', encodeCb({ v: 'dlg', a: 'bk' }))]));
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
          '⚔️ Battles — your free action, Skills, Items, Guard, Flee. Free actions are class-typed: Warrior/Rogue attack with ATK, Mage/Cleric with MAG. SPD pays off: outspeeding a foe slips its damaging blows aside (baseline 2%, hard cap 20%).\n' +
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
      para(
        `Opens with ${c.basicAction.name} (free) and ${c.startingKit}. ${c.tradeoff} Complexity: ${c.complexity}.${
          c.beginnerPick ? ' ⭐ The forgiving first pick.' : ''
        }`,
      ),
    );
    blocks.push(
      buttonsRow(
        [cbBtn(`Play ${c.name}`, encodeCb({ v: 'meta', a: 'pick', arg: cid }), 'primary')],
        'left',
      ),
    );
  }
  return { blocks };
}
