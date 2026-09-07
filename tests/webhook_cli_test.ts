/** #213: exercise the real CLI and process status without contacting Telegram. */
import { assert, assertEquals } from '@std/assert';

const script = new URL('../scripts/webhook.ts', import.meta.url).href;
const token = '123456:TEST-TOKEN';
const secret = 'test-webhook-secret';
const webhookUrl = 'https://example.invalid/webhook';

async function runCli(
  args: string[],
  status = 200,
  response: unknown = { ok: true, result: true },
  env: Record<string, string> = { BOT_TOKEN: token, WEBHOOK_SECRET: secret },
) {
  // The subprocess owns its globals, arguments and exit code. Capture the
  // request before returning a fake response; an unexpected call cannot
  // escape to the network through this transport.
  const bootstrap = `
    Deno.args.push(...${JSON.stringify(args)});
    globalThis.fetch = async (url, init) => {
      console.log(JSON.stringify({
        url: String(url), method: init.method,
        headers: init.headers, body: JSON.parse(init.body),
      }));
      return new Response(JSON.stringify(${JSON.stringify(response)}), {
        status: ${status}, headers: { 'content-type': 'application/json' },
      });
    };
    await import(${JSON.stringify(script)});
  `;
  const out = await new Deno.Command('deno', {
    args: ['eval', '--no-config', bootstrap],
    clearEnv: true,
    env,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

Deno.test('webhook CLI: successful set/info/delete preserve the API request contract (#213)', async () => {
  const cases = [
    {
      args: ['set', webhookUrl],
      method: 'setWebhook',
      body: {
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
      },
    },
    { args: ['info'], method: 'getWebhookInfo', body: {} },
    { args: ['delete'], method: 'deleteWebhook', body: {} },
  ];
  for (const testCase of cases) {
    const out = await runCli(testCase.args);
    assertEquals(out.code, 0, `${testCase.method}: ${out.stderr}`);
    const [request, ...response] = out.stdout.trim().split('\n');
    assertEquals(JSON.parse(request), {
      url: `https://api.telegram.org/bot${token}/${testCase.method}`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: testCase.body,
    });
    assertEquals(JSON.parse(response.join('\n')), { ok: true, result: true });
  }
});

Deno.test('webhook CLI: HTTP and API failures exit nonzero and retain the response (#213)', async () => {
  const cases = [
    { status: 401, response: { ok: false, description: 'Unauthorized' } },
    // Each success gate matters independently, even if a server/proxy sends
    // an inconsistent HTTP/API combination.
    { status: 500, response: { ok: true } },
    { status: 200, response: { ok: false, description: 'Registration refused' } },
    { status: 200, response: { result: true } },
  ];
  for (const testCase of cases) {
    const out = await runCli(['set', webhookUrl], testCase.status, testCase.response);
    assert(
      out.code !== 0,
      `HTTP ${testCase.status} / ${JSON.stringify(testCase.response)} exited 0`,
    );
    const [, ...response] = out.stdout.trim().split('\n');
    assertEquals(
      JSON.parse(response.join('\n')),
      testCase.response,
      'API diagnostics remain visible',
    );
  }
});

Deno.test('webhook CLI: missing credentials refuse before making a request (#213)', async () => {
  const environments: Record<string, string>[] = [{}, { BOT_TOKEN: token }];
  for (const env of environments) {
    const out = await runCli(['set', webhookUrl], 200, { ok: true }, env);
    assert(out.code !== 0);
    assertEquals(out.stdout, '', 'no request or response was emitted');
    assert(
      out.stderr.includes('environment variable is required') ||
        out.stderr.includes('WEBHOOK_SECRET is required'),
    );
  }
});
