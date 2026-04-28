/**
 * チャネル dispatcher レジストリ
 */

import type { ChannelType } from "../db/schema.js";
import type { ChannelDispatcher } from "./types.js";
import { slackDispatcher } from "./slack.js";
import { discordDispatcher } from "./discord.js";
import { discordBotDispatcher } from "./discord-bot.js";
import { lineDispatcher } from "./line.js";
import { webhookDispatcher } from "./webhook.js";
import { emailDispatcher } from "./email.js";
import { voiceDispatcher } from "./voice.js";
import { alexaDispatcher } from "./alexa.js";
import { smsDispatcher } from "./sms.js";
import { webDispatcher } from "./web.js";

const dispatchers: Partial<Record<ChannelType, ChannelDispatcher>> = {
  slack: slackDispatcher,
  discord: discordDispatcher,
  discord_bot: discordBotDispatcher,
  line: lineDispatcher,
  webhook: webhookDispatcher,
  email: emailDispatcher,
  voice: voiceDispatcher,
  alexa: alexaDispatcher,
  sms: smsDispatcher,
  web: webDispatcher,
};

export function getDispatcher(channel: ChannelType): ChannelDispatcher | null {
  return dispatchers[channel] ?? null;
}

export function supportedChannels(): ChannelType[] {
  return Object.keys(dispatchers) as ChannelType[];
}
