/**
 * LINE Messaging API への配信
 *
 * 2 つの送信モード:
 *   - **push** (既定): 任意のユーザに対して push message API で送る (定額枠あり)
 *   - **reply**: webhook の reply token を使って 1 回だけ無料で返信する
 *
 * payload (push):
 *   to:             string    — LINE userId / groupId
 *   messages?:      unknown[] — LINE message objects (最大5件)
 *   text?:          string    — shortcut。 messages 未指定時に [{type:"text",text}] を自動生成
 *   credentialName: string    — channel_credentials.name (省略時 "default")
 *
 * payload (reply):
 *   replyToken:     string    — LINE webhook で受け取ったトークン (1 回限り、 30 秒以内)
 *   messages? / text? は push と同じ
 *
 * credentials (JSONB): { channelAccessToken: string }
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";
import { loadChannelCredentials } from "./credentials.js";

const LINE_PUSH_API = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";

/** payload.text を渡されたら自動で messages に変換する */
function resolveMessages(p: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(p.messages) && p.messages.length > 0) {
    return p.messages.slice(0, 5);
  }
  if (typeof p.text === "string" && p.text.trim() !== "") {
    return [{ type: "text", text: p.text.slice(0, 5000) }];
  }
  return null;
}

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

    const messages = resolveMessages(p);
    if (!messages) {
      return { success: false, error: "LINE payload requires 'messages' or 'text'" };
    }

    // mode を判定: replyToken があれば reply、 無ければ push
    const replyToken = typeof p.replyToken === "string" ? p.replyToken : undefined;
    const url = replyToken ? LINE_REPLY_API : LINE_PUSH_API;
    const reqBody = replyToken
      ? { replyToken, messages }
      : (() => {
          const to = p.to as string | undefined;
          if (!to) return null;
          return { to, messages };
        })();
    if (!reqBody) {
      return { success: false, error: "LINE push requires 'to' (or use 'replyToken' for reply mode)" };
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(reqBody),
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
