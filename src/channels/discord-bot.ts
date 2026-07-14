/**
 * Discord BOT API 経由の配信
 *
 * BOT トークンは Nuntius 共有のもの (env: NUNTIUS_DISCORD_BOT_TOKEN) を既定で使う。
 * 個別 credential で `botToken` を指定すれば override 可能。
 *
 * payload:
 *   credentialName: string  — channel_credentials.name を参照 (省略時 "default")
 *   content:        string  — 本文 (2000文字以内)
 *   embeds:         unknown[] (任意)
 *   attachments?:   MediaAttachment[]  — multipart で実体添付 (画像は inline 表示)
 *
 * credentials (JSONB): { channelId: string; serverId: string; botToken?: string }
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";
import { loadChannelCredentials } from "./credentials.js";
import { dispatchableAttachments } from "../media/attachment.js";
import { sendDiscordMessage } from "./discord-shared.js";

interface DiscordBotCredentials {
  /** 新形式: token = bot token (空なら共有 BOT) */
  token?: string;
  /** 旧形式互換 */
  botToken?: string;
  /** channel/server は payload.channelId と pattern.channelConfig 経由で渡される想定。
      下位互換で credentials 側の channelId/serverId も読む。 */
  channelId?: string;
  serverId?: string;
}

const DISCORD_API = "https://discord.com/api/v10";

/** 共有 BOT token を env から取得 (override は credentials.botToken 側) */
export function getSharedBotToken(): string {
  return process.env.NUNTIUS_DISCORD_BOT_TOKEN ?? "";
}

export const discordBotDispatcher: ChannelDispatcher = {
  channel: "discord_bot",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const credName = (p.credentialName as string | undefined) ?? "default";
    const creds = await loadChannelCredentials<DiscordBotCredentials>(
      message.projectKey,
      "discord_bot",
      credName,
    );
    // channelId は payload (送信時 or pattern.channelConfig) から、無ければ credentials 側で
    const channelId = (p.channelId as string | undefined) ?? creds?.channelId ?? "";
    if (!channelId) {
      return { success: false, error: "Discord BOT: channelId required (payload or pattern.channelConfig.channelId)" };
    }
    const botToken = (creds?.token || creds?.botToken) || getSharedBotToken();
    if (!botToken) {
      return { success: false, error: "No bot token (NUNTIUS_DISCORD_BOT_TOKEN env not set, no per-credential override)" };
    }

    const body: Record<string, unknown> = {};
    if (typeof p.content === "string") body.content = p.content.slice(0, 2000);
    if (Array.isArray(p.embeds)) body.embeds = p.embeds;
    if (Object.keys(body).length === 0 && dispatchableAttachments(p).length === 0) {
      return { success: false, error: "Empty Discord payload (need content, embeds, or attachments)" };
    }

    return sendDiscordMessage({
      url: `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages`,
      authHeaders: { Authorization: `Bot ${botToken}` },
      jsonBody: body,
      projectKey: message.projectKey,
      payload: p,
    });
  },
};
