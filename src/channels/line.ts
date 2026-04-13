/**
 * LINE Messaging API への配信 (push message)
 *
 * payload:
 *   to:       string  — LINE userId / groupId
 *   messages: unknown[] — LINE message objects (最大5件)
 *
 * 環境変数:
 *   LINE_CHANNEL_ACCESS_TOKEN
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";

const LINE_API = "https://api.line.me/v2/bot/message/push";

export const lineDispatcher: ChannelDispatcher = {
  channel: "line",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
    if (!token) {
      return { success: false, error: "LINE_CHANNEL_ACCESS_TOKEN not configured" };
    }

    const p = message.payload as Record<string, unknown>;
    const to = p.to as string | undefined;
    const messages = p.messages as unknown[] | undefined;
    if (!to || !Array.isArray(messages) || messages.length === 0) {
      return { success: false, error: "LINE payload requires 'to' and 'messages'" };
    }

    try {
      const res = await fetch(LINE_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to, messages: messages.slice(0, 5) }),
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
