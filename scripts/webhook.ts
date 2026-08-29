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
  case 'set':
    await call('setWebhook', {
      url: Deno.args[1],
      secret_token: Deno.env.get('WEBHOOK_SECRET') || undefined,
      allowed_updates: ['message', 'callback_query'],
    });
    break;
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
