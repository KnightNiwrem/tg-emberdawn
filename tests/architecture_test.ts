/** #102: the synchronous gameplay architecture boundary — regression
 * guardrails, not a general proof of program synchrony.
 *
 * The intended architecture: Telegram/network/database handling may be
 * asynchronous, but GAMEPLAY resolution is a synchronous, deterministic
 * call graph. Handlers load state, invoke pure synchronous engine
 * operations, render/persist the completed result, then return. These
 * tests pin the boundary so a future change cannot quietly introduce an
 * event bus, deferred gameplay work, or Promise-returning engine APIs.
 *
 * Deliberately NOT flagged: direct synchronous functions named onKill /
 * onTalk / onZoneEnter / runReactiveTriggers, content "exploration
 * events" (data variants resolved by a switch), and plain trace entry
 * arrays — the words are fine; the ASYNC MECHANICS are what is banned. */

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
  onTalk,
  onZoneEnter,
  syncAvailability,
  turnInQuest,
  type TurnInResult,
} from '../src/engine/quests.ts';

const ORIGIN: BattleOrigin = { kind: 'explore', zoneId: 'outskirts' };

// ── 1. Synchronous API type contract ─────────────────────────────────────
//
// Each assignment pins the engine entry point to a NON-Promise signature:
// making any of these functions async breaks the compile with an
// architecture-specific error (Promise<T> is not assignable to T).

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

  // Quest progress "hooks" — directly invoked synchronous functions.
  const acceptContract: (
    p: PlayerState,
    id: string,
    npcId: string,
  ) => { ok: boolean; msg: string } = acceptQuest;
  const turnInContract: (p: PlayerState, id: string, npcId: string) => TurnInResult = turnInQuest;
  const talkContract: (p: PlayerState, npcId: string) => void = onTalk;
  const killContract: (p: PlayerState, enemyId: string) => void = onKill;
  const zoneContract: (p: PlayerState, zoneId: string) => void = onZoneEnter;
  const syncContract: (p: PlayerState) => string[] = syncAvailability;

  // Progression and death.
  const xpContract: (p: PlayerState, xp: number) => string[] = grantXp;
  const deathContract: (p: PlayerState) => string = applyDeath;

  // The contracts are load-bearing: reference them so the assignments can
  // never be pruned as dead code.
  assert(
    battleContract !== undefined && actionContract !== undefined && victoryContract !== undefined &&
      diveContract !== undefined && travelContract !== undefined && acceptContract !== undefined &&
      turnInContract !== undefined && talkContract !== undefined && killContract !== undefined &&
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

// ── 5 + 6. Engine dependency boundary and forbidden runtime primitives ───

/** Gameplay modules: the pure engine and its content database. Handlers,
 * render glue and persistence are EXCLUDED — Telegram code is expected to
 * be asynchronous. */
const GAMEPLAY_DIRS = ['src/engine', 'src/content'];

/** Strips block and line comments so documentation ABOUT async mechanics
 * never trips the source-level guard (#102: no word-based false positives
 * on prose like "no queue draining or event-loop tick"). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Recursively collects .ts files under a directory (plain synchronous
 * walk — the guard itself must not need async machinery). */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) out.push(...collectSources(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** Banned IMPORT targets in gameplay modules: Telegram transport, the
 * async handler/persistence layers, and event-bus libraries. */
const BANNED_IMPORTS: [RegExp, string][] = [
  [/['"]grammy/i, 'grammy (Telegram transport) must never be imported by gameplay modules'],
  [/['"]node:/, 'node built-ins (node:events, node:timers, …) are not gameplay dependencies'],
  [/['"]deno\.land\/std\/async/, 'deno/std/async utilities are not gameplay dependencies'],
  [/['"]npm:/, 'npm packages are not gameplay dependencies'],
  [/['"][^'"]*handlers\//, 'handlers are the async I/O boundary — never imported by gameplay'],
  [/['"][^'"]*persistence\//, 'persistence is the async I/O boundary — never imported by gameplay'],
  [
    /['"](eventemitter3|rxjs|nanobus|mitt|event-target-shim)['"]/i,
    'event-bus libraries are banned in gameplay modules',
  ],
];

/** Banned RUNTIME primitives (post comment-strip): async gameplay
 * callbacks, deferred work, and listener registries. */
const BANNED_CODE: [RegExp, string][] = [
  [/\bEventEmitter\b/, 'EventEmitter is an event bus — gameplay resolves by direct calls'],
  [/\bEventTarget\b/, 'EventTarget is an event bus — gameplay resolves by direct calls'],
  [/\bdispatchEvent\b/, 'dispatchEvent is event-bus semantics — call the function directly'],
  [
    /\b(addEventListener|removeEventListener)\b/,
    'listener registries are banned — no gameplay listeners exist',
  ],
  [/\bqueueMicrotask\b/, 'queueMicrotask defers gameplay work — resolution completes at return'],
  [/\bsetTimeout\b/, 'setTimeout defers gameplay work — timers never drive mechanics'],
  [/\bsetInterval\b/, 'setInterval defers gameplay work — timers never drive mechanics'],
  [/\bnew Promise\b/, 'gameplay never constructs Promises — plain values and direct returns only'],
  [/\basync\s+function\b/, 'gameplay functions are synchronous — no async callbacks'],
  [/\bawait\b/, 'gameplay never awaits — resolution completes before returning'],
  [/\.then\(/, 'promise chaining defers gameplay work — use direct calls and return values'],
];

Deno.test('architecture: gameplay modules import no Telegram/handler/persistence/event-bus code (#102)', () => {
  for (const dir of GAMEPLAY_DIRS) {
    for (const path of collectSources(dir)) {
      const code = stripComments(Deno.readTextFileSync(path));
      for (const line of code.split('\n')) {
        if (!/^\s*import\b/.test(line) && !/^\s*} from\s+['"]/.test(line)) continue;
        for (const [pattern, why] of BANNED_IMPORTS) {
          assert(
            !pattern.test(line),
            `${path}: architecture boundary violated — ${why}\n    ${line.trim()}`,
          );
        }
      }
    }
  }
});

Deno.test('architecture: gameplay modules use no async/timer/listener runtime primitives (#102)', () => {
  for (const dir of GAMEPLAY_DIRS) {
    for (const path of collectSources(dir)) {
      const code = stripComments(Deno.readTextFileSync(path));
      for (const [pattern, why] of BANNED_CODE) {
        const hit = pattern.exec(code);
        assert(
          !hit,
          `${path}: architecture boundary violated — ${why} (found "${hit?.[0]}")\n` +
            `    The gameplay boundary is synchronous: resolution completes before returning.`,
        );
      }
    }
  }
});
