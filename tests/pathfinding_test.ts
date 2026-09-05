/** #182: route search preserves authored ties, boundaries, and live gates. */

import { assertEquals } from '@std/assert';
import { createPlayer } from '../src/engine/character.ts';
import { findRoutePath } from '../src/engine/pathfinding.ts';
import { route } from '../src/content/routes.ts';
import { ZONES } from '../src/content/zones.ts';

Deno.test('route search: authored ties, zero-hop policy, and no player mutation', () => {
  const p = createPlayer(182, 'Walker', 'warrior');
  p.currentZone = 'outskirts';
  p.unlockedZones = ZONES.map((z) => z.id);
  const before = structuredClone(p);
  assertEquals(findRoutePath(p, (id) => id === 'outskirts'), []);
  assertEquals(findRoutePath(p, (id) => id === 'outskirts', { includeStart: false }), undefined);
  assertEquals(findRoutePath(p, (id) => id === 'emberdawn' || id === 'whisperwood'), [
    'w_outskirts_emberdawn',
  ]);
  assertEquals(findRoutePath(p, (id) => id === 'whisperwood', { maxHops: 0 }), undefined);
  assertEquals(findRoutePath(p, (id) => id === 'whisperwood', { maxHops: 1 }), [
    'w_outskirts_whisperwood',
  ]);
  assertEquals(p, before);
});

Deno.test('route search: live gates and the nine-hop recovery boundary', () => {
  const p = createPlayer(183, 'Walker', 'warrior');
  p.unlockedZones = ZONES.map((z) => z.id);
  const shortcut = route('w_whisperwood_hollowmere')!;
  const original = shortcut.when;
  shortcut.when = { flag: { id: 'test:shortcut' } };
  try {
    // Closing the direct causeway routes through Mirefoot instead.
    const path = findRoutePath(p, (id) => id === 'abyss', { maxHops: 9 });
    assertEquals(path?.length, 9, 'a target at the depth boundary remains reachable');
    assertEquals(path?.includes('w_whisperwood_mirefoot'), true);
    assertEquals(findRoutePath(p, (id) => id === 'abyss', { maxHops: 8 }), undefined);
    p.flags['test:shortcut'] = true;
    assertEquals(findRoutePath(p, (id) => id === 'abyss', { maxHops: 8 })?.length, 8);
    p.unlockedZones = p.unlockedZones.filter((id) => id !== 'abyss');
    assertEquals(findRoutePath(p, (id) => id === 'abyss'), undefined);
  } finally {
    if (original === undefined) delete shortcut.when;
    else shortcut.when = original;
  }
});
