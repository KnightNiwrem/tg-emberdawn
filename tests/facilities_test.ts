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
import { renderZone } from '../src/render/views.ts';

// ── content integrity ────────────────────────────────────────────────────

Deno.test('content integrity: facility ids are unique and resolve', () => {
  assertEquals(new Set(SHOPS.map((s) => s.id)).size, SHOPS.length, 'shop ids must be unique');
  assertEquals(new Set(FORGES.map((f) => f.id)).size, FORGES.length, 'forge ids must be unique');
  for (const s of SHOPS) assertEquals(shop(s.id), s);
  for (const f of FORGES) assertEquals(forge(f.id), f);
});

Deno.test('content integrity: zone services reference real facilities', () => {
  for (const z of ZONES) {
    if (z.services?.shop) {
      assert(shop(z.services.shop), `zone ${z.id}: unknown shop ${z.services.shop}`);
      assertEquals(shopInZone(z.id)?.id, z.services.shop);
    }
    if (z.services?.forge) {
      assert(forge(z.services.forge), `zone ${z.id}: unknown forge ${z.services.forge}`);
      assertEquals(forgeInZone(z.id)?.id, z.services.forge);
    }
  }
});

Deno.test('content integrity: stock items, conditions, and forge bounds resolve', () => {
  for (const s of SHOPS) {
    assert(s.stock.length > 0, `shop ${s.id} has no stock rules`);
    for (const rule of s.stock) {
      assert(rule.items.length > 0, `shop ${s.id}: empty stock rule`);
      for (const id of rule.items) {
        assert(item(id), `shop ${s.id} stocks unknown item ${id}`);
      }
      if (rule.when) {
        const refs = conditionRefs(rule.when);
        for (const q of refs.quests) assert(quest(q), `shop ${s.id}: unknown quest ${q}`);
        for (const i of refs.items) assert(item(i), `shop ${s.id}: unknown item ${i}`);
        for (const z of refs.zones) assert(zone(z), `shop ${s.id}: unknown zone ${z}`);
      }
      if (rule.pricePct !== undefined) {
        assert(rule.pricePct > 0, `shop ${s.id}: pricePct must be positive`);
      }
    }
  }
  for (const f of FORGES) {
    const caps = f.capabilities;
    assert(caps.slots.length > 0, `forge ${f.id} has no temperable slots`);
    assert(
      Number.isInteger(caps.maxTemper) && caps.maxTemper >= 1 && caps.maxTemper <= MAX_TEMPER,
      `forge ${f.id}: maxTemper out of bounds`,
    );
    for (const up of caps.upgrades ?? []) {
      const refs = conditionRefs(up.when);
      for (const q of refs.quests) assert(quest(q), `forge ${f.id}: unknown quest ${q}`);
      if (up.maxTemper !== undefined) {
        assert(
          Number.isInteger(up.maxTemper) && up.maxTemper >= 1 && up.maxTemper <= MAX_TEMPER,
          `forge ${f.id}: upgrade maxTemper out of bounds`,
        );
      }
    }
  }
});

Deno.test('content integrity: safety and services are orthogonal in shipped content', () => {
  // Every orthogonality direction is authored somewhere (#161):
  const matrix = ZONES.map((z) => ({
    id: z.id,
    safe: z.safeHaven,
    shop: z.services?.shop !== undefined,
    forge: z.services?.forge !== undefined,
  }));
  const byId = new Map(matrix.map((m) => [m.id, m]));
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
  for (const m of matrix) {
    const z = zone(m.id)!;
    assertEquals(m.shop, z.services?.shop !== undefined);
    assertEquals(m.forge, z.services?.forge !== undefined);
  }
});

// ── server-side authority ────────────────────────────────────────────────

Deno.test('buying revalidates the local shelf at mutation time', () => {
  const p = createPlayer(700, 'T', 'warrior');
  p.gold = 500;
  // Bram's stall: beginner steel + hearth supplies.
  assert(buy(p, 'c_minor_potion').ok);
  assertEquals(countOf(p, 'c_minor_potion'), 4); // starting kit 3 + purchase
  // A safe haven without a shop refuses (behavioral safe-without-service).
  p.currentZone = 'mirefoot';
  const refused = buy(p, 'c_minor_potion');
  assert(!refused.ok);
  assertEquals(p.gold, 470, 'a refused sale never charges');
  // The wilds refuse too.
  p.currentZone = 'outskirts';
  assert(!buy(p, 'c_minor_potion').ok);
  // A forged item id that no local shelf carries is a non-mutating refusal.
  p.currentZone = 'emberdawn';
  p.quests['m5_arms'] = { status: 'unavailable', counts: [] };
  assert(!buy(p, 'w_warrior_2').ok, 'tier-2 steel is not on the shelf before its beat');
});

Deno.test('forged service callbacks are non-mutating refusals', () => {
  // zone hub taps for absent facilities.
  const p = createPlayer(701, 'T', 'warrior');
  p.currentZone = 'outskirts';
  const sceneBefore = { ...p.scene };
  const shopTap = zoneAction(p, { v: 'zone', a: 'sh' });
  assert(shopTap.toast?.includes('no shop here'));
  assertEquals(p.scene, sceneBefore, 'nothing opened');
  const forgeTap = zoneAction(p, { v: 'zone', a: 'fg' });
  assert(forgeTap.toast?.includes('no forge here'));
  assertEquals(p.scene, sceneBefore);
  // mirefoot: a forge stands, no shop.
  p.currentZone = 'mirefoot';
  assert(zoneAction(p, { v: 'zone', a: 'sh' }).toast?.includes('no shop here'));
  assertEquals(zoneAction(p, { v: 'zone', a: 'fg' }).toast, undefined, 'the forge opens');
  // Shop taps where no shop stands (deep-forged callbacks).
  const forged = createPlayer(702, 'T', 'mage');
  forged.currentZone = 'whisperwood';
  assert(shopAction(forged, { v: 'shop', a: 'buy', arg: 'c_minor_potion' }).toast);
  assertEquals(forged.gold, 50, 'no charge');
  assertEquals(forged.inventory.length, 2, 'no item granted');
});

Deno.test('battles forbid all trade and forge work', () => {
  const p = createPlayer(703, 'T', 'warrior');
  p.gold = 500;
  p.battle = {
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
  assert(!buy(p, 'c_minor_potion').ok);
  assert(!sell(p, 'c_minor_potion').ok);
  assert(!temper(p, 'weapon').ok);
  p.battle = undefined;
  assert(buy(p, 'c_minor_potion').ok);
});

// ── local selling ────────────────────────────────────────────────────────

Deno.test('selling is a shop-counter service, never a remote inventory action', () => {
  const p = createPlayer(704, 'T', 'warrior');
  addItem(p, 'c_minor_potion', 1);
  // No merchant: no sale.
  p.currentZone = 'outskirts';
  assert(!sell(p, 'c_minor_potion').ok);
  assertEquals(countOf(p, 'c_minor_potion'), 4);
  // At a shop: the counter buys.
  p.currentZone = 'emberdawn';
  assert(sell(p, 'c_minor_potion').ok);
  assertEquals(countOf(p, 'c_minor_potion'), 3);
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
  const atBram = resolveStock(wanderer).map((o) => o.itemId);
  assert(atBram.includes('w_warrior_2'), 'the m5-era starter rack carries tier-2');
  assert(!atBram.includes('w_warrior_3'), 'the village stall never scales into regional steel');
  wanderer.currentZone = 'hollowmere';
  const atFerry = resolveStock(wanderer).map((o) => o.itemId);
  assert(atFerry.includes('w_warrior_3'), 'the regional post carries regional steel');
  assert(!atFerry.includes('c_minor_potion'), 'the swamp post stocks mire-grade supplies');
  assert(atFerry.includes('c_antidote'));
});

Deno.test('the starter shop never scales into endgame stock', () => {
  const veteran = createPlayer(707, 'T', 'mage');
  veteran.level = 45;
  veteran.currentZone = 'emberdawn';
  const shelf = resolveStock(veteran).map((o) => o.itemId);
  assert(shelf.includes('w_mage_1'), 'beginner gear stays for returning veterans');
  for (const id of shelf) {
    const d = item(id)!;
    const isGear = d.kind === 'weapon' || d.kind === 'armor' || d.kind === 'trinket';
    if (isGear) {
      assert(
        d.level <= 7,
        `${id} exceeds what a beginner shop ever shelves`,
      );
    }
  }
});

// ── conditional upgrades ─────────────────────────────────────────────────

Deno.test('stock rules upgrade through declarative progression conditions', () => {
  const p = createPlayer(708, 'T', 'warrior');
  p.level = 12; // tier-2 steel is legal from 7
  // Before the beat: no tier-2 rule, no deep-water supplies.
  assertEquals(
    resolveStock(p).some((o) => o.itemId === 'w_warrior_2'),
    false,
  );
  p.quests['m5_arms'] = { status: 'active', counts: [0, 0] };
  assert(resolveStock(p).some((o) => o.itemId === 'w_warrior_2'));
  // Ferryman's deep-water rule opens on the Tyrant's fall.
  p.currentZone = 'hollowmere';
  assert(!resolveStock(p).some((o) => o.itemId === 'c_greater_potion'));
  p.quests['m7_tyrant'] = { status: 'done', counts: [1] };
  assert(resolveStock(p).some((o) => o.itemId === 'c_greater_potion'));
});

Deno.test('local price behavior is authored, disclosed, and charged', () => {
  const p = createPlayer(709, 'T', 'warrior');
  p.level = 45;
  p.quests['m19_ignivar'] = { status: 'done', counts: [1] };
  p.currentZone = 'cinder';
  const crownsteel = resolveStock(p).find((o) => o.itemId === 'w_warrior_8')!;
  const listPrice = item('w_warrior_8')!.price;
  assertEquals(crownsteel.price, Math.round(listPrice * 1.25), 'the authored +25% holds');
  p.gold = crownsteel.price;
  const res = buy(p, 'w_warrior_8');
  assert(res.ok);
  assertEquals(p.gold, 0, 'the shelf price, not the list price, is charged');
});

Deno.test('forge capability bounds temper work; upgrades raise it', () => {
  const p = createPlayer(710, 'T', 'warrior');
  p.level = 12;
  addItem(p, 'm_ember_shard', 30); // tier-1 steel tempers with hearth shards
  p.gold = 100000;
  // The ropewalk forge caps at +3 and matches Bram's work on the pattern.
  p.currentZone = 'mirefoot';
  assertEquals(forgeCapability(p)!.maxTemper, 3);
  assert(temper(p, 'weapon').ok);
  assert(temper(p, 'weapon').ok);
  assert(temper(p, 'weapon').ok);
  assertEquals(temperLevel(p, 'weapon'), 3);
  const capped = temper(p, 'weapon');
  assert(!capped.ok, 'the fourth temper is beyond this forge');
  assert(capped.lines[0]!.includes("beyond this forge's craft"));
  assertEquals(temperCost(p, 'weapon'), undefined);
  // The Shrine's fall brings the deep tools: the upgrade raises the cap.
  p.flags['sunkenCleared'] = true;
  assertEquals(forgeCapability(p)!.maxTemper, 5);
  assert(temper(p, 'weapon').ok);
  assertEquals(temperLevel(p, 'weapon'), 4);
  // The Warden's anvil refuses armor until it bows (#161).
  const atCinder = createPlayer(711, 'T', 'mage');
  atCinder.level = 35;
  addItem(atCinder, 'm_cinder_heart', 30);
  addItem(atCinder, 'm_ember_shard', 10); // tier-1 armor tempers with hearth shards
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
  const p = createPlayer(712, 'T', 'warrior');
  addItem(p, 'm_ember_shard', 40);
  p.gold = 100000;
  for (let i = 0; i < 5; i++) assert(temper(p, 'weapon').ok);
  assertEquals(temperLevel(p, 'weapon'), MAX_TEMPER);
  const blocked = temper(p, 'weapon');
  assert(!blocked.ok, 'fully tempered at the master forge');
  // The same pattern, tempered elsewhere, is already done.
  p.currentZone = 'mirefoot';
  p.flags['sunkenCleared'] = true;
  assert(!temper(p, 'weapon').ok, 'mastery carries: the ropewalk has nothing to add');
});

// ── rendering follows presence ───────────────────────────────────────────

Deno.test('the zone hub renders services only where they exist, by local name', () => {
  const p = createPlayer(713, 'T', 'warrior');
  p.tutorial = 'done';
  p.currentZone = 'outskirts';
  const wilds = JSON.stringify(renderZone(p));
  assert(!wilds.includes('shop'), 'the wilds render no shop');
  assert(!wilds.includes('forge'), 'the wilds render no forge');
  p.currentZone = 'emberdawn';
  const home = JSON.stringify(renderZone(p));
  assert(home.includes("Bram's Forge-stall"), 'the local shop renders by its own name');
  assert(home.includes("Bram's Anvil"), 'the local forge renders by its own name');
  p.currentZone = 'mirefoot';
  const landing = JSON.stringify(renderZone(p));
  assert(landing.includes('The Ropewalk Forge'));
  assert(!landing.includes('🏪'), 'no shop button where no shop stands');
});

Deno.test('drop inventory integrity: selling never touches the bag path', () => {
  // Bag-side ops remain: drop works anywhere, sell only at a counter.
  const p = createPlayer(714, 'T', 'warrior');
  addItem(p, 'c_minor_potion', 2);
  p.currentZone = 'outskirts';
  assert(removeItem(p, 'c_minor_potion', 1));
  assertEquals(countOf(p, 'c_minor_potion'), 4);
  assert(!sell(p, 'c_minor_potion').ok, 'still no remote selling');
});
