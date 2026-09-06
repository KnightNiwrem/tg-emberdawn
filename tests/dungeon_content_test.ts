import { assert, assertEquals } from '@std/assert';
import { item } from '../src/content/items.ts';
import { ZONES } from '../src/content/zones.ts';

Deno.test('content integrity: dungeon rooms resolve as encounters or authored discoveries', () => {
  for (const z of ZONES) {
    const d = z.dungeon;
    if (!d) continue;
    for (const [index, floor] of d.floors.entries()) {
      const label = `${d.id} floor ${index + 1}`;
      if (floor.discovery) {
        assertEquals(floor.enemies, [], `${label}: discovery cannot also spawn an enemy`);
        assert(floor.discovery.name.trim(), `${label}: discovery needs a name`);
        assert(floor.discovery.text.trim(), `${label}: discovery needs narrative`);
      } else {
        assert(floor.enemies.length > 0, `${label}: encounter must have an enemy pool`);
      }
      if (floor.treasure?.item) {
        assert(item(floor.treasure.item), `${label}: cache item must exist`);
      }
    }
  }
});
