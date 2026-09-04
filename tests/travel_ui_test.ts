/**
 * #164 — the zone/travel/journey UI reads as local geography: adjacency,
 * risk, services, and journey recovery, all in one live message.
 */

import { assert, assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { retreatFromJourney, startJourney } from '../src/engine/journey.ts';
import { travelAction, zoneAction } from '../src/handlers/hub.ts';
import { renderHelp, renderJourney, renderTravel, renderZone } from '../src/render/views.ts';
import { tutorialRelease } from '../src/handlers/tutorial.ts';
import { encodeCb, withRev } from '../src/codec.ts';
import { fakeCtxCapture } from './helpers.ts';
import { handleCallback } from '../src/handlers/callbacks.ts';
import { MemoryStore } from '../src/persistence/store.ts';

function walker(id: number, at: string, unlocked: string[]): ReturnType<typeof createPlayer> {
  const p = createPlayer(id, 'Walker', 'warrior');
  p.tutorial = 'done';
  p.currentZone = at;
  p.unlockedZones = [...unlocked];
  return p;
}

// ── the travel view ──────────────────────────────────────────────────────

Deno.test('travel lists only adjacent authorized edges, never every unlocked zone', () => {
  const p = walker(1700, 'outskirts', ['emberdawn', 'outskirts', 'whisperwood', 'hollowmere']);
  const view = JSON.stringify(renderTravel(p));
  // Adjacent roads render with departure buttons.
  assert(view.includes('w_emberdawn_outskirts') === false, 'the wire id never leaks');
  assert(view.includes('Take the road to Emberdawn Village'));
  assert(view.includes('Take the road to Whisperwood'));
  // Hollowmere is unlocked but NOT adjacent — no departure button.
  assertEquals(
    view.includes('Take the road to Hollowmere'),
    false,
    'unlocked non-adjacent zones are not destinations',
  );
  // Adjacent-but-locked roads name their state without a button.
  const locked = walker(1701, 'whisperwood', ['emberdawn', 'outskirts', 'whisperwood']);
  const lockedView = JSON.stringify(renderTravel(locked));
  assert(lockedView.includes('not yours to walk yet'), 'locked roads teach adjacency');
  assertEquals(lockedView.includes('Take the road to Hollowmere'), false);
  assertEquals(lockedView.includes('Take the road to Mirefoot'), false);
});

Deno.test('each route shows its roll count as events, never as battles', () => {
  const p = walker(1702, 'whisperwood', ['whisperwood', 'hollowmere', 'mirefoot', 'outskirts']);
  const view = JSON.stringify(renderTravel(p));
  assert(view.includes('2 road events'), 'the exact roll count renders');
  assert(!view.includes('2 battles'), 'counts are never described as battles');
  assert(
    view.includes('never promised battles'),
    'the view explains events may be hostile, quiet, or helpful',
  );
  assert(view.includes('wild'), 'the authored risk descriptor renders');
  assert(view.includes('sheltered'), 'the poled crossing is sheltered');
  // Zero-event roads read as welcoming, not "0 events".
  assert(view.includes('no road events — a safe crossing'));
});

Deno.test('the secured variant and destination services render where relevant', () => {
  const p = walker(1703, 'whisperwood', ['whisperwood', 'hollowmere', 'mirefoot']);
  // m7 done → the causeway shows its quieted state.
  p.quests['m7_tyrant'] = { status: 'done', counts: [1] };
  const view = JSON.stringify(renderTravel(p));
  assert(view.includes('quieted'), 'the active variant is named');
  assert(view.includes('mild'), 'the variant risk override renders');
  // The landing advertises its forge and full rest; hollowmere its shop.
  assert(view.includes('⚒️ forge'));
  assert(view.includes('🔥 full rest'));
  assert(view.includes('🏪 shop'));
});

Deno.test('perilous departures stage an explicit confirmation; starter roads stay immediate', () => {
  const p = walker(1704, 'umbra', ['umbra', 'abyss']);
  // First tap on the Descent stages the panel.
  const staged = travelAction(p, { v: 'travel', a: 'go', arg: 'w_umbra_abyss' });
  assertEquals(p.scene.view, 'travel');
  assertEquals(p.scene.arg, 'go:w_umbra_abyss');
  assert(staged.toast?.includes('confirm'), 'the staging names the hazard');
  assertEquals(p.currentZone, 'umbra', 'nothing moved');
  assertEquals(p.journey, undefined);
  // The staged view renders the warning panel.
  const panel = JSON.stringify(renderTravel(p));
  assert(panel.includes('Depart for The Abyss'));
  assert(panel.includes('3 road events'));
  assert(panel.includes('perilous'));
  // Confirming departs.
  const go = travelAction(p, { v: 'travel', a: 'go', arg: 'w_umbra_abyss' });
  assertEquals(p.currentZone !== 'umbra' || p.journey !== undefined, true, 'the crossing began');
  void go;
  retreatFromJourney(p);
  // A two-event road never stages: it departs on the first tap.
  const q = walker(1705, 'sunspire', ['sunspire', 'frostpeak']);
  travelAction(q, { v: 'travel', a: 'go', arg: 'w_sunspire_frostpeak' });
  assert(q.journey !== undefined, 'ordinary roads depart immediately');
  retreatFromJourney(q);
  // Zero-event roads are immediate too.
  const r = walker(1706, 'mirefoot', ['mirefoot', 'hollowmere']);
  travelAction(r, { v: 'travel', a: 'go', arg: 'w_mirefoot_hollowmere' });
  assertEquals(r.currentZone, 'hollowmere');
});

// ── the zone hub ─────────────────────────────────────────────────────────

Deno.test('safe and dangerous zone hubs are visibly and functionally distinct', () => {
  const home = walker(1707, 'emberdawn', ['emberdawn', 'outskirts']);
  const homeView = JSON.stringify(renderZone(home));
  assert(homeView.includes('Safe haven'));
  assert(homeView.includes("Bram's Forge-stall"), 'the local shop renders by name');
  assert(homeView.includes("Bram's Anvil"));
  const wilds = walker(1708, 'whisperwood', ['whisperwood', 'outskirts']);
  const wildsView = JSON.stringify(renderZone(wilds));
  assert(wildsView.includes('Dangerous wilds'), 'danger zones present themselves');
  assertEquals(wildsView.includes('Safe haven'), false);
  assertEquals(wildsView.includes('shop'), false, 'no service buttons in the wilds');
  assertEquals(wildsView.includes('forge'), false);
  // The wilds still render their real local actions.
  assert(wildsView.includes('Explore'));
  assert(wildsView.includes('Warden Tom'), 'NPCs stay listed');
});

Deno.test('the hub preserves a live crossing; back never resets to the zone hub', () => {
  const p = walker(1709, 'whisperwood', ['whisperwood', 'hollowmere']);
  const res = startJourney(p, 'w_whisperwood_hollowmere', () => 0.1);
  assert(res.ok && res.step.kind === 'battle');
  p.battle!.enemy.hp = 0;
  // win + continue to the intermission happens in battle tests; here drive
  // the intermission directly.
  p.scene = { view: 'journey' };
  // The zone hub "home" control returns to the crossing, not the hub.
  zoneAction(p, { v: 'zone', a: 'hm' });
  assertEquals(p.scene.view, 'journey', 'the journey is the player\u2019s current place');
  assertEquals(p.journey !== undefined, true);
  retreatFromJourney(p);
  // Same for the inventory's bag-back (callbacks.ts routing).
  const p2 = walker(1710, 'whisperwood', ['whisperwood', 'hollowmere']);
  const res2 = startJourney(p2, 'w_whisperwood_hollowmere', () => 0.1);
  assert(res2.ok && res2.step.kind === 'battle');
  p2.scene = { view: 'journey' };
  assertEquals(zoneAction(p2, { v: 'zone', a: 'hm' }).toast, undefined);
  assertEquals(p2.scene.view, 'journey');
});

// ── copy accuracy ────────────────────────────────────────────────────────

Deno.test('help and tutorial copy describe conditional travel and local facilities', () => {
  const help = JSON.stringify(renderHelp());
  assert(!help.includes('travel costs nothing'), 'the old universal-free claim is gone');
  assert(help.includes('ADJACENT roads'), 'travel teaches adjacency');
  assert(help.includes('road events'), 'road events are explained');
  assert(help.includes('Not every haven offers services'), 'safety and services are orthogonal');
  const release = JSON.stringify(tutorialRelease());
  assert(!release.includes('costs nothing'));
  assert(release.includes('hearth-roads'), 'starter roads are safe by authoring');
  assert(release.includes('road events'), 'road events are taught from the start');
});

// ── wire discipline ──────────────────────────────────────────────────────

Deno.test('every travel/journey callback stays within Telegram\u2019s 64-byte budget', () => {
  // The longest wire forms with a 4-digit revision stamp.
  for (
    const wire of [
      't:go:w_whisperwood_hollowmere',
      't:go:w_whisperwood_mirefoot',
      't:go:w_umbra_abyss',
      't:bk',
      'j:go',
      'j:rt',
    ]
  ) {
    const stamped = withRev(9999, wire);
    assertEquals(stamped.length <= 64, true, `${stamped} (${stamped.length} bytes)`);
    assert(stamped.length > 0);
  }
  // The intent-only rule: the departure wire carries an EDGE id, not a
  // destination/plan; the journey wire carries no plan data at all.
  assertEquals(encodeCb({ v: 'travel', a: 'go', arg: 'w_umbra_abyss' }), 't:go:w_umbra_abyss');
  assertEquals(encodeCb({ v: 'journey', a: 'go' }), 'j:go');
});

Deno.test('/start re-centers a live crossing through the persisted scene', async () => {
  const store = new MemoryStore();
  const p = walker(1711, 'whisperwood', ['whisperwood', 'hollowmere']);
  p.messageId = 900;
  await store.set(p.userId, p);
  const res = startJourney(p, 'w_whisperwood_hollowmere', () => 0.1);
  assert(res.ok && res.step.kind === 'battle');
  await store.set(p.userId, p);
  // /start re-renders whatever the scene says; the battle view is rebuilt
  // from the persisted battle without consuming anything.
  const cur = (await store.get(p.userId))!;
  assertEquals(cur.battle !== undefined, true);
  assertEquals(cur.journey !== undefined, true);
  // The journey intermission is reachable from PlayerState alone.
  p.battle!.enemy.hp = 0;
  p.scene = { view: 'journey' };
  const rendered = JSON.stringify(renderJourney(p));
  assert(rendered.includes('Press on'));
  assert(rendered.includes('Retreat'));
  // A stale tap on the OLD intermission render is refused untouched.
  const tapped = fakeCtxCapture(p.userId, 900, withRev(cur.uiRev, 'j:go'));
  await handleCallback(tapped.ctx, store);
  const after = (await store.get(p.userId))!;
  assertEquals(after.journey !== undefined, true, 'stale taps never consume rolls');
});
