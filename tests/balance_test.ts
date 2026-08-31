/** Balance-harness invariants (#74): hard CI gates for unacceptable opening
 * states, plus the reviewed snapshot of stable envelopes. The human-facing
 * report lives in scripts/balance.ts (`deno task balance`); the snapshot is
 * regenerated deliberately with `deno task balance:update`. */

import { assert, assertEquals } from '@std/assert';
import {
  buildSnapshot,
  type EncounterSource,
  POLICIES,
  runCell,
  tutorialEnemies,
} from '../src/engine/balance.ts';
import { CLASS_IDS } from '../src/engine/types.ts';
import { enemy as enemyDef } from '../src/content/enemies.ts';
import { item } from '../src/content/items.ts';
import { quest } from '../src/content/quests.ts';
import { ZONES } from '../src/content/zones.ts';

const FIGHTS = 300;

function solo(enemyId: string, zoneId: string): EncounterSource[] {
  return [{ enemyId, weight: 1, origin: { kind: 'explore', zoneId } }];
}

Deno.test('balance: every class has a viable free action (#74)', () => {
  // The prominent free button must actually work: vs the weakest opening
  // normal, a full-health level-1 hero mashing it should nearly always win.
  for (const cid of CLASS_IDS) {
    const cell = runCell({
      classId: cid,
      level: 1,
      gear: 'starting',
      policy: POLICIES.free,
      pool: 'solo:e_rat',
      sources: solo('e_rat', 'whisperwood'),
      fights: FIGHTS,
      seed: 1101,
    });
    assert(
      cell.winRate >= 0.85,
      `${cid} free action vs Giant Rat winRate ${cell.winRate} < 0.85 — the free button is not viable`,
    );
  }
});

Deno.test('balance: the opening normals do not require consumables (#74)', () => {
  // A correctly played hero without spending items should reliably beat the
  // two weakest opening normals (rotation policy, no item use).
  for (const cid of CLASS_IDS) {
    for (const eid of ['e_rat', 'e_boar']) {
      const cell = runCell({
        classId: cid,
        level: 1,
        gear: 'starting',
        policy: POLICIES.rotation,
        pool: `solo:${eid}`,
        sources: solo(eid, 'whisperwood'),
        fights: FIGHTS,
        seed: 1201,
      });
      assert(
        cell.winRate >= 0.85,
        `${cid} vs ${eid} without consumables: winRate ${cell.winRate} < 0.85`,
      );
    }
  }
});

Deno.test('balance: boss gates and readiness metadata resolve to real content (#74)', () => {
  for (const z of ZONES) {
    const d = z.dungeon;
    if (!d) continue;
    assert(enemyDef(d.boss), `${z.id}: boss ${d.boss} does not exist`);
    d.floors.forEach((f, i) => {
      for (const eid of f.enemies) {
        assert(enemyDef(eid), `${z.id} floor ${i + 1}: enemy ${eid} does not exist`);
      }
      if (f.treasure?.item) {
        assert(
          item(f.treasure.item),
          `${z.id} floor ${i + 1}: treasure ${f.treasure.item} missing`,
        );
      }
    });
    if (d.bossGate) {
      assert(quest(d.bossGate.quest), `${z.id}: gate quest ${d.bossGate.quest} does not exist`);
      if (d.bossGate.item) {
        assert(item(d.bossGate.item), `${z.id}: gate key ${d.bossGate.item} does not exist`);
      }
    }
    if (d.firstClear?.item) {
      assert(item(d.firstClear.item), `${z.id}: first-clear item ${d.firstClear.item} missing`);
    }
  }
});

Deno.test('balance: tutorial encounters cannot fell a correctly acting hero (#74)', () => {
  // Vacuously green until #69 flags its controlled enemy; the invariant is
  // wired so the guaranteed tutorial is covered the moment it exists.
  const tutors = tutorialEnemies();
  for (const t of tutors) {
    for (const cid of CLASS_IDS) {
      const cell = runCell({
        classId: cid,
        level: 1,
        gear: 'starting',
        policy: POLICIES.rotation,
        pool: `tutorial:${t.id}`,
        sources: solo(t.id, 'emberdawn'),
        fights: 200,
        seed: 1301,
      });
      assertEquals(cell.lossRate, 0, `${cid} lost to tutorial enemy ${t.id}`);
    }
  }
});

Deno.test('balance: reviewed snapshot matches the harness (#74)', () => {
  const path = new URL('./balance_snapshot.json', import.meta.url);
  let raw: string;
  try {
    raw = Deno.readTextFileSync(path);
  } catch {
    throw new Error(
      'tests/balance_snapshot.json is missing — regenerate deliberately with: deno task balance:update',
    );
  }
  const snap = JSON.parse(raw);
  assertEquals(
    buildSnapshot(),
    snap,
    'balance snapshot drifted — if this is a deliberate balance change, run deno task balance:update and explain the shift in the commit message',
  );
});
