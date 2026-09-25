/** Ordinary fights: menu navigation, paid actions, victory, escape, and recovery. */
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  completePrologue,
  findButton,
  type Player,
  travelTo,
  winBattle,
  withPlayer,
  withRoll,
} from './harness.ts';

function pools(text: string): { hp: number; maxHp: number; mp: number; maxMp: number } {
  const health = text.match(/❤️ (\d+)\/(\d+)/);
  const mana = text.match(/💧 (\d+)\/(\d+)/);
  assert(health && mana, `expected visible HP and MP:\n${text}`);
  return { hp: +health[1], maxHp: +health[2], mp: +mana[1], maxMp: +mana[2] };
}

async function battlePools(player: Player) {
  const text = await player.screenText();
  assertStringIncludes(text, 'YOU ·');
  return pools(text.split('YOU ·')[1]);
}

async function meetBoar(player: Player): Promise<void> {
  await travelTo(player, 'Emberdawn Outskirts');
  // The ordinary level-3 boar gives room to exercise several combat actions.
  await withRoll(0.57, () => player.tap('Explore'));
  assertStringIncludes(await player.screenText(), 'Boar · Lv 3');
  assertStringIncludes(await player.screenText(), 'Battle · Round 1');
}

Deno.test('e2e: browse battle menus, guard, cast, heal, and collect a victory', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Warrior');
    await meetBoar(player);
    const opening = await battlePools(player);
    await player.tap('Skills');
    assertStringIncludes(await player.screenText(), 'MP 35/35');
    await player.tap('Back to battle');
    await player.tap('Items');
    assertStringIncludes(await player.screenText(), 'Minor Potion ×3');
    await player.tap('Back to battle');
    assertStringIncludes(await player.screenText(), 'Battle · Round 1');
    assertEquals(await battlePools(player), opening, 'browsing costs no turn or resources');

    await player.tap('Guard');
    assertStringIncludes(await player.screenText(), 'Battle · Round 2');
    assertStringIncludes(await player.screenText(), 'Round 1 result');
    assert((await battlePools(player)).hp < opening.hp, 'the enemy has acted');
    await player.tap('Skills');
    await player.tap('Cleave — 4 MP');
    assertStringIncludes(await player.screenText(), 'Battle · Round 3');
    assertEquals((await battlePools(player)).mp, opening.mp - 4);
    const injured = await battlePools(player);
    await player.tap('Items');
    await player.tap('Use Minor Potion');
    assertStringIncludes(await player.screenText(), 'Battle · Round 4');
    assert((await battlePools(player)).hp > injured.hp, 'the potion restores health');
    await player.tap('Items');
    assertStringIncludes(await player.screenText(), 'Minor Potion ×2');
    await player.tap('Back to battle');
    await winBattle(player, 'Strike');
    const victory = await player.screenText();
    assertStringIncludes(victory, 'Spoils:');
    assertStringIncludes(victory, 'Earlier battle history');
    assertEquals(await player.labels(), ['➡️ Continue']);
    await player.tap('Continue');
    assertStringIncludes(await player.screenText(), 'Emberdawn Outskirts');
    await player.tap('Character');
    assertStringIncludes(await player.screenText(), 'Victories: 2');
    await player.tap('Back');
    await travelTo(player, 'Emberdawn Village');
    const rested = pools(await player.screenText());
    assertEquals(rested.hp, rested.maxHp);
    assertEquals(rested.mp, rested.maxMp);
    assertEquals((await player.botMessages()).length, 1);
  });
});

Deno.test('e2e: a failed flee costs a round, then a Smoke Bomb permits another encounter', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Rogue');
    await meetBoar(player);
    const opening = await battlePools(player);
    await withRoll(0.99, () => player.tap('Flee'));
    assertStringIncludes(await player.screenText(), 'Battle · Round 2');
    assert((await battlePools(player)).hp < opening.hp);
    await player.tap('Items');
    await player.tap('Use Smoke Bomb');
    assertStringIncludes(await player.screenText(), 'Emberdawn Outskirts');
    assert(!(await player.labels()).includes('➡️ Continue'));
    await player.tap('Inventory');
    assert(!(await player.labels()).some((label) => label.includes('Smoke Bomb')));
    await player.tap('Back');
    await player.tap('Character');
    assertStringIncludes(await player.screenText(), 'Victories: 1');
    await player.tap('Back');
    await withRoll(0.1, () => player.tap('Explore'));
    assertStringIncludes(await player.screenText(), 'Battle · Round 1');
    assertStringIncludes(await player.screenText(), 'Ember Rat');
    await winBattle(player, 'Quick Attack');
    await player.tap('Continue');
    assertStringIncludes(await player.screenText(), 'Emberdawn Outskirts');
  });
});

Deno.test('e2e: defeat, rise at the haven, and set out to fight again', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Mage');
    const gold = +(await player.screenText()).match(/💰 (\d+)/)![1];
    await meetBoar(player);
    // Guarding never hurts the enemy. The bounded sequence plays a real defeat.
    for (let round = 0; round < 60 && !(await player.labels()).includes('🕯️ Rise again'); round++) {
      await player.tap('Guard');
    }
    assertStringIncludes(await player.screenText(), 'You have fallen');
    assertEquals(await player.labels(), ['🕯️ Rise again']);
    await player.tap('Rise again');
    const haven = await player.screenText();
    assertStringIncludes(haven, 'Emberdawn Village');
    assertStringIncludes(haven, `💰 ${gold - Math.floor(gold * 0.1)}`);
    const restored = pools(haven);
    assertEquals(restored.hp, restored.maxHp);
    assertEquals(restored.mp, restored.maxMp);
    await player.tap('Character');
    assertStringIncludes(await player.screenText(), 'Deaths: 1');
    await player.tap('Back');
    await travelTo(player, 'Emberdawn Outskirts');
    await withRoll(0.1, () => player.tap('Explore'));
    await winBattle(player, 'Arcane Bolt');
    await player.tap('Continue');
    assertStringIncludes(await player.screenText(), 'Emberdawn Outskirts');
  });
});

Deno.test('e2e: exhaust healing MP, replenish with an ether, and cast again', async () => {
  await withPlayer(async (player) => {
    await completePrologue(player, 'Cleric');
    await meetBoar(player);
    await player.tap('Guard');
    const openingMp = (await battlePools(player)).mp;
    const healingCasts = Math.floor(openingMp / 8);
    for (let castsUsed = 0; castsUsed < healingCasts; castsUsed++) {
      await player.tap('Skills');
      await player.tap('Mend Wounds — 8 MP');
    }
    const spent = await battlePools(player);
    assertEquals(spent.mp, openingMp % 8);
    await player.tap('Skills');
    assertEquals(findButton(await player.screen(), 'Mend Wounds — 8 MP').disabled, true);
    await player.tap('Back to battle');
    assertEquals(
      await battlePools(player),
      spent,
      'inspecting the unavailable skill costs nothing',
    );
    await player.tap('Items');
    await player.tap('Use Minor Ether');
    const recovered = await battlePools(player);
    assert(recovered.mp > spent.mp);
    await player.tap('Items');
    assert(!(await player.labels()).includes('Use Minor Ether'), 'the only ether was spent');
    await player.tap('Back to battle');
    await player.tap('Skills');
    await player.tap('Mend Wounds — 8 MP');
    assertEquals((await battlePools(player)).mp, recovered.mp - 8);
    await withRoll(0, () => player.tap('Flee'));
    assertStringIncludes(await player.screenText(), 'Emberdawn Outskirts');
  });
});
