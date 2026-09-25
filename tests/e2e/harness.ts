/**
 * End-to-end harness: the real bot, in webhook mode as deployed, talking to
 * an in-process Telegram Bot API emulator over loopback HTTP. Tests act as a
 * virtual player through the emulator's account client and assert on what
 * that player's chat shows, never on the store.
 */

import { webhookCallback } from 'grammy';
import type { Update } from 'grammy/types';
import { createEmulationApi } from 'tg-bot-api-emulator/src/api/mod.ts';
import { createSessionLifecycleService } from 'tg-bot-api-emulator/src/composition/session_lifecycle.ts';
import {
  type BotActivityLog,
  type BotActivityPosition,
  type CallbackQuery,
  type EmulationSessionClient,
  type PrivateMessage,
  type PrivateMessageTarget,
  TelegramEmulationClient,
  type VirtualAccountClient,
} from 'tg-bot-api-emulator/clients/typescript/mod.ts';
import { createBot } from '../../src/bot.ts';
import { MemoryStore } from '../../src/persistence/store.ts';
import { createWebhookHandler } from '../../src/webhook-server.ts';

// Rich message parts as the account's client shows them, derived from the
// message model that history returns.
type RichMessage = NonNullable<PrivateMessage['rich_message']>;
type RichBlock = RichMessage['blocks'][number];
type RichMessageButton = Extract<RichBlock, { type: 'buttons' }>['buttons'][number];
type RichText = RichMessageButton['text'];

const LOOPBACK = '127.0.0.1';

/** Serves a handler on an ephemeral loopback port. */
function serveLoopback(handler: Deno.ServeHandler): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve({ hostname: LOOPBACK, port: 0, onListen: () => {} }, handler);
}

/** Starts the emulator in-process. Its public origin must name the port it
 * listens on, which is only known once it listens, so requests go through a
 * handler bound after startup. */
function startEmulator(): { client: TelegramEmulationClient; server: Deno.HttpServer } {
  const emulatorApi = Promise.withResolvers<ReturnType<typeof createEmulationApi>>();
  const server = serveLoopback(async (request) => (await emulatorApi.promise).fetch(request));
  const origin = `http://${LOOPBACK}:${server.addr.port}`;
  emulatorApi.resolve(createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: origin,
  }));
  return { client: new TelegramEmulationClient(origin), server };
}

/** Webhook requests wait for this before the bot sees them. */
interface DeliveryGate {
  opened: Promise<void>;
}

/** A callback button as the player sees it: its label and what it sends. */
export interface VisibleButton {
  label: string;
  callbackData: string;
}

/** Flattens rich text to the plain string a reader sees. */
export function plainText(text: RichText | undefined): string {
  if (text === undefined) return '';
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) return text.map(plainText).join('');
  const node = text as Exclude<RichText, string | readonly RichText[]>;
  if ('text' in node) return plainText(node.text);
  if (node.type === 'button') return plainText(node.button.text);
  if (node.type === 'custom_emoji') return node.alternative_text;
  if (node.type === 'mathematical_expression') return node.expression;
  return '';
}

function blockText(block: RichBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'footer':
    case 'heading':
    case 'pre':
    case 'expandable_blockquote':
    case 'pullquote':
      return plainText(block.text);
    case 'blockquote':
    case 'collage':
    case 'slideshow':
      return block.blocks.map(blockText).join('\n');
    case 'details':
      return [plainText(block.summary), ...block.blocks.map(blockText)].join('\n');
    case 'list':
      return block.items
        .map((item) => `${item.label} ${item.blocks.map(blockText).join('\n')}`)
        .join('\n');
    case 'table':
      return block.cells.map((row) => row.map((cell) => plainText(cell.text)).join(' | '))
        .join('\n');
    default:
      return '';
  }
}

/** The readable text of a message: plain text or every rich text block. */
export function messageText(message: PrivateMessage): string {
  if (message.text !== undefined) return message.text;
  const blocks = message.rich_message?.blocks ?? [];
  return blocks.map(blockText).filter((line) => line.length > 0).join('\n');
}

function collectButtons(blocks: readonly RichBlock[], into: VisibleButton[]): void {
  for (const block of blocks) {
    if (block.type === 'buttons') {
      for (const button of block.buttons) addButton(button, into);
    } else if ('blocks' in block) {
      collectButtons(block.blocks, into);
    }
  }
}

function addButton(button: RichMessageButton, into: VisibleButton[]): void {
  if ('callback_data' in button && typeof button.callback_data === 'string') {
    into.push({ label: plainText(button.text), callbackData: button.callback_data });
  }
}

/** Every callback button a message shows, in reading order. */
export function messageButtons(message: PrivateMessage): VisibleButton[] {
  const buttons: VisibleButton[] = [];
  collectButtons(message.rich_message?.blocks ?? [], buttons);
  return buttons;
}

/** A running bot plus one virtual player chatting with it. */
export class E2eWorld {
  readonly #session: EmulationSessionClient;
  readonly #servers: Deno.HttpServer[];
  readonly #bot: ReturnType<typeof createBot>;
  readonly #webhookUrl: string;
  readonly #delivery: DeliveryGate;
  readonly account: VirtualAccountClient;
  readonly botId: number;
  /** Everything the bot called and every update it was handed or confirmed. */
  readonly activity: BotActivityLog;

  private constructor(fields: {
    session: EmulationSessionClient;
    servers: Deno.HttpServer[];
    bot: ReturnType<typeof createBot>;
    webhookUrl: string;
    delivery: DeliveryGate;
    account: VirtualAccountClient;
    botId: number;
  }) {
    this.#session = fields.session;
    this.#servers = fields.servers;
    this.#bot = fields.bot;
    this.#webhookUrl = fields.webhookUrl;
    this.#delivery = fields.delivery;
    this.account = fields.account;
    this.botId = fields.botId;
    this.activity = fields.session.botActivity({ bot_id: fields.botId });
  }

  static async start(options: { playerName?: string; secretToken?: string } = {}) {
    const emulator = startEmulator();
    const session = await emulator.client.createSession();
    const { token, bot: botProfile } = await session.createBot({
      first_name: 'Emberdawn',
      username: 'emberdawn_test_bot',
    });
    const { account } = await session.createAccount({
      first_name: options.playerName ?? 'Ash',
    });

    const bot = createBot({ token, store: new MemoryStore(), apiRoot: session.botApiRoot });
    await bot.init();
    const secretToken = options.secretToken ?? crypto.randomUUID();
    const delivery: DeliveryGate = { opened: Promise.resolve() };
    const handleWebhook = createWebhookHandler({
      handleUpdate: webhookCallback(bot, 'std/http', { secretToken }),
      secretToken,
    });
    const webhookServer = serveLoopback(async (request) => {
      await delivery.opened;
      return handleWebhook(request);
    });
    const webhookUrl = `http://${LOOPBACK}:${webhookServer.addr.port}/webhook`;
    await bot.api.setWebhook(webhookUrl, { secret_token: secretToken });

    return new E2eWorld({
      session,
      servers: [emulator.server, webhookServer],
      bot,
      webhookUrl,
      delivery,
      account,
      botId: botProfile.id,
    });
  }

  get chat(): PrivateMessageTarget {
    return { type: 'private', botId: this.botId };
  }

  /** Re-registers the webhook with another secret, as a misconfigured deploy would. */
  async registerWebhookSecret(secretToken: string): Promise<void> {
    await this.#bot.api.setWebhook(this.#webhookUrl, { secret_token: secretToken });
  }

  /** Waits for the bot to be handed the update that a player action after
   * `start` caused; a refused update is handed over again, so this finds the
   * first attempt. */
  delivered(start: BotActivityPosition, causedBy: (update: Update) => boolean) {
    return this.activity.waitFor({
      kind: 'update_delivered',
      // The log types updates loosely; they are Bot API updates as grammY reads them.
      where: (entry) => causedBy(entry.update as unknown as Update),
    }, { after: start });
  }

  /** Waits until the bot has finished handling the update that a player
   * action after `start` caused, and returns its confirmation. The webhook
   * confirms an update only once the bot's handler has answered 2xx; a
   * failed delivery is handed over again until one is confirmed. */
  async handled(start: BotActivityPosition, causedBy: (update: Update) => boolean) {
    const delivered = await this.delivered(start, causedBy);
    return await this.activity.waitFor(
      { kind: 'update_confirmed', update_id: delivered.update.update_id },
      { after: delivered },
    );
  }

  /** Waits until the bot has finished handling a press of a callback button. */
  pressHandled(start: BotActivityPosition, query: CallbackQuery) {
    return this.handled(start, (update) => update.callback_query?.id === query.id);
  }

  /** Holds the bot's webhook until the returned release is called, so a
   * test can queue several player actions before the bot handles any, as a
   * client does when the bot is slow to answer. */
  holdDeliveries(): () => void {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#delivery.opened = promise;
    return () => {
      this.#delivery.opened = Promise.resolve();
      resolve();
    };
  }

  /** Makes the bot's next calls of a Bot API method fail with 429 Too Many Requests. */
  async rateLimit(method: string, count = 1): Promise<void> {
    await this.#session.queueRateLimitResponses({
      bot_id: this.botId,
      method,
      retry_after: 1,
      count,
    });
  }

  /** Reads the webhook's pending count and last delivery error. The bot's
   * own call is recorded in the activity log like any other. */
  webhookInfo() {
    return this.#bot.api.getWebhookInfo();
  }

  async stop(): Promise<void> {
    await this.#session.end();
    await Promise.all(this.#servers.map((server) => server.shutdown()));
  }
}

/** The player's view of the chat: sends, reads, and taps like a client. */
export class Player {
  constructor(readonly world: E2eWorld) {}

  async send(text: string): Promise<void> {
    const start = await this.world.activity.position();
    const sent = await this.world.account.sendMessage({ to: this.world.chat, text });
    await this.world.handled(start, (update) => update.message?.message_id === sent.message_id);
  }

  history(): Promise<readonly PrivateMessage[]> {
    return this.world.account.getMessages({ chat: this.world.chat });
  }

  async botMessages(): Promise<PrivateMessage[]> {
    return (await this.history()).filter((message) => message.from.id === this.world.botId);
  }

  /** The newest bot message that shows buttons: the one the player plays on. */
  async screen(): Promise<PrivateMessage> {
    const withButtons = (await this.botMessages()).filter((message) =>
      messageButtons(message).length > 0
    );
    const newest = withButtons.at(-1);
    if (!newest) throw new Error('the chat shows no message with buttons');
    return newest;
  }

  async screenText(): Promise<string> {
    return messageText(await this.screen());
  }

  async labels(message?: PrivateMessage): Promise<string[]> {
    return messageButtons(message ?? await this.screen()).map((button) => button.label);
  }

  /** Presses the button whose label matches, on the given message or the
   * current screen, then waits for the bot to finish handling it. */
  async tap(label: string | RegExp, message?: PrivateMessage): Promise<CallbackQuery> {
    const start = await this.world.activity.position();
    const query = await this.press(label, message);
    await this.world.pressHandled(start, query);
    return this.world.account.getCallbackQuery(query.id);
  }

  /** Presses without waiting, for taps that race the bot. */
  async press(label: string | RegExp, message?: PrivateMessage): Promise<CallbackQuery> {
    const target = message ?? await this.screen();
    const button = findButton(target, label);
    return await this.world.account.pressCallbackButton({
      chat: this.world.chat,
      message_id: target.message_id,
      callback_data: button.callbackData,
    });
  }
}

export function findButton(message: PrivateMessage, label: string | RegExp): VisibleButton {
  const buttons = messageButtons(message);
  const button = buttons.find((candidate) =>
    typeof label === 'string' ? candidate.label.includes(label) : label.test(candidate.label)
  );
  if (!button) {
    const shown = buttons.map((candidate) => candidate.label).join(' | ');
    throw new Error(`no button matching ${label} on message ${message.message_id}: ${shown}`);
  }
  return button;
}

/** Runs a test body against a fresh world and player, always tearing down. */
export async function withPlayer(
  body: (player: Player, world: E2eWorld) => Promise<void>,
  options?: Parameters<typeof E2eWorld.start>[0],
): Promise<void> {
  const world = await E2eWorld.start(options);
  try {
    await body(new Player(world), world);
  } finally {
    await world.stop();
  }
}

/** Each class's free basic action, as its battle button reads. */
export const BASIC_ACTION: Record<string, string> = {
  Warrior: 'Strike',
  Mage: 'Arcane Bolt',
  Rogue: 'Quick Attack',
  Cleric: 'Radiant Strike',
};

/** Plays the guided prologue through its buttons: pick a class, take
 * Maren's ember, and win the lesson fight beat by beat (basic action,
 * skill, guard, potion), ending on the unlocked village hub. */
export async function completePrologue(player: Player, className: string): Promise<void> {
  const basicAction = BASIC_ACTION[className]!;
  await player.send('/start');
  await player.tap(`Play ${className}`);
  await player.tap('Speak with Elder Maren');
  await player.tap('Take the ember');
  await player.tap('Face the cinder mite');
  await player.tap(basicAction);
  await player.tap('Skills');
  await player.tap(/MP$/);
  await player.tap('Guard');
  await player.tap('Items');
  await player.tap('Use Minor Potion');
  // The lesson is cleared; ordinary hits now finish the mite.
  for (let round = 0; round < 10 && !(await player.labels()).includes('➡️ Continue'); round++) {
    await player.tap(basicAction);
  }
  await player.tap('Continue');
}
