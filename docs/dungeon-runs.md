# Dungeon runs

Each dungeon entry begins at floor 1. A run follows the authored floors in order and ends at the
boss. HP and MP carry between floors; there is no inn, rest action, travel, or access to hub
services inside the dungeon. Level gains during an active run do not refill HP or MP. Players may
use their own consumables and change equipment between encounters. Healing skills and consumables
retain their ordinary combat rules.

The entry panel explains this commitment and displays the dungeon's recommended level. Every entry
requires confirmation. This is an authored boss-readiness recommendation, not a guarantee that every
build can finish the full run at that level.

## Leaving and returning

Leaving between floors or successfully fleeing an ordinary encounter returns to the local hub and
abandons the run. Defeat also abandons it and uses the ordinary last-haven revival rules. The next
entry always starts from floor 1, including after a previous full clear. Boss encounters remain
inescapable, including with a Smoke Bomb.

Closing Telegram or restarting the bot does not abandon a run. Active progress persists so the
player can resume the same floor or battle. This persistence supports interrupted sessions; it never
makes returning to town a floor checkpoint.

Earned XP, loot, and quest progress remain earned when a run is abandoned. Floor caches are awarded
once per hero, and dungeon first-clear rewards are awarded once per hero. Repeating a run provides
ordinary encounter rewards, but never replenishes those caches or first-clear rewards. A durable
record of clearing a dungeon is separate from temporary progress through the current run.

## Story preparation and boss gates

Existing boss quest gates still apply at the final floor. Earlier floors remain accessible before
the boss quest opens: preparation quests need their enemies and materials. A player who reaches a
locked boss can leave to report back, keeping the preparation progress. The next expedition begins
at floor 1. The entry panel discloses a locked boss before entry so this is an informed preparation
trip.

The Vault of Hours retains its Sunspire Key requirement and consumes the key on its first boss
victory. Abandoning an attempt never spends the key. Once the Vault is cleared, repeating it does
not require another key.

## Authored floors

All seven dungeons retain their three original combat floors and their boss. A discovery chamber
follows the second combat floor, giving each run five floors including the boss. No enemy pool,
enemy statistic, or reward quantity changes with this structural overhaul.

| Dungeon             | Discovery chamber   | Existing cache moved to this chamber |
| ------------------- | ------------------- | ------------------------------------ |
| Rootbound Hollow    | The Abandoned Pack  | Iron Chunk                           |
| Sunken Shrine       | The Sluice Walk     | Ether                                |
| Vault of Hours      | The Daylight Ledger | None; observation only               |
| The Glacier Maw     | The Warden's Shelf  | Greater Ether                        |
| Pyre Caldera        | The Binding Channel | Phoenix Cinder                       |
| The Sundered Throne | The Divided Gallery | Elixir                               |
| The Endless Seam    | The Path Marker     | Elixir                               |

Discovery rooms describe a concrete place, reveal local context, and sometimes contain an existing
cache. They provide no automatic recovery, random encounter, hazard damage, or invented mechanical
bonus. A cache containing a consumable adds it to inventory; discovering it does not use it.

`DungeonFloor.discovery` contains a name and narrative text; its `enemies` array is empty. Combat
floors have a nonempty enemy array and no discovery. A discovery is resolved once as the run reaches
it; continuing moves forward, and rerendering or reopening the game never grants the cache again.
New content must preserve enough encounter sources for current kill quests and validate every enemy
and cache item reference.

## Balance boundary

This change deliberately creates resource attrition. Existing enemy statistics and recommended
levels are retained so the behavior change can be evaluated separately from numeric tuning. The
single-encounter balance harness remains useful for combat regressions, but does not establish that
an entire dungeon is comfortably clearable. Future tuning should measure full runs across classes,
equipment, level, and carried consumables before changing difficulty or adding recovery facilities.

## Prepared-run evidence

The run regression samples 30 seeds for each of the seven dungeons and four classes (840 attempts).
Heroes enter at the recommendation with ordinary level-appropriate gear tempered to +3, ten regional
HP supplies and four ethers. Between rooms the policy spends carried supplies toward 75% HP/MP; it
never buys, rests or refills inventory during the attempt. Every attempt walks the authored floor
sequence, including discoveries.

Observed completion is 100% for most combinations, 70% for Hollowmere mage, 73% for Frostpeak mage,
and 97% for Abyss mage. This is evidence for that prepared policy, not a guarantee for untempered
equipment or arbitrary builds. Campaign simulations also buy stronger available local supplies with
real gold, and all existing campaign pacing bounds remain in force. Enemy statistics and the
isolated-fight snapshot were not changed.

Save version 14 introduces the run field and cache receipts. Older disposable pre-launch saves are
refused with the standard /reset instruction; no save migration is provided.
