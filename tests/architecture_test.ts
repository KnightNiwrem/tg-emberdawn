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

/** Single-pass lexical strip (#110): removes comments AND blanks string/
 * template literal CONTENTS so documentation and display prose about async
 * mechanics never trips the runtime-primitive guard, while keeping the
 * quote delimiters (and code structure) intact. Char-scanned, so a `//`
 * inside a string or a quote inside a comment cannot desync it. */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++; // line comment — dropped
    } else if (c === '/' && d === '*') {
      i += 2; // block comment — dropped
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c; // string/template — keep delimiters, blank the contents
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') i++; // skip the escaped character
        i++;
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Comment-strip only (strings KEPT): import specifiers live in strings. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Every module specifier a snippet imports or re-exports (#110): spans
 * newlines and covers `import … from`, side-effect `import '…'`, and
 * `export … from` — no line-form assumptions. */
function importSpecifiers(code: string): string[] {
  const specs: string[] = [];
  const fromRe = /(?:\bimport\b|\bexport\b)[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;
  const sideEffectRe = /\bimport\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(fromRe)) specs.push(m[1]!);
  for (const m of code.matchAll(sideEffectRe)) specs.push(m[1]!);
  return specs;
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

/** Banned RUNTIME primitives (post comment+string strip): async gameplay
 * callbacks of ANY syntactic form — function, arrow, method, generator —
 * deferred work, dynamic imports, and listener registries (#110). */
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
  // #110: ANY async token post-strip — async function, async arrow,
  // async method, async generator — not just the `async function` form.
  [/\basync\b/, 'gameplay functions are synchronous — no async callbacks of any form'],
  [/\bawait\b/, 'gameplay never awaits — resolution completes before returning'],
  [/\bimport\s*\(/, 'dynamic import() defers work behind a promise — import statically'],
  [/\.then\(/, 'promise chaining defers gameplay work — use direct calls and return values'],
];

/** The full source guard for one gameplay module (#110): returns the
 * violations (empty = clean) so fixtures can probe detection power
 * directly and real files run the exact same scan. */
function scanGameplaySource(src: string): string[] {
  const violations: string[] = [];
  const codeOnly = stripCommentsAndStrings(src);
  for (const [pattern, why] of BANNED_CODE) {
    const hit = pattern.exec(codeOnly);
    if (hit) {
      violations.push(`${why} (found "${hit[0]}")`);
    }
  }
  const commentStripped = stripComments(src);
  for (const spec of importSpecifiers(commentStripped)) {
    for (const [pattern, why] of BANNED_IMPORTS) {
      if (pattern.test(`'${spec}'`)) violations.push(`import '${spec}' — ${why}`);
    }
  }
  return violations;
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

Deno.test('architecture: gameplay modules import no Telegram/handler/persistence/event-bus code (#102)', () => {
  for (const dir of GAMEPLAY_DIRS) {
    for (const path of collectSources(dir)) {
      const violations = scanGameplaySource(Deno.readTextFileSync(path));
      assert(
        violations.length === 0,
        `${path}: architecture boundary violated —\n    ${
          violations.map((v) => v.replace(/\n/g, '\n    ')).join('\n    ')
        }`,
      );
    }
  }
});

Deno.test('architecture: gameplay modules use no async/timer/listener runtime primitives (#102)', () => {
  for (const dir of GAMEPLAY_DIRS) {
    for (const path of collectSources(dir)) {
      const violations = scanGameplaySource(Deno.readTextFileSync(path));
      assert(
        violations.length === 0,
        `${path}: architecture boundary violated —\n    ${
          violations.map((v) => v.replace(/\n/g, '\n    ')).join('\n    ')
        }\n    The gameplay boundary is synchronous: resolution completes before returning.`,
      );
    }
  }
});

/** #110 fixture probe: every banned syntactic form is detected, and the
 * documented vocabulary in comments/strings never produces a false
 * positive. This pins the GUARD's detection power — the file scans above
 * only prove today's real sources are clean. */
Deno.test('architecture: the source guard detects async arrows, methods, dynamic imports — and tolerates prose (#110)', () => {
  // Each banned form is rejected, in whatever syntax it hides.
  const banned: [string, string][] = [
    ['async function f() {}', 'async function'],
    ['const f = async () => 1;', 'async arrow'],
    ['class A { async run() {} }', 'async method'],
    ['const o = { async tick() {} };', 'async object-literal method'],
    ['async function* g() {}', 'async generator'],
    ['const x = await p;', 'await'],
    ['const m = import("./late.ts");', 'dynamic import'],
    ['const m = await import("./late.ts");', 'awaited dynamic import'],
    ['p.then(() => {});', 'promise chaining'],
    ['setTimeout(fn, 10);', 'timer'],
    ['queueMicrotask(fn);', 'microtask'],
    ['new Promise((res) => res(1));', 'promise construction'],
    ['bus.addEventListener("tick", fn);', 'listener registry'],
    ['import { x } from "grammy";', 'banned import'],
    ['import {\n  y,\n} from "node:events";', 'multiline banned import'],
    ["import 'grammy';", 'side-effect banned import'],
    ["export * from '../handlers/session.ts';", 'handler re-export'],
    ['import type { Ctx } from "grammy";', 'type-only banned import'],
  ];
  for (const [snippet, label] of banned) {
    const violations = scanGameplaySource(snippet);
    assert(
      violations.length > 0,
      `the guard must reject an ${label} in the gameplay boundary`,
    );
  }
  // Allowed terminology — the documented words for DIRECT synchronous
  // mechanics — never trips the scan, in comments or string content.
  const allowed = [
    '// runReactiveTriggers is a direct synchronous call, not an event bus',
    '// the words async, await, listener, emit, dispatch and setTimeout appear here',
    '/* onKill/onTalk/onZoneEnter are ordinary directly invoked quest hooks */',
    'const label = "no queue draining, no event-loop tick, no grammy import";',
    'const msg = `await the EventEmitter dispatch (grammy, node:events)`;',
    'function onKill(enemyId: string): void { progress++; }',
    'const trace: string[] = []; trace.push("dispatchEvent");',
  ];
  for (const snippet of allowed) {
    assertEquals(
      scanGameplaySource(snippet),
      [],
      `allowed prose/mechanics must not false-positive:\n    ${snippet}`,
    );
  }
});
