/**
 * 汎用 Webhook への配信
 *
 * payload:
 *   url:     string             — 送信先 URL
 *   method:  "POST" | "PUT"    (default: "POST")
 *   headers: Record<string,string> (任意)
 *   body:    unknown            — JSON 本体
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";

export const webhookDispatcher: ChannelDispatcher = {
  channel: "webhook",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const url = p.url as string | undefined;
    if (!url) return { success: false, error: "webhook payload requires 'url'" };

    const method = (p.method as string | undefined) ?? "POST";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((p.headers as Record<string, string> | undefined) ?? {}),
    };

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(p.body ?? {}),
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
