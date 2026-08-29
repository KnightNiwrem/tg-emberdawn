# 🔥 Emberdawn

A turn-based RPG about seeking hope for a future, played entirely inside a single Telegram message,
built on **Bot API Rich Messages** — every button (explore, fight, skills, shop, forge, quests)
lives in the message body itself and edits in place. No `reply_markup` anywhere.

> The Great Flame is guttering — a king split it in half and hoarded its tomorrow. But embers are
> promises. Take up the last light, carry it through six chapters of dark, and bring back the dawn.
> Then guard what you lit.

## Features

- **4 classes** — Warrior, Mage, Rogue, Cleric — each with 8 unique skills learned by level.
- **Turn-based combat** — attack, skills (MP + cooldowns), items, guard, flee; crits, stuns,
  buffs/debuffs, scripted boss specials.
- **8 zones, 8 dungeons, 48 enemies** across 6 story chapters — each one recovers a piece of the
  stolen dawn — plus a postgame hunt beneath the world.
- **25 main quests + 16 side quests** (the player is a _Dawncaller_; the Sundered King is despair
  that stopped believing in morning), quest log with objective tracking and turn-ins.
- **~100 items** — class-tiered weapons/armor, trinkets, consumables, forge materials.
- **Forge tempering** (+1…+5 per slot, permanent stat boosts), shops that scale by chapter.
- **45 levels** with a grindy curve tuned for weeks of play, bosses, elite encounters, death
  penalties, auto-revive trinket.
- **One live message per player**: staleness-guarded, crash-safe, state persisted in Postgres
  (JSONB) — attached Prisma Postgres on Deno Deploy, any Postgres locally.

## Stack

- **Deno 2** (`deno.json` is the manifest; tasks: `start`, `webhook`, `check`, `test`, `fmt`,
  `lint`)
- **grammY 1.46** (rich messages: `sendRichMessage`, in-body `RichMessageButton`)
- **grammy-testing** for in-process integration tests; **fallow** for dead-code/complexity audits
- Pure engine (`src/engine`, `src/content`) — zero Telegram imports; renderers and handlers are the
  only I/O-aware layers

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
2. Deploy this repo with entrypoint `src/main.ts`; set `BOT_TOKEN` (and optionally
   `WEBHOOK_SECRET`).
3. Register the webhook once:

```bash
BOT_TOKEN=123:abc WEBHOOK_SECRET=*** deno task webhook set https://<your-app>/webhook
deno task webhook info    # Telegram's view of the webhook
deno task webhook delete  # unregister
```

`GET /healthz` answers `emberfall bot: ok` for platform health checks.

On Deno Deploy, attach a **Prisma Postgres** instance to the app (App settings → Databases → Attach
Database). Deploy injects `DATABASE_URL` and the `PG*` variables automatically, and the app picks
them up with zero configuration. Set the app's **Pre-Deploy Command** (Settings → App Config) to
`deno task migrate:pg` so the `players` table exists before each revision serves traffic.

Locally, `DATABASE_URL` is normally unset: persistence falls back to Deno KV backed by a managed
sqlite file (set `BOT_KV_PATH` to place it), or point `DATABASE_URL` at any Postgres. If your
Postgres requires TLS, append `?sslmode=require` to the URL. Exercise the Postgres path with:
`TEST_PG_URL=postgresql://… deno task test:pg`.

## Playing

`/start` → pick a class → the game message becomes your zone hub. From there, everything is buttons:
**Explore** (battles/treasure/rest), **Dive** into the zone dungeon, **Travel**, **Shop**,
**Forge**, **Quests**, **Skills**, **Character**. `/help` explains; `/reset` starts over. If the
game message ever gets buried, `/start` re-centers it and old copies go stale safely.

## Project layout

See **[AGENTS.md](AGENTS.md)** — the full architecture manual, invariants (pure engine, single live
message, callback budget), content authoring checklist, and the evaluated fallow audit notes.
