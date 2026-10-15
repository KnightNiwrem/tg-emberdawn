/**
 * End-to-end harness: the real bot, in webhook mode as deployed, talking to
 * an in-process Telegram Bot API emulator. The bot calls the Bot API through
 * the emulator's in-process fetch, and the emulator delivers updates to the
 * bot's webhook over loopback HTTP. Tests act as a virtual player through the
 * emulator's account client and assert on what that player's chat shows,
 * never on the store.
 */

import { webhookCallback } from 'grammy';
import type { Update } from 'grammy/types';
import {
  createInProcessEmulator,
  type InProcessEmulator,
} from 'tg-bot-api-emulator/clients/typescript/in_process/mod.ts';
import {
  type ActionOutcome,
  type ActionReceipt,
  type BotActivityLog,
  type BotActivityPosition,
  type ButtonSelector,
  type CallbackQuery,
  type EmulationSessionClient,
  findButton,
  listButtons,
  type MessageButton,
  type PrivateMessage,
  type PrivateMessageTarget,
  richMessageToPlainText,
  type VirtualAccountClient,
} from 'tg-bot-api-emulator/clients/typescript/mod.ts';
import { createBot } from '../../src/bot.ts';
import { MemoryStore } from '../../src/persistence/store.ts';
import { createWebhookHandler } from '../../src/webhook-server.ts';

const LOOPBACK = '127.0.0.1';

/** Serves a handler on an ephemeral loopback port. */
function serveLoopback(handler: Deno.ServeHandler): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve({ hostname: LOOPBACK, port: 0, onListen: () => {} }, handler);
}

/** Webhook requests wait for this before the bot sees them. */
interface DeliveryGate {
  opened: Promise<void>;
}

/** Plain messages and rich game screens share one text assertion surface. */
export function messageText(message: PrivateMessage): string {
  return message.text ??
    (message.rich_message === undefined ? '' : richMessageToPlainText(message.rich_message));
}

/** Recipe headings precede their action row as siblings, outside native `within` scopes. */
export function beside(label: string, text: string): ButtonSelector {
  return (candidate) => {
    if (candidate.label !== label) return false;
    const container = candidate.containers.findLast((part) => part.kind === 'block');
    if (container?.kind !== 'block') return false;
    const preceding = container.siblingBlocks.slice(0, container.index);
    const sectionStart = preceding.findLastIndex((block) => block.type === 'buttons') + 1;
    return richMessageToPlainText({ blocks: preceding.slice(sectionStart) }).includes(text);
  };
}

/** Short labels remain convenient in game flows; native selectors handle scoped controls. */
type ButtonTarget = string | RegExp | ButtonSelector;

function selectorFor(target: ButtonTarget): ButtonSelector {
  if (typeof target === 'string') return (button: MessageButton) => button.label.includes(target);
  return target instanceof RegExp ? { label: target } : target;
}

/** A running bot plus one virtual player chatting with it. */
export class E2eWorld {
  readonly #emulator: InProcessEmulator;
  readonly #session: EmulationSessionClient;
  readonly #webhookServer: Deno.HttpServer;
  readonly #delivery: DeliveryGate;
  readonly account: VirtualAccountClient;
  readonly botId: number;
  /** Everything the bot called and every update it was handed or confirmed. */
  readonly activity: BotActivityLog;

  private constructor(fields: {
    emulator: InProcessEmulator;
    session: EmulationSessionClient;
    webhookServer: Deno.HttpServer;
    delivery: DeliveryGate;
    account: VirtualAccountClient;
    botId: number;
  }) {
    this.#emulator = fields.emulator;
    this.#session = fields.session;
    this.#webhookServer = fields.webhookServer;
    this.#delivery = fields.delivery;
    this.account = fields.account;
    this.botId = fields.botId;
    this.activity = fields.session.botActivity({ bot_id: fields.botId });
  }

  /** Starts a world; a startup that fails disposes of the emulator, which
   * ends the session it opened. */
  static async start(options: { playerName?: string } = {}): Promise<E2eWorld> {
    const emulator = createInProcessEmulator();
    try {
      return await E2eWorld.#open(emulator, options);
    } catch (error) {
      await emulator[Symbol.asyncDispose]();
      throw error;
    }
  }

  static async #open(
    emulator: InProcessEmulator,
    options: { playerName?: string },
  ): Promise<E2eWorld> {
    const { result: session } = await emulator.client.createSession();
    const { result: { token, bot: botProfile } } = await session.createBot({
      first_name: 'Emberdawn',
      username: 'emberdawn_test_bot',
    });
    const { result: { account } } = await session.createAccount({
      first_name: options.playerName ?? 'Ash',
    });

    const bot = createBot({
      token,
      store: new MemoryStore(),
      apiRoot: session.botApiRoot,
      fetch: emulator.fetch,
    });
    await bot.init();
    const secretToken = crypto.randomUUID();
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
    try {
      await bot.api.setWebhook(webhookUrl, { secret_token: secretToken });
    } catch (error) {
      await webhookServer.shutdown();
      throw error;
    }

    return new E2eWorld({
      emulator,
      session,
      webhookServer,
      delivery,
      account,
      botId: botProfile.id,
    });
  }

  get chat(): PrivateMessageTarget {
    return { type: 'private', botId: this.botId };
  }

  /** Waits for the bot to be handed the update that a player action caused,
   * from the action's receipt or an earlier position; a refused update is
   * handed over again, so this finds the first attempt. */
  delivered(start: BotActivityPosition | ActionReceipt, causedBy: (update: Update) => boolean) {
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
  async handled(
    start: BotActivityPosition | ActionReceipt,
    causedBy: (update: Update) => boolean,
  ) {
    const delivered = await this.delivered(start, causedBy);
    return await this.activity.waitFor(
      { kind: 'update_confirmed', update_id: delivered.update.update_id },
      { after: delivered },
    );
  }

  /** Waits until the bot has finished handling a press of a callback button. */
  pressHandled(start: BotActivityPosition | ActionReceipt, query: CallbackQuery) {
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

  async stop(): Promise<void> {
    await this.#session.end();
    await this.#webhookServer.shutdown();
    await this.#emulator[Symbol.asyncDispose]();
  }
}

/** The player's view of the chat: sends, reads, and taps like a client. */
export class Player {
  constructor(readonly world: E2eWorld) {}

  async send(text: string): Promise<void> {
    const { result: sent, receipt } = await this.world.account.sendMessage({
      to: this.world.chat,
      text,
    });
    await this.world.handled(receipt, (update) => update.message?.message_id === sent.message_id);
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
      listButtons(message).length > 0
    );
    const newest = withButtons.at(-1);
    if (!newest) throw new Error('the chat shows no message with buttons');
    return newest;
  }

  async screenText(): Promise<string> {
    return messageText(await this.screen());
  }

  async labels(message?: PrivateMessage): Promise<string[]> {
    return listButtons(message ?? await this.screen()).map((button) => button.label);
  }

  /** Presses the button whose label matches, on the given message or the
   * current screen, then waits for the bot to finish handling it. */
  async tap(
    target: ButtonTarget,
    options: { message?: PrivateMessage } = {},
  ): Promise<CallbackQuery> {
    const { result: query, receipt } = await this.press(target, options);
    await this.world.pressHandled(receipt, query);
    return this.world.account.getCallbackQuery(query.id);
  }

  /** Presses without waiting, for taps that race the bot. */
  async press(
    target: ButtonTarget,
    options: { message?: PrivateMessage } = {},
  ): Promise<ActionOutcome<CallbackQuery>> {
    const message = options.message ?? await this.screen();
    const selector = selectorFor(target);
    if (options.message) {
      // Explicit snapshots preserve the old revision when a test replays a stale control.
      const selected = findButton(message, selector);
      if (!('callback_data' in selected.button)) {
        throw new Error(`button ${selected.label} has no callback action`);
      }
      return await this.world.account.pressCallbackButton({
        chat: this.world.chat,
        message_id: message.message_id,
        callback_data: selected.button.callback_data,
      });
    }
    return await this.world.account.pressButton({
      chat: this.world.chat,
      message_id: message.message_id,
      button: selector,
    });
  }
}

/** Runs a test body against a fresh world and player, always tearing down. */
export async function withPlayer(
  body: (player: Player, world: E2eWorld) => Promise<void>,
  options?: Parameters<typeof E2eWorld.start>[0],
): Promise<void> {
  // Each Deno test file runs in its own realm and its tests run serially.
  // Pin game randomness for reproducible combat; branch-specific actions use withRoll.
  const world = await E2eWorld.start(options);
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    await body(new Player(world), world);
  } finally {
    Math.random = originalRandom;
    await world.stop();
  }
}

/** Selects a random branch while still playing through the real chat and handlers. */
export async function withRoll<Result>(
  roll: number,
  action: () => Promise<Result>,
): Promise<Result> {
  const originalRandom = Math.random;
  Math.random = () => roll;
  try {
    return await action();
  } finally {
    Math.random = originalRandom;
  }
}

/** Each class's free basic action, as its battle button reads. */
export const BASIC_ACTION = {
  Warrior: 'Strike',
  Mage: 'Arcane Bolt',
  Rogue: 'Quick Attack',
  Cleric: 'Radiant Strike',
} as const;

export type HeroClass = keyof typeof BASIC_ACTION;

export const FIRST_SKILL: Record<HeroClass, string> = {
  Warrior: 'Cleave',
  Mage: 'Firebolt',
  Rogue: 'Quick Slash',
  Cleric: 'Smite',
};

/** Plays the guided prologue through its buttons: pick a class, take
 * Maren's ember, and win the lesson fight beat by beat (basic action,
 * skill, guard, potion), ending on the unlocked village hub. */
export async function completePrologue(player: Player, className: HeroClass): Promise<void> {
  const basicAction = BASIC_ACTION[className];
  await startPrologue(player, className);
  await player.tap(basicAction);
  await player.tap('Skills');
  await player.tap(FIRST_SKILL[className]);
  await player.tap('Guard');
  await player.tap('Items');
  await player.tap('Use Minor Potion');
  await winBattle(player, basicAction);
  await player.tap('Continue');
}

export async function startPrologue(player: Player, className: HeroClass): Promise<void> {
  await player.send('/start');
  await player.tap(`Play ${className}`);
  await player.tap('Speak with Elder Maren');
  await player.tap('Take the ember');
  await player.tap('Face the cinder mite');
}

/** Bounded play, with a visible victory required before callers continue. */
export async function winBattle(player: Player, basicAction: string): Promise<void> {
  for (let round = 0; round <= 20; round++) {
    if ((await player.labels()).includes('➡️ Continue')) {
      if (!(await player.screenText()).includes('🏆 Victory')) {
        throw new Error(`expected victory:\n${await player.screenText()}`);
      }
      return;
    }
    if (round < 20) await player.tap(basicAction);
  }
  throw new Error(`battle did not finish within 20 actions:\n${await player.screenText()}`);
}

export async function travelTo(player: Player, destination: string): Promise<void> {
  await player.tap('Travel');
  await player.tap(`Take the road to ${destination}`);
}
