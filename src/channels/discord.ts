/**
 * Discord Webhook への配信
 *
 * payload:
 *   webhookUrl: string  — 送信先 (未指定時は env の DISCORD_DEFAULT_WEBHOOK_URL)
 *   content:    string  — 本文 (2000文字以内)
 *   embeds:     unknown[] (任意)
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";

export const discordDispatcher: ChannelDispatcher = {
  channel: "discord",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const webhookUrl = (p.webhookUrl as string | undefined) ?? process.env.DISCORD_DEFAULT_WEBHOOK_URL ?? "";
    if (!webhookUrl) {
      return { success: false, error: "No Discord webhook URL configured" };
    }

    const body: Record<string, unknown> = {};
    if (typeof p.content === "string") body.content = p.content.slice(0, 2000);
    if (Array.isArray(p.embeds)) body.embeds = p.embeds;
    if (Object.keys(body).length === 0) {
      return { success: false, error: "Empty Discord payload (need content or embeds)" };
    }

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseText = await res.text().catch(() => "");
      return {
        success: res.ok,
        httpStatus: res.status,
        responseBody: responseText.slice(0, 500),
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
