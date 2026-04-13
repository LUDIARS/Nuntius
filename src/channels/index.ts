/**
 * チャネル dispatcher レジストリ
 */

import type { ChannelType } from "../db/schema.js";
import type { ChannelDispatcher } from "./types.js";
import { slackDispatcher } from "./slack.js";
import { discordDispatcher } from "./discord.js";
import { lineDispatcher } from "./line.js";
import { webhookDispatcher } from "./webhook.js";

const dispatchers: Partial<Record<ChannelType, ChannelDispatcher>> = {
  slack: slackDispatcher,
  discord: discordDispatcher,
  line: lineDispatcher,
  webhook: webhookDispatcher,
  // Phase 2+: alexa / email / sms / voice (Imperativus 連携)
};

export function getDispatcher(channel: ChannelType): ChannelDispatcher | null {
  return dispatchers[channel] ?? null;
}

export function supportedChannels(): ChannelType[] {
  return Object.keys(dispatchers) as ChannelType[];
}
