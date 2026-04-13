/**
 * Slack Incoming Webhook への配信
 *
 * payload:
 *   webhookUrl: string  — 送信先 (未指定時は env の SLACK_DEFAULT_WEBHOOK_URL)
 *   text:       string  — テキスト本文
 *   blocks:     unknown[] (任意) — Block Kit
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";

export const slackDispatcher: ChannelDispatcher = {
  channel: "slack",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const webhookUrl = (p.webhookUrl as string | undefined) ?? process.env.SLACK_DEFAULT_WEBHOOK_URL ?? "";
    if (!webhookUrl) {
      return { success: false, error: "No Slack webhook URL configured" };
    }

    const body: Record<string, unknown> = {};
    if (typeof p.text === "string") body.text = p.text;
    if (Array.isArray(p.blocks)) body.blocks = p.blocks;
    if (Object.keys(body).length === 0) {
      return { success: false, error: "Empty Slack payload (need text or blocks)" };
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
