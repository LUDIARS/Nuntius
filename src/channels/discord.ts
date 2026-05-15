/**
 * Discord Webhook への配信
 *
 * payload:
 *   webhookUrl:     string  — 送信先 URL を直接指定 (最優先)
 *   credentialName: string  — channel_credentials.name を参照 (省略時 "default")
 *   content:        string  — 本文 (2000文字以内)
 *   embeds:         unknown[] (任意)
 *   attachments?:   MediaAttachment[]  — multipart で実体添付 (画像は inline 表示)
 *
 * credentials (JSONB): { webhookUrl: string }
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";
import { loadChannelCredentials } from "./credentials.js";
import { dispatchableAttachments } from "../media/attachment.js";
import { sendDiscordMessage } from "./discord-shared.js";

export const discordDispatcher: ChannelDispatcher = {
  channel: "discord",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    let webhookUrl = (p.webhookUrl as string | undefined) ?? "";
    if (!webhookUrl) {
      const credName = (p.credentialName as string | undefined) ?? "default";
      // 新形式: credentials.token (= webhook URL) / 旧形式: credentials.webhookUrl も互換維持
      const creds = await loadChannelCredentials<{ token?: string; webhookUrl?: string }>(
        message.projectKey,
        "discord",
        credName,
      );
      webhookUrl = creds?.token ?? creds?.webhookUrl ?? "";
    }
    if (!webhookUrl) {
      return { success: false, error: "No Discord webhook URL configured (channel_credentials)" };
    }

    const body: Record<string, unknown> = {};
    if (typeof p.content === "string") body.content = p.content.slice(0, 2000);
    if (Array.isArray(p.embeds)) body.embeds = p.embeds;
    if (Object.keys(body).length === 0 && dispatchableAttachments(p).length === 0) {
      return { success: false, error: "Empty Discord payload (need content, embeds, or attachments)" };
    }

    return sendDiscordMessage({
      url: webhookUrl,
      authHeaders: {},
      jsonBody: body,
      projectKey: message.projectKey,
      payload: p,
    });
  },
};
