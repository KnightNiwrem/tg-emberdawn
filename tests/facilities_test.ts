/**
 * #161 — location-scoped shops, forges, and facility upgrades: content
 * integrity, safety/service orthogonality, server-side authority, local
 * selling, and conditional upgrades.
 */

import { assert, assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import {
  forgeCapability,
  MAX_TEMPER,
  temper,
  temperCost,
  temperLevel,
} from '../src/engine/forge.ts';
import { addItem, countOf, removeItem } from '../src/engine/inventory.ts';
import { buy, resolveStock, sell } from '../src/engine/shops.ts';
import { shopAction, zoneAction } from '../src/handlers/hub.ts';
import { decodeCb } from '../src/codec.ts';
import { forge, forgeInZone, FORGES, shop, shopInZone, SHOPS } from '../src/content/facilities.ts';
import { item } from '../src/content/items.ts';
import { quest } from '../src/content/quests.ts';
import { zone, ZONES } from '../src/content/zones.ts';
import { conditionRefs } from '../src/engine/conditions.ts';
import { renderForge, renderShop, renderZone } from '../src/render/views.ts';

// ── content integrity ────────────────────────────────────────────────────

Deno.test('content integrity: facility ids are unique and resolve', () => {
  assertEquals(
    new Set(SHOPS.map((shopDef) => shopDef.id)).size,
    SHOPS.length,
    'shop ids must be unique',
  );
  assertEquals(
    new Set(FORGES.map((forgeDef) => forgeDef.id)).size,
    FORGES.length,
    'forge ids must be unique',
  );
  for (const shopDef of SHOPS) assertEquals(shop(shopDef.id), shopDef);
  for (const forgeDef of FORGES) assertEquals(forge(forgeDef.id), forgeDef);
});

Deno.test('content integrity: zone services reference real facilities', () => {
  for (const zoneDef of ZONES) {
    if (zoneDef.services?.shop) {
      assert(
        shop(zoneDef.services.shop),
        `zone ${zoneDef.id}: unknown shop ${zoneDef.services.shop}`,
      );
      assertEquals(shopInZone(zoneDef.id)?.id, zoneDef.services.shop);
    }
    if (zoneDef.services?.forge) {
      assert(
        forge(zoneDef.services.forge),
        `zone ${zoneDef.id}: unknown forge ${zoneDef.services.forge}`,
      );
      assertEquals(forgeInZone(zoneDef.id)?.id, zoneDef.services.forge);
    }
  }
});

Deno.test('content integrity: stock items, conditions, and forge bounds resolve', () => {
  for (const shopDef of SHOPS) {
    assert(shopDef.stock.length > 0, `shop ${shopDef.id} has no stock rules`);
    for (const rule of shopDef.stock) {
      assert(rule.items.length > 0, `shop ${shopDef.id}: empty stock rule`);
      for (const id of rule.items) {
        assert(item(id), `shop ${shopDef.id} stocks unknown item ${id}`);
      }
      if (rule.when) {
        const refs = conditionRefs(rule.when);
        for (const questId of refs.quests) {
          assert(quest(questId), `shop ${shopDef.id}: unknown quest ${questId}`);
        }
        for (const itemId of refs.items) {
          assert(item(itemId), `shop ${shopDef.id}: unknown item ${itemId}`);
        }
        for (const zoneId of refs.zones) {
          assert(zone(zoneId), `shop ${shopDef.id}: unknown zone ${zoneId}`);
        }
      }
      if (rule.pricePct !== undefined) {
        assert(rule.pricePct > 0, `shop ${shopDef.id}: pricePct must be positive`);
      }
    }
  }
  for (const forgeDef of FORGES) {
    const caps = forgeDef.capabilities;
    assert(caps.slots.length > 0, `forge ${forgeDef.id} has no temperable slots`);
    assert(
      Number.isInteger(caps.maxTemper) && caps.maxTemper >= 1 && caps.maxTemper <= MAX_TEMPER,
      `forge ${forgeDef.id}: maxTemper out of bounds`,
    );
    for (const up of caps.upgrades ?? []) {
      const refs = conditionRefs(up.when);
      for (const questId of refs.quests) {
        assert(quest(questId), `forge ${forgeDef.id}: unknown quest ${questId}`);
      }
      if (up.maxTemper !== undefined) {
        assert(
          Number.isInteger(up.maxTemper) && up.maxTemper >= 1 && up.maxTemper <= MAX_TEMPER,
          `forge ${forgeDef.id}: upgrade maxTemper out of bounds`,
        );
      }
    }
  }
});

Deno.test('content integrity: safety and services are orthogonal in shipped content', () => {
  // Every orthogonality direction is authored somewhere (#161):
  const matrix = ZONES.map((zoneDef) => ({
    id: zoneDef.id,
    safe: zoneDef.safeHaven,
    shop: zoneDef.services?.shop !== undefined,
    forge: zoneDef.services?.forge !== undefined,
  }));
  const byId = new Map(matrix.map((capabilities) => [capabilities.id, capabilities]));
  assert(byId.get('emberdawn')!.safe && byId.get('emberdawn')!.shop);
  assert(byId.get('emberdawn')!.forge, 'the starter village keeps its forge');
  assert(
    byId.get('mirefoot')!.safe && !byId.get('mirefoot')!.shop,
    'a safe haven may lack a shop entirely',
  );
  assert(
    !byId.get('hollowmere')!.safe && byId.get('hollowmere')!.shop,
    'a danger zone may exceptionally host a shop',
  );
  assert(
    !byId.get('cinder')!.safe && byId.get('cinder')!.forge,
    'a danger zone may exceptionally host a forge',
  );
  assert(
    !byId.get('outskirts')!.shop && !byId.get('outskirts')!.forge,
    'the wilds have no services',
  );
  // And no code path could have derived these: the services are authored
  // per zone, exactly as the catalog carries them.
  for (const capabilities of matrix) {
    const zoneDef = zone(capabilities.id)!;
    assertEquals(capabilities.shop, zoneDef.services?.shop !== undefined);
    assertEquals(capabilities.forge, zoneDef.services?.forge !== undefined);
  }
});

// ── server-side authority ────────────────────────────────────────────────

Deno.test('buying revalidates the local shelf at mutation time', () => {
  const player = createPlayer(700, 'T', 'warrior');
  player.gold = 500;
  // Bram's stall: beginner steel + hearth supplies.
  assert(buy(player, 'c_minor_potion').ok);
  assertEquals(countOf(player, 'c_minor_potion'), 4); // starting kit 3 + purchase
  // A safe haven without a shop refuses (behavioral safe-without-service).
  player.currentZone = 'mirefoot';
  const refused = buy(player, 'c_minor_potion');
  assert(!refused.ok);
  assertEquals(player.gold, 470, 'a refused sale never charges');
  // The wilds refuse too.
  player.currentZone = 'outskirts';
  assert(!buy(player, 'c_minor_potion').ok);
  // A forged item id that no local shelf carries is a non-mutating refusal.
  player.currentZone = 'emberdawn';
  player.quests['m5_arms'] = { status: 'unavailable', counts: [] };
  assert(!buy(player, 'w_warrior_2').ok, 'tier-2 steel is not on the shelf before its beat');
});

Deno.test('forged service callbacks are non-mutating refusals', () => {
  // zone hub taps for absent facilities.
  const player = createPlayer(701, 'T', 'warrior');
  player.currentZone = 'outskirts';
  const sceneBefore = { ...player.scene };
  const shopTap = zoneAction(player, { v: 'zone', a: 'sh' });
  assert(shopTap.toast?.includes('no shop here'));
  assertEquals(player.scene, sceneBefore, 'nothing opened');
  const forgeTap = zoneAction(player, { v: 'zone', a: 'fg' });
  assert(forgeTap.toast?.includes('no forge here'));
  assertEquals(player.scene, sceneBefore);
  // mirefoot: a forge stands, no shop.
  player.currentZone = 'mirefoot';
  assert(zoneAction(player, { v: 'zone', a: 'sh' }).toast?.includes('no shop here'));
  assertEquals(zoneAction(player, { v: 'zone', a: 'fg' }).toast, undefined, 'the forge opens');
  // Shop taps where no shop stands (deep-forged callbacks).
  const forged = createPlayer(702, 'T', 'mage');
  forged.currentZone = 'whisperwood';
  assert(shopAction(forged, { v: 'shop', a: 'buy', arg: 'c_minor_potion' }).toast);
  assertEquals(forged.gold, 50, 'no charge');
  assertEquals(forged.inventory.length, 2, 'no item granted');
});

Deno.test('battles forbid all trade and forge work', () => {
  const player = createPlayer(703, 'T', 'warrior');
  player.gold = 500;
  player.battle = {
    enemy: { id: 'e_rat', name: 'Rat', hp: 10, maxHp: 10, isBoss: false, turn: 1 },
    phase: 'active',
    round: 1,
    cooldowns: {},
    guarding: false,
    effectInstances: [],
    effectSeq: 0,
    shield: { player: 0, enemy: 0 },
    history: [],
    phoenixUsed: false,
    origin: { kind: 'explore', zoneId: 'emberdawn' },
  };
  assert(!buy(player, 'c_minor_potion').ok);
  assert(!sell(player, 'c_minor_potion').ok);
  assert(!temper(player, 'weapon').ok);
  player.battle = undefined;
  assert(buy(player, 'c_minor_potion').ok);
});

// ── local selling ────────────────────────────────────────────────────────

Deno.test('selling is a shop-counter service, never a remote inventory action', () => {
  const player = createPlayer(704, 'T', 'warrior');
  addItem(player, 'c_minor_potion', 1);
  // No merchant: no sale.
  player.currentZone = 'outskirts';
  assert(!sell(player, 'c_minor_potion').ok);
  assertEquals(countOf(player, 'c_minor_potion'), 4);
  // At a shop: the counter buys.
  player.currentZone = 'emberdawn';
  assert(sell(player, 'c_minor_potion').ok);
  assertEquals(countOf(player, 'c_minor_potion'), 3);
  // The generic inventory can no longer even EXPRESS a sale: the codec
  // refuses the wire form and the handler has no sell op.
  assertEquals(decodeCb('i:sell:c_minor_potion'), undefined);
  // A safe haven without a shop refuses too.
  const atLanding = createPlayer(705, 'T', 'mage');
  addItem(atLanding, 'c_minor_ether', 1);
  atLanding.currentZone = 'mirefoot';
  assert(!sell(atLanding, 'c_minor_ether').ok);
});

// ── different shops at the same level ────────────────────────────────────

Deno.test('two shops at the same player level expose genuinely different catalogs', () => {
  const wanderer = createPlayer(706, 'T', 'warrior');
  wanderer.level = 13;
  wanderer.quests['m5_arms'] = { status: 'done', counts: [] }; // the starter rack's era has passed
  wanderer.currentZone = 'emberdawn';
  const atBram = resolveStock(wanderer).map((offering) => offering.itemId);
  assert(atBram.includes('w_warrior_2'), 'the m5-era starter rack carries tier-2');
  assert(!atBram.includes('w_warrior_3'), 'the village stall never scales into regional steel');
  wanderer.currentZone = 'hollowmere';
  const atFerry = resolveStock(wanderer).map((offering) => offering.itemId);
  assert(atFerry.includes('w_warrior_3'), 'the regional post carries regional steel');
  assert(!atFerry.includes('c_minor_potion'), 'the swamp post stocks mire-grade supplies');
  assert(atFerry.includes('c_antidote'));
});

Deno.test('the starter shop never scales into endgame stock', () => {
  const veteran = createPlayer(707, 'T', 'mage');
  veteran.level = 45;
  veteran.currentZone = 'emberdawn';
  const shelf = resolveStock(veteran).map((offering) => offering.itemId);
  assert(shelf.includes('w_mage_1'), 'beginner gear stays for returning veterans');
  for (const id of shelf) {
    const itemDef = item(id)!;
    const isGear = itemDef.kind === 'weapon' || itemDef.kind === 'armor' ||
      itemDef.kind === 'trinket';
    if (isGear) {
      assert(
        itemDef.level <= 7,
        `${id} exceeds what a beginner shop ever shelves`,
      );
    }
  }
});

// ── conditional upgrades ─────────────────────────────────────────────────

Deno.test('stock rules upgrade through declarative progression conditions', () => {
  const player = createPlayer(708, 'T', 'warrior');
  player.level = 12; // tier-2 steel is legal from 7
  // Before the beat: no tier-2 rule, no deep-water supplies.
  assertEquals(
    resolveStock(player).some((offering) => offering.itemId === 'w_warrior_2'),
    false,
  );
  player.quests['m5_arms'] = { status: 'active', counts: [0, 0] };
  assert(resolveStock(player).some((offering) => offering.itemId === 'w_warrior_2'));
  // Ferryman's deep-water rule opens on the Tyrant's fall.
  player.currentZone = 'hollowmere';
  assert(!resolveStock(player).some((offering) => offering.itemId === 'c_greater_potion'));
  player.quests['m7_tyrant'] = { status: 'done', counts: [1] };
  assert(resolveStock(player).some((offering) => offering.itemId === 'c_greater_potion'));
});

Deno.test('local price behavior is authored, disclosed, and charged', () => {
  const player = createPlayer(709, 'T', 'warrior');
  player.level = 45;
  player.quests['m19_ignivar'] = { status: 'done', counts: [1] };
  player.currentZone = 'cinder';
  const crownsteel = resolveStock(player).find((offering) => offering.itemId === 'w_warrior_8')!;
  const listPrice = item('w_warrior_8')!.price;
  assertEquals(crownsteel.price, Math.round(listPrice * 1.25), 'the authored +25% holds');
  player.gold = crownsteel.price;
  const res = buy(player, 'w_warrior_8');
  assert(res.ok);
  assertEquals(player.gold, 0, 'the shelf price, not the list price, is charged');
});

Deno.test('forge capability bounds temper work; upgrades raise it', () => {
  const player = createPlayer(710, 'T', 'warrior');
  player.level = 12;
  addItem(player, 'm_ember_shard', 30); // tier-1 steel tempers with hearth shards
  addItem(player, 'm_hardwood', 30);
  addItem(player, 'm_plant_fiber', 30);
  player.gold = 100000;
  // The ropewalk forge caps at +3 and matches Bram's work on the pattern.
  player.currentZone = 'mirefoot';
  assertEquals(forgeCapability(player)!.maxTemper, 3);
  assert(temper(player, 'weapon').ok);
  assert(temper(player, 'weapon').ok);
  assert(temper(player, 'weapon').ok);
  assertEquals(temperLevel(player, 'weapon'), 3);
  const capped = temper(player, 'weapon');
  assert(!capped.ok, 'the fourth temper is beyond this forge');
  assert(capped.lines[0]!.includes("beyond this forge's craft"));
  assertEquals(temperCost(player, 'weapon'), undefined);
  // The Shrine's fall brings the deep tools: the upgrade raises the cap.
  player.flags['sunkenCleared'] = true;
  assertEquals(forgeCapability(player)!.maxTemper, 5);
  assert(temper(player, 'weapon').ok);
  assertEquals(temperLevel(player, 'weapon'), 4);
  // The Warden's anvil refuses armor until it bows (#161).
  const atCinder = createPlayer(711, 'T', 'mage');
  atCinder.level = 35;
  addItem(atCinder, 'm_cinder_heart', 30);
  addItem(atCinder, 'm_ember_shard', 10); // tier-1 armor tempers with hearth shards
  addItem(atCinder, 'm_hardwood', 10);
  addItem(atCinder, 'm_plant_fiber', 10);
  atCinder.gold = 100000;
  atCinder.currentZone = 'cinder';
  const armorBefore = temper(atCinder, 'armor');
  assert(!armorBefore.ok);
  assert(armorBefore.lines[0]!.includes("doesn't work armor"));
  assertEquals(forgeCapability(atCinder)!.slots.has('armor'), false);
  atCinder.flags['pyreCleared'] = true;
  assertEquals(forgeCapability(atCinder)!.slots.has('armor'), true);
  assertEquals(forgeCapability(atCinder)!.maxTemper, 5);
  assert(temper(atCinder, 'armor').ok);
  // Mastery itself is untouched by location (#24): the pattern stays +1.
  assertEquals(temperLevel(atCinder, 'armor'), 1);
});

Deno.test('full forge reaches +5; mastery carries across forges', () => {
  const player = createPlayer(712, 'T', 'warrior');
  addItem(player, 'm_ember_shard', 40);
  addItem(player, 'm_hardwood', 40);
  addItem(player, 'm_plant_fiber', 40);
  player.gold = 100000;
  for (let i = 0; i < 5; i++) assert(temper(player, 'weapon').ok);
  assertEquals(temperLevel(player, 'weapon'), MAX_TEMPER);
  const blocked = temper(player, 'weapon');
  assert(!blocked.ok, 'fully tempered at the master forge');
  // The same pattern, tempered elsewhere, is already done.
  player.currentZone = 'mirefoot';
  player.flags['sunkenCleared'] = true;
  assert(!temper(player, 'weapon').ok, 'mastery carries: the ropewalk has nothing to add');
});

// ── rendering follows presence ───────────────────────────────────────────

Deno.test('the hub shows available services and their panels retain local names', () => {
  const player = createPlayer(713, 'T', 'warrior');
  player.tutorial = 'done';
  player.currentZone = 'outskirts';
  const wilds = JSON.stringify(renderZone(player));
  assert(!wilds.includes('shop'), 'the wilds render no shop');
  assert(!wilds.includes('forge'), 'the wilds render no forge');
  player.currentZone = 'emberdawn';
  const home = JSON.stringify(renderZone(player));
  assert(home.includes('🏪 Shop'), 'the local shop has a compact hub control');
  assert(home.includes('⚒️ Temper'), 'the local forge has a compact hub control');
  assert(JSON.stringify(renderShop(player, 0)).includes("Bram's Forge-stall"));
  assert(JSON.stringify(renderForge(player)).includes("Bram's Anvil"));
  player.currentZone = 'mirefoot';
  const landing = JSON.stringify(renderZone(player));
  assert(landing.includes('⚒️ Temper'));
  assert(JSON.stringify(renderForge(player)).includes('The Ropewalk Forge'));
  assert(!landing.includes('🏪'), 'no shop button where no shop stands');
});

Deno.test('drop inventory integrity: selling never touches the bag path', () => {
  // Bag-side ops remain: drop works anywhere, sell only at a counter.
  const player = createPlayer(714, 'T', 'warrior');
  addItem(player, 'c_minor_potion', 2);
  player.currentZone = 'outskirts';
  assert(removeItem(player, 'c_minor_potion', 1));
  assertEquals(countOf(player, 'c_minor_potion'), 4);
  assert(!sell(player, 'c_minor_potion').ok, 'still no remote selling');
});
