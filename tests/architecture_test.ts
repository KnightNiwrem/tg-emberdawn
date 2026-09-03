/** #102, corrected by #114: the gameplay architecture boundary is an
 * ORDERED-COMPLETION contract, not a vocabulary ban.
 *
 * The intended architecture: Telegram/network/database handling is
 * asynchronous I/O around a deterministic game core. Handlers load state,
 * invoke the engine's ordered resolution, render/persist the COMPLETED
 * result, then return. Three concepts stay separate (#114):
 *
 *  1. ORDERED RESOLUTION (required) — one authoritative coordinator owns
 *     combat phases and nested sub-resolution; each action/effect fully
 *     resolves before the next begins; terminal checks fire inline at every
 *     potentially lethal transition.
 *  2. ASYNC SYNTAX (neutral) — a Promise-returning function whose every
 *     step is awaited is still a single ordered flow. Async syntax is
 *     neither proof of order nor proof of disorder, so this suite contains
 *     NO lexical scanner for async/await/Promise tokens.
 *  3. EVENT-DRIVEN ORCHESTRATION (unwanted for combat) — listeners, buses,
 *     timers, queues or detached callbacks fanning combat work out of the
 *     authoritative flow. This stays unwanted regardless of syntax.
 *
 * What these tests pin:
 *  - the CURRENT engine entry points are synchronous (a compile-time
 *    contract for today's API shape — not a claim that sync proves order);
 *  - resolution is COMPLETE at return: no pending work, no thenables, the
 *    trace and state observable immediately;
 *  - the observable ORDER of resolution: the SPD-selected first actor acts
 *    first, a lethal first slot stops everything after it, and the
 *    terminal entry closes the trace;
 *  - the import boundary via the Deno compiler's own dependency graph
 *    (`deno info --json`) — never regex over arbitrary TypeScript text.
 *
 * Deliberately NOT flagged: direct synchronous functions named onKill /
 * onStoryEvent / onZoneEnter / runReactiveTriggers, content "exploration
 * events" (data variants resolved by a switch), and plain trace entry
 * arrays — the words are fine; hidden ownership and fan-out are what the
 * contract forbids. */

import { assert, assertEquals } from '@std/assert';
import {
  type ActionResult,
  performAction,
  type PlayerAction,
  previewBattle,
  startBattle,
  type StartBattleOpts,
  type StartBattleResult,
} from '../src/engine/combat.ts';
import type { BattleOutcome } from '../src/engine/combat.ts';
import type { BattleOrigin, BattleState, PlayerState } from '../src/engine/types.ts';
import type { DungeonDef } from '../src/content/types.ts';
import {
  diveDungeon,
  explore,
  type ExploreOutcome,
  resolveVictory,
  travel,
} from '../src/engine/world.ts';
import type { Rng } from '../src/engine/rng.ts';
import { applyDeath, createPlayer, grantXp } from '../src/engine/character.ts';
import {
  acceptQuest,
  onKill,
  onStoryEvent,
  onZoneEnter,
  syncAvailability,
  turnInQuest,
  type TurnInResult,
} from '../src/engine/quests.ts';
import { injectMod, seeded } from './helpers.ts';

const ORIGIN: BattleOrigin = { kind: 'explore', zoneId: 'outskirts' };

// ── 1. Synchronous API type contract ─────────────────────────────────────
//
// Each assignment pins the engine entry point to a NON-Promise signature:
// making any of these functions async breaks the compile with an
// architecture-specific error (Promise<T> is not assignable to T). This
// pins the CURRENT contract only (#114) — a synchronous signature is not,
// by itself, proof that gameplay is not event-driven; the ordered-
// resolution tests below carry that weight.

Deno.test('architecture: gameplay entry points are pinned to synchronous signatures (#102)', () => {
  // Combat construction + resolution.
  const battleContract: (
    enemyId: string,
    origin: BattleOrigin,
    opts: StartBattleOpts,
  ) => StartBattleResult | undefined = startBattle;
  const actionContract: (
    p: PlayerState,
    b: BattleState,
    a: PlayerAction,
    rng?: Rng,
  ) => ActionResult = performAction;

  // Victory, exploration and dungeons.
  const victoryContract: (p: PlayerState, b: BattleState, rng?: Rng) => string[] = resolveVictory;
  const exploreContract: (p: PlayerState, rng?: Rng, now?: number) => ExploreOutcome = explore;
  const diveContract: (
    p: PlayerState,
    d: DungeonDef,
    rng?: Rng,
  ) => { ok: boolean; battle?: BattleState; outcome?: BattleOutcome; lines: string[] } =
    diveDungeon;
  const travelContract: (p: PlayerState, zoneId: string) => { ok: boolean; lines: string[] } =
    travel;

  // Quest progress "hooks" — directly invoked synchronous functions. The
  // hooks RETURN the quests they just made turn-in-ready (#119): readiness
  // is data the caller announces, never a side channel.
  const acceptContract: (
    p: PlayerState,
    id: string,
    npcId: string,
  ) => { ok: boolean; msg: string; lines: string[] } = acceptQuest;
  const turnInContract: (p: PlayerState, id: string, npcId: string) => TurnInResult = turnInQuest;
  const storyEventContract: (p: PlayerState, event: string) => string[] = onStoryEvent;
  const killContract: (p: PlayerState, enemyId: string) => string[] = onKill;
  const zoneContract: (p: PlayerState, zoneId: string) => string[] = onZoneEnter;
  const syncContract: (p: PlayerState) => string[] = syncAvailability;

  // Progression and death.
  const xpContract: (p: PlayerState, xp: number) => string[] = grantXp;
  const deathContract: (p: PlayerState) => string = applyDeath;

  // The contracts are load-bearing: reference them so the assignments can
  // never be pruned as dead code.
  assert(
    battleContract !== undefined && actionContract !== undefined && victoryContract !== undefined &&
      diveContract !== undefined && travelContract !== undefined && acceptContract !== undefined &&
      turnInContract !== undefined && storyEventContract !== undefined &&
      killContract !== undefined &&
      zoneContract !== undefined && syncContract !== undefined && xpContract !== undefined &&
      deathContract !== undefined && typeof exploreContract === 'function',
    'all gameplay entry points pinned to synchronous signatures',
  );
});

// ── 2. No pending work after return ──────────────────────────────────────

Deno.test('architecture: a full action is COMPLETE at return — state, log, trace, procs (#102)', () => {
  const p = createPlayer(10200, 'T', 'warrior');
  p.level = 10;
  const started = startBattle('e_rat', ORIGIN, { player: p, rng: () => 0.5 })!;
  const b = started.battle;
  p.battle = b;
  b.enemy.hp = 12; // one strike from terminal
  const res = performAction(p, b, { kind: 'attack' }, () => 0.5);

  // No queue to drain, no tick to await: the result is not a thenable and
  // every consequence of the action already exists on the plain objects.
  assertEquals(res instanceof Promise, false, 'performAction returns a plain result');
  assertEquals('then' in res, false, 'the result is not a thenable');

  // The terminal round is recorded, the outcome adjudicated, the trace
  // closed — all synchronously, observable immediately after the return.
  assertEquals(res.outcome, 'victory');
  assertEquals(b.history.length, 1, 'the terminal round is in the history NOW');
  assertEquals(b.enemy.hp <= 0, true);
  const terminal = res.trace.filter((e) => e.kind === 'terminal');
  assertEquals(terminal.length, 1, 'the terminal entry is on the trace NOW');
  assert(
    res.trace.some((e) => e.kind === 'hpDamaged' && e.target === 'enemy'),
    'the damage entry is on the trace NOW',
  );

  // The construction side: the opening trace exists at return too.
  assert(started.trace.every((e) => typeof e.kind === 'string'), 'opening trace is plain data');
  // previewBattle: no opening resolved, no pending work — a static record.
  const pv = previewBattle('e_rat', ORIGIN)!;
  assertEquals(pv.history.length, 0);
  assertEquals(pv.phase, 'preview');
});

// ── 3. Ordered resolution: the observable contract (#114) ────────────────

Deno.test('architecture: a lethal first slot ends resolution in order — terminal closes the trace (#114)', () => {
  // The faster player one-shots the enemy. The ordered-completion contract,
  // observed from OUTSIDE the engine:
  //  - the SPD-selected first actor acted and the defeated actor never did;
  //  - terminal state was checked immediately at the lethal transition;
  //  - NOTHING follows the terminal entry — no end-of-round effects, no
  //    later riders, no counter advancement;
  //  - the caller sees only the fully resolved state.
  for (let s = 1; s <= 100; s++) {
    const p = createPlayer(11400 + s, 'T', 'warrior');
    p.level = 30;
    const b = startBattle('e_rat', ORIGIN, { player: p, rng: seeded(s) })!.battle;
    p.battle = b;
    injectMod(b, 'enemy', 'spd', -0.95); // the player takes the first slot
    b.enemy.hp = 5; // one-strike terminal
    const res = performAction(p, b, { kind: 'attack' }, seeded(s));
    if (res.outcome !== 'victory') continue; // find a decisive seed

    assert(
      !res.trace.some((e) => e.kind === 'hpDamaged' && e.target === 'player'),
      'the defeated actor never acted',
    );
    const last = res.trace[res.trace.length - 1];
    assertEquals(last?.kind, 'terminal', 'the terminal entry closes the trace');
    assertEquals(b.round, 1, 'no end-of-round bookkeeping ran after the kill');
    assertEquals(b.enemy.hp <= 0, true, 'terminal state is visible at return');
    return;
  }
  throw new Error('no lethal first-slot seed found');
});

// ── 4. Import boundary via the compiler's dependency graph (#114) ────────

/** Gameplay modules: the pure engine and its content database. Handlers,
 * render glue and persistence are EXCLUDED — Telegram code is expected to
 * be asynchronous I/O. */
const GAMEPLAY_DIRS = ['src/engine', 'src/content'];

/** Recursively collects .ts files under a directory. */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) out.push(...collectSources(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** The transitive module closure of one file, resolved by the Deno
 * compiler itself (`deno info --json`) — a real TypeScript-aware
 * dependency graph, not text scraping (#114). */
async function dependencyClosure(root: string): Promise<string[]> {
  // Invoked BY NAME so the test task's `--allow-run=deno` (a program-name
  // allowlist, not a path one) covers it on every install layout.
  const out = await new Deno.Command('deno', {
    args: ['info', '--json', root],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (!out.success) {
    throw new Error(`deno info failed for ${root}:\n${new TextDecoder().decode(out.stderr)}`);
  }
  const graph = JSON.parse(new TextDecoder().decode(out.stdout)) as {
    modules: { specifier: string }[];
  };
  return graph.modules.map((m) => m.specifier);
}

Deno.test('architecture: gameplay modules depend only on local gameplay code (compiler graph, #114)', async () => {
  for (const dir of GAMEPLAY_DIRS) {
    for (const path of collectSources(dir)) {
      const closure = await dependencyClosure(path);
      for (const spec of closure) {
        assert(
          spec.startsWith('file://'),
          `${path}: gameplay depends on non-local code — ${spec}\n` +
            '    (grammy, node:/npm:/jsr:/https: dependencies and event-bus libraries ' +
            'are all unreachable from the gameplay core)',
        );
        assert(
          !spec.includes('/src/handlers/') && !spec.includes('/src/persistence/'),
          `${path}: gameplay depends on the async I/O boundary — ${spec}`,
        );
      }
    }
  }
});

Deno.test('architecture: gameplay modules never access Deno runtime APIs (#114)', () => {
  for (const dir of GAMEPLAY_DIRS) {
    for (const path of collectSources(dir)) {
      const src = Deno.readTextFileSync(path);
      assert(
        !/\bDeno\./.test(src),
        `${path}: gameplay code must not access Deno runtime APIs (Deno.*)`,
      );
    }
  }
});
