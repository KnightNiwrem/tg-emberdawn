# Webhook authentication and operation

Authoritative code and tests: `src/webhook-server.ts`, `src/main.ts`, `scripts/webhook.ts`,
`tests/webhook_test.ts`, `tests/webhook_cli_test.ts`.

For changes to the per-player lock or database transaction used to handle an update, also read
[State coordination and reset](state-and-reset.md). For changes to callback staleness or
game-message delivery, also read [Message lifecycle and callbacks](message-lifecycle.md).

## Command targets

Apply the root `AGENTS.md` operational boundary using the action and target authorized in the
conversation. Preparing or testing a webhook change does not itself require calling Telegram.

- `deno task webhook info` reads the bot's current webhook configuration. `set <url>` and `delete`
  change the webhook for the bot selected by `BOT_TOKEN`; `set` also uses the supplied URL and
  `WEBHOOK_SECRET`. A token's presence is not authorization to change that bot's configuration.
- `deno task start` uses `BOT_TOKEN` and `DATABASE_URL` to start the actual bot and store. Polling
  with `BOT_POLLING=1` is also an operational run, even from a local shell. For database setup and
  target selection, read `emberdawn-persistence`.
- When startup, deployment, or webhook mutation is authorized for the identified target, proceed
  within that scope without another approval checkpoint. Apply the rotation procedure below when the
  authorized work includes secret rotation; deployment does not imply public launch.

## Webhook boundary

- Webhook mode fails closed without `WEBHOOK_SECRET`. The `X-Telegram-Bot-Api-Secret-Token` header
  is verified constant-time in `src/webhook-server.ts` BEFORE grammY parses the update. Polling mode
  needs no secret.
- Rotation procedure: choose a new secret, update the app environment, run
  `deno task webhook set <url>` with the same value, restart.
- `src/main.ts` selects webhook mode by default or polling mode with `BOT_POLLING=1`.
