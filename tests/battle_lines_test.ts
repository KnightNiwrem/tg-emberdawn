/** #153: authored battle narration (`EffectSpec.line`) stays qualitative.
 * The exact mechanics — damage, percentages, durations, battle lifetime —
 * live in the structured effect specs and surface exactly once through the
 * generated summaries and live effect rows; authored lines name the visible
 * event or status, never a second rules block. `{n}` remains derived from
 * actual resolution: a test alters a structured fixture value and proves the
 * rendered number follows it. A narrowly scoped integrity check rejects the
 * duplicated-mechanical-number patterns in authored lines — this is a
 * single-source-of-truth check, not a prose-style gate. */

import { assert, assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { performAction, startBattle } from '../src/engine/combat.ts';
import type { BattleState, PlayerState } from '../src/engine/types.ts';
import { renderBattle } from '../src/render/battle.ts';
import { ENEMIES } from '../src/content/enemies.ts';
import { item, ITEMS } from '../src/content/items.ts';
import { SKILLS } from '../src/content/skills.ts';
import type { EffectSpec } from '../src/content/types.ts';
import { seeded } from './helpers.ts';

const ORIGIN = { kind: 'explore', zoneId: 'whisperwood' } as const;

/** A tanky wolf so multi-round fixtures survive the hero's strikes. */
function tankyWolf(p: PlayerState, seed: number): BattleState {
  const b = startBattle('e_wolf', ORIGIN, { player: p, rng: seeded(seed) })!.battle;
  b.enemy.hp = 99999;
  b.enemy.maxHp = 99999;
  p.battle = b;
  return b;
}

/** The one authored line in a narration bundle that mentions `marker`. */
function narrativeLine(lines: readonly string[], marker: string): string {
  const hit = lines.find((l) => l.includes(marker));
  assert(hit !== undefined, `expected a line mentioning "${marker}", got: ${lines.join('\n')}`);
  return hit;
}

/** A line is qualitative when it carries no literal number: the mechanics
 * live in the spec, so narration naming an event or status needs none. */
function assertQualitative(line: string): void {
  assertEquals(
    /\d/.test(line),
    false,
    `authored narration carries a literal number (#153): "${line}"`,
  );
}

Deno.test('periodic trigger narration is qualitative; the live row carries the numbers (#153)', () => {
  // Ember Sigil (t_3): the trigger answers enemy HP damage with a burn.
  // Gates removed for determinism; the catalog fixture is restored after.
  const sigil = item('t_3')!;
  const original = sigil.triggers;
  sigil.triggers = [{
    ...original![0],
    chance: 1,
    maxProcs: 99,
  }];
  try {
    const p = createPlayer(1500, 'T', 'warrior');
    p.level = 30;
    p.equipment.trinket = 't_3';
    const b = tankyWolf(p, 1);
    const res = performAction(p, b, { kind: 'attack' }, seeded(2));
    const burn = b.effectInstances.find((i) => i.defId === 't_3:t0:e0');
    assert(burn, 'the Ember Burn instance landed');
    assertEquals(burn.perRound, -6);
    assertEquals(burn.remaining, 1, 'one end-of-round tick has run by the next round');
    assertQualitative(narrativeLine(res.lines, 'The Ember Sigil flares'));
    // The generated live row states the exact mechanics once, derived from
    // the instance — not from the narration.
    const rendered = JSON.stringify(renderBattle(p));
    assert(rendered.includes('−6 HP/round'), 'the row derives the per-round damage');
    assert(rendered.includes('1 round remaining'), 'the row derives the duration');
  } finally {
    sigil.triggers = original;
  }
});

Deno.test('statmod trigger narration is qualitative; the live row carries the numbers (#153)', () => {
  // Glass Arrowhead (t_7): battleStart Expose, gates removed.
  const arrowhead = item('t_7')!;
  const original = arrowhead.triggers;
  arrowhead.triggers = [{ ...original![0], chance: 1 }];
  try {
    const p = createPlayer(1501, 'T', 'warrior');
    p.equipment.trinket = 't_7';
    const b = tankyWolf(p, 3);
    const exposed = b.effectInstances.find((i) => i.defId === 't_7:t0:e0');
    assert(exposed, 'the Exposed instance landed');
    assertEquals(exposed.pct, 0.25);
    assertQualitative(narrativeLine(b.opening?.lines ?? [], 'fault line'));
    const rendered = JSON.stringify(renderBattle(p));
    assert(rendered.includes('+25% damage taken'), 'the row derives the magnitude');
    assert(rendered.includes('3 rounds remaining'), 'the row derives the duration');
  } finally {
    arrowhead.triggers = original;
  }
});

Deno.test('enemy Slow variant narration is qualitative; the live row carries the numbers (#153)', () => {
  // The Woodfang Spider's Web Snare: find a seed where it lands Webbed.
  let b: BattleState | undefined;
  let lines: readonly string[] = [];
  for (let s = 1; s <= 120 && !b; s++) {
    const p = createPlayer(1502 + s, 'T', 'warrior');
    const attempt = startBattle('e_spider', ORIGIN, { player: p, rng: seeded(s) })!.battle;
    attempt.enemy.hp = 99999; // tank the spider — it must survive to answer
    attempt.enemy.maxHp = 99999;
    const res = performAction(p, attempt, { kind: 'attack' }, seeded(s));
    if (attempt.effectInstances.some((i) => i.side === 'player' && i.name === 'Webbed')) {
      b = attempt;
      lines = res.lines;
    }
  }
  assert(b, 'found a seed where Web Snare lands');
  const webbed = b.effectInstances.find((i) => i.side === 'player' && i.name === 'Webbed')!;
  assertEquals(webbed.pct, -0.25);
  assertQualitative(narrativeLine(lines, 'webbing binds'));
  const p2 = createPlayer(1999, 'T', 'warrior');
  p2.battle = b;
  const rendered = JSON.stringify(renderBattle(p2));
  assert(rendered.includes('−25% SPD'), 'the row derives the slow magnitude');
  assert(rendered.includes('2 rounds remaining'), 'the row derives the duration');
});

Deno.test('a multi-effect skill narrates only its own resolution; the sibling buff surfaces in the live row (#153)', () => {
  // Adrenaline Surge: the heal line must not describe the separate quiet
  // ATK buff — changing the buff spec must never leave the heal line stale.
  const p = createPlayer(1503, 'T', 'warrior');
  p.skills.push('sk_adrenaline');
  p.mp = 40;
  const b = tankyWolf(p, 5);
  p.hp = 10; // make the restored amount a real resolution product
  const res = performAction(p, b, { kind: 'skill', skillId: 'sk_adrenaline' }, seeded(6));
  const healLine = narrativeLine(res.lines, 'feel the rush');
  assert(!healLine.includes('20%'), 'the heal line does not narrate the sibling buff: ' + healLine);
  assert(/\{n\}|HP/.test(healLine), 'the heal line still names its own event');
  const restored = Number(healLine.match(/recover (\d+) HP/)?.[1] ?? -1);
  assert(restored > 0, 'the {n} token resolved to the actual restored HP');
  const atkBuff = b.effectInstances.find((i) =>
    i.side === 'player' && i.kind === 'statmod' && i.stat === 'atk'
  );
  assert(atkBuff, 'the quiet ATK buff landed as a live instance');
  assertEquals(atkBuff.pct, 0.2);
  const rendered = JSON.stringify(renderBattle(p));
  assert(rendered.includes('+20% ATK'), 'the live row carries the buff magnitude');
  assert(rendered.includes('2 rounds remaining'), 'the live row carries the buff duration');
});

Deno.test('{n} follows the structured value, never a content constant (#153)', () => {
  // The Wardstone's shield capacity is a single structured `amount`; the
  // narration template must render whatever the spec says.
  const wardstone = item('t_wardstone')!;
  const original = wardstone.triggers;
  const spec = (original![0].effects[0] as { amount: number })!;
  assert(spec.amount === 25, 'fixture precondition: the authored amount is 25');
  spec.amount = 99;
  try {
    const p = createPlayer(1504, 'T', 'warrior');
    p.equipment.trinket = 't_wardstone';
    const b = tankyWolf(p, 7);
    assert(
      (b.opening?.lines ?? []).some((l) => l.includes('absorbing up to 99 damage')),
      'the rendered {n} followed the altered structured amount',
    );
  } finally {
    spec.amount = 25;
  }
});

// ── Narrow integrity check: no duplicated mechanical numbers ─────────────

/** Every authored `EffectSpec.line` in current content: item triggers,
 * skill effects, enemy moves, enemy specials, and enemy openings (#155).
 * Only choice of the structured mechanics boundary: `{n}` is allowed (it
 * reports the actual applied value supplied by the resolver), everything
 * else numeric in a battle line duplicates a spec field. */
function authoredLines(): { from: string; line: string }[] {
  const out: { from: string; line: string }[] = [];
  const fromSpec = (from: string, spec: EffectSpec): void => {
    if (spec.line) out.push({ from, line: spec.line });
  };
  for (const def of ITEMS) {
    def.triggers?.forEach((t, ti) =>
      t.effects.forEach((e, ei) => fromSpec(`${def.id}:t${ti}:e${ei}`, e))
    );
  }
  for (const sk of SKILLS) {
    sk.effects.forEach((e, ei) => fromSpec(`${sk.id}:e${ei}`, e));
  }
  for (const e of ENEMIES) {
    if (e.opening) {
      e.opening.effects.forEach((spec, ei) => fromSpec(`${e.id}:opening:e${ei}`, spec));
    }
    e.moves.forEach((m, mi) => {
      m.effects.forEach((spec, ei) => fromSpec(`${e.id}:m${mi}:e${ei}`, spec));
    });
    if (e.special) {
      e.special.move.effects.forEach((spec, ei) => fromSpec(`${e.id}:special:e${ei}`, spec));
    }
  }
  return out;
}

/** The duplicated-mechanics patterns: percentage literals, damage amounts,
 * multiplier notation, duration literals, literal HP/MP/action counts, and
 * battle-lifetime rules — each tied to a structured spec field. */
const DUPLICATED_MECHANICS =
  /−?\d+(?:\.\d+)?%|\d+ damage|×\d|\d+ rounds?\b|\d+ HP\b|\d+ MP\b|\d+ actions?\b|SPD −\d|whole battle/i;

/** The one integrity authority shared by every corpus regression. */
function duplicatedMechanics(): { from: string; line: string }[] {
  return authoredLines().filter(({ line }) => DUPLICATED_MECHANICS.test(line));
}

Deno.test('integrity: authored battle lines duplicate no mechanical number (#153)', () => {
  assertEquals(duplicatedMechanics(), []);
});

Deno.test('integrity: enemy opening lines are crawled; a copied mechanic there is rejected (#155)', () => {
  // The Chrono Wisp authors the one enemy-global opening line (#80); it
  // must sit in the crawled inventory with clear source provenance.
  assert(
    authoredLines().some((entry) =>
      entry.from === 'e_chronowisp:opening:e0' &&
      entry.line === '⏳ The wisp anchors you outside time.'
    ),
    'the Chrono Wisp opening line is inventoried with source provenance',
  );

  // Regression: copying the structured slow magnitude and duration into
  // the opening narration must be seen and rejected by the same authority
  // as every other authored battle line.
  const wisp = ENEMIES.find((e) => e.id === 'e_chronowisp')!;
  const spec = wisp.opening!.effects[0];
  const original = spec.line;
  const forged = '⏳ The wisp anchors you outside time (SPD −20%, 2 rounds)!';
  spec.line = forged;
  try {
    assertEquals(duplicatedMechanics(), [{ from: 'e_chronowisp:opening:e0', line: forged }]);
  } finally {
    spec.line = original;
  }
});
