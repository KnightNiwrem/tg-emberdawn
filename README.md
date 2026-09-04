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
- **8 zones, 7 dungeons, 48 enemies** across 6 story chapters — each one recovers a piece of the
  stolen dawn — plus a postgame hunt beneath the world.
- **25 main quests + 16 side quests** (the player is a _Dawncaller_; the Sundered King is despair
  that stopped believing in morning), quest log with objective tracking and turn-ins.
- **~100 items** — class-tiered weapons/armor, trinkets, consumables, forge materials.
- **Forge tempering** (+1…+5, mastered per item pattern so future copies inherit it), shops that
  scale with your level.
- **45 levels** with a grindy curve tuned for weeks of play, bosses, elite encounters, death
  penalties, a Phoenix Cinder auto-revive.
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
deno task test    # deterministic tests: engine, progression, bot integration, repair regressions
deno task lint
```

### Run locally (long polling — no public URL needed)

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
BOT_TOKEN=123:abc BOT_POLLING=1 deno task start
```

### Deploy (webhook, Deno Deploy friendly)

1. Create the bot with @BotFather, copy the token.
2. Generate a webhook secret and deploy this repo with entrypoint `src/main.ts`:

```bash
openssl rand -hex 32   # → WEBHOOK_SECRET (REQUIRED in webhook mode — the app fails closed without it)
```

Set `BOT_TOKEN` and `WEBHOOK_SECRET` as app environment variables. Polling mode (`BOT_POLLING=1`)
does not need the secret. Telegram signs every update with the value registered via `setWebhook`;
the app verifies the `X-Telegram-Bot-Api-Secret-Token` header before parsing anything, so the
registered value and the app env must stay identical. 3. Register the webhook once:

```bash
BOT_TOKEN=123:abc WEBHOOK_SECRET=*** deno task webhook set https://<your-app>/webhook
deno task webhook info    # Telegram's view of the webhook
deno task webhook delete  # unregister
```

`GET /healthz` answers `emberdawn bot: ok` for platform health checks.

**Rotating the webhook secret:** generate a new value, update the app's `WEBHOOK_SECRET` env, re-run
`deno task webhook set <url>` with the new value, and restart the app. Do it in that order and the
window where signatures and verification disagree stays seconds-wide; a mismatched window only
yields 401s (Telegram retries webhook deliveries), never lost saves.

On Deno Deploy, attach a **Prisma Postgres** instance to the app (App settings → Databases → Attach
Database). Deploy injects `DATABASE_URL` and the `PG*` variables automatically, and the app picks
them up with zero configuration. Set the app's **Pre-Deploy Command** (Settings → App Config) to
`deno task migrate:pg` so the `players` table exists before each revision serves traffic.

`DATABASE_URL` is required everywhere. On Deno Deploy the attached instance injects it; locally,
point it at any Postgres (e.g. `postgresql://postgres:postgres@localhost:5432/postgres`). If your
Postgres requires TLS, append `?sslmode=require` to the URL. Exercise the store with:
`TEST_PG_URL=postgresql://… deno task test:pg`.

## Playing

`/start` → pick a class → the game message becomes your zone hub. From there, everything is buttons:
**Explore** (battles, treasure, rest — towns are battle-free safe havens; arriving in one fully
heals you), **Dive** into the zone dungeon, **Travel**, **Shop**, **Forge**, **Quests**, **Skills**,
**Character**. `/help` explains; `/reset` confirms before deleting a supported character — during
pre-launch it also serves as the explicit escape hatch for an unloadable retired development save.
If the game message ever gets buried, `/start` re-centers it and old copies go stale safely.

## Project layout

See **[AGENTS.md](AGENTS.md)** for the compact project invariants and the task-to-skill router.
Detailed conditional agent guidance lives under **`.agents/skills/`** as standard Agent Skills;
**[docs/narrative-guide.md](docs/narrative-guide.md)** remains the canonical editorial guide.
