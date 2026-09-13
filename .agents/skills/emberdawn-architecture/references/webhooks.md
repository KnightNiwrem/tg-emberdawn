# Webhook authentication and operation

Authoritative code and tests: `src/webhook-server.ts`, `src/main.ts`, `scripts/webhook.ts`,
`tests/webhook_test.ts`, `tests/webhook_cli_test.ts`.

For changes to the per-player lock or database transaction used to handle an update, also read
[State coordination and reset](state-and-reset.md). For changes to callback staleness or
game-message delivery, also read [Message lifecycle and callbacks](message-lifecycle.md).

## Webhook boundary

- Webhook mode fails closed without `WEBHOOK_SECRET`. The `X-Telegram-Bot-Api-Secret-Token` header
  is verified constant-time in `src/webhook-server.ts` BEFORE grammY parses the update. Polling mode
  needs no secret.
- Rotation procedure: choose a new secret, update the app environment, run
  `deno task webhook set <url>` with the same value, restart.
- `src/main.ts` selects webhook mode by default or polling mode with `BOT_POLLING=1`.
