# 🔥 Emberfall

A turn-based RPG played entirely inside a single Telegram message, built on
**Bot API Rich Messages** — every button (explore, fight, skills, shop, forge,
quests) lives in the message body itself and edits in place. No `reply_markup`
anywhere.

> The Great Flame is dying — drained by a king who split it in half.
> Choose a class, fight through 6 chapters, mend the flame, and then see
> what waits in the Seam below the world.

## Features

- **4 classes** — Warrior, Mage, Rogue, Cleric — each with 8 unique skills learned by level.
- **Turn-based combat** — attack, skills (MP + cooldowns), items, guard, flee; crits, stuns, buffs/debuffs, scripted boss specials.
- **8 zones, 8 dungeons, 48 enemies** across 6 story chapters, plus a postgame endless-hunt zone.
- **25 main quests + 16 side quests**, quest log with objective tracking and turn-ins.
- **~100 items** — class-tiered weapons/armor, trinkets, consumables, forge materials.
- **Forge tempering** (+1…+5 per slot, permanent stat boosts), shops that scale by chapter.
- **45 levels** with a grindy curve tuned for weeks of play, bosses, elite encounters, death penalties, auto-revive trinket.
- **One live message per player**: staleness-guarded, crash-safe, state persisted in Deno KV.

## Stack

- **Deno 2** (`deno.json` is the manifest; tasks: `start`, `webhook`, `check`, `test`, `fmt`, `lint`)
- **grammY 1.46** (rich messages: `sendRichMessage`, in-body `RichMessageButton`)
- **grammy-testing** for in-process integration tests; **fallow** for dead-code/complexity audits
- Pure engine (`src/engine`, `src/content`) — zero Telegram imports; renderers and handlers are the only I/O-aware layers

## Getting started

```bash
deno task check   # typecheck
deno task test    # 35 deterministic tests (engine + bot integration)
deno task lint
```

### Run locally (long polling — no public URL needed)

```bash
BOT_TOKEN=123:abc BOT_POLLING=1 deno task start
```

### Deploy (webhook, Deno Deploy friendly)

1. Create the bot with @BotFather, copy the token.
2. Deploy this repo with entrypoint `src/main.ts`; set `BOT_TOKEN` (and optionally `WEBHOOK_SECRET`).
3. Register the webhook once:

```bash
BOT_TOKEN=123:abc WEBHOOK_SECRET=*** deno task webhook set https://<your-app>/webhook
deno task webhook info    # Telegram's view of the webhook
deno task webhook delete  # unregister
```

`GET /healthz` answers `emberfall bot: ok` for platform health checks.

On Deno Deploy, Deno KV is built in — player saves survive redeploys with no
configuration. Locally, Deno KV uses a managed sqlite file (set
`BOT_KV_PATH` to place it explicitly).

## Playing

`/start` → pick a class → the game message becomes your zone hub. From there,
everything is buttons: **Explore** (battles/treasure/rest), **Dive** into the
zone dungeon, **Travel**, **Shop**, **Forge**, **Quests**, **Skills**,
**Character**. `/help` explains; `/reset` starts over. If the game message
ever gets buried, `/start` re-centers it and old copies go stale safely.

## Project layout

See **[AGENTS.md](AGENTS.md)** — the full architecture manual, invariants
(pure engine, single live message, callback budget), content authoring
checklist, and the evaluated fallow audit notes.
