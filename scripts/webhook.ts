/**
 * One-shot webhook management against the Telegram API.
 * Usage: deno task webhook <set <url> | info | delete>
 */

const token = Deno.env.get('BOT_TOKEN');
if (!token) {
  console.error('BOT_TOKEN environment variable is required');
  Deno.exit(1);
}

const base = `https://api.telegram.org/bot${token}`;
const cmd = Deno.args[0];

async function call(method: string, body?: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${base}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

switch (cmd) {
  case 'set': {
    // Refuse to register an UNAUTHENTICATED webhook (#29): Telegram would
    // deliver unsigned updates the app (rightly) rejects.
    const secret = Deno.env.get('WEBHOOK_SECRET');
    if (!secret) {
      console.error(
        'WEBHOOK_SECRET is required to register a webhook — the same value the app verifies. Generate: openssl rand -hex 32',
      );
      Deno.exit(1);
    }
    await call('setWebhook', {
      url: Deno.args[1],
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    });
    break;
  }
  case 'info':
    await call('getWebhookInfo');
    break;
  case 'delete':
    await call('deleteWebhook');
    break;
  default:
    console.error('usage: deno task webhook <set <url> | info | delete>');
    Deno.exit(1);
}
