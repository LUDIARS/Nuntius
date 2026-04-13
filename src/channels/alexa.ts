/**
 * Alexa 配信 (Proactive Events / Notification API 経由)
 *
 * Phase 1 では Imperativus 経由の音声配信を voice チャネルで扱うため、
 * alexa チャネルは Amazon Alexa Proactive Events API (独立) 用として残す。
 *
 * payload:
 *   userId:           string
 *   notificationId:   string
 *   messageInLocale:  string
 *
 * 環境変数:
 *   ALEXA_CLIENT_ID / ALEXA_CLIENT_SECRET — LWA credentials
 *
 * Phase 2 で LWA 認証・Proactive Events 実装予定。現状は dev モード。
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";

export const alexaDispatcher: ChannelDispatcher = {
  channel: "alexa",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const messageText = p.messageInLocale as string | undefined;
    if (!messageText) {
      return { success: false, error: "alexa payload requires 'messageInLocale'" };
    }

    console.log(`[alexa:dev] userId=${message.userId} msg="${messageText}"`);
    return {
      success: true,
      responseBody: "Phase 1: alexa dev mode (use voice channel via Imperativus for now)",
    };
  },
};
