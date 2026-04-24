/**
 * LINE Messaging API への配信 (push message)
 *
 * payload:
 *   to:             string  — LINE userId / groupId
 *   messages:       unknown[] — LINE message objects (最大5件)
 *   credentialName: string  — channel_credentials.name を参照 (省略時 "default")
 *
 * credentials (JSONB): { channelAccessToken: string }
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";
import { loadChannelCredentials } from "./credentials.js";

const LINE_API = "https://api.line.me/v2/bot/message/push";

export const lineDispatcher: ChannelDispatcher = {
  channel: "line",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const credName = (p.credentialName as string | undefined) ?? "default";
    const creds = await loadChannelCredentials<{ channelAccessToken?: string }>(
      message.projectKey,
      "line",
      credName,
    );
    const token = creds?.channelAccessToken ?? "";
    if (!token) {
      return { success: false, error: "LINE channelAccessToken not configured (channel_credentials)" };
    }

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
