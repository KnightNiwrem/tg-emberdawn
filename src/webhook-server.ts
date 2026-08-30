/**
 * Webhook request authentication (#29). Telegram signs every update with the
 * secret registered via setWebhook and repeats it in the
 * X-Telegram-Bot-Api-Secret-Token header. Production webhook mode FAILS
 * CLOSED: no valid secret, no update — verified here BEFORE grammY parses
 * the body, so forged updates can never reach player mutation code.
 */

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** Constant-time comparison (leaks only length — irrelevant for secrets). */
export function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = new TextEncoder().encode(received);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export interface WebhookHandlerOptions {
  /** grammY's update handler — webhookCallback(bot, 'std/http'). */
  handleUpdate: (req: Request) => Promise<Response>;
  /** The configured WEBHOOK_SECRET — required, checked before handling. */
  secretToken: string;
  /** Health text for GET / and /healthz. */
  health?: string;
}

/** The platform request handler for webhook mode. */
export function createWebhookHandler(
  opts: WebhookHandlerOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/webhook') {
      if (!secretMatches(req.headers.get(SECRET_HEADER), opts.secretToken)) {
        return new Response('forbidden', { status: 401 });
      }
      try {
        return await opts.handleUpdate(req);
      } catch (err) {
        console.error('webhook error', err);
        return new Response('internal error', { status: 500 });
      }
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/healthz')) {
      return new Response(opts.health ?? 'emberdawn bot: ok');
    }
    return new Response('not found', { status: 404 });
  };
}
