/**
 * Voice 配信 (Imperativus へリレー)
 *
 * Nuntius は Imperativus に音声合成・再生を依頼する。
 * Imperativus 側に送信 REST エンドポイント (POST /api/voice/speak) があることを前提。
 *
 * payload:
 *   text:     string  — 読み上げテキスト
 *   userId:   string  — 対象ユーザー (デバイスの紐付けは Imperativus 側)
 *   voice?:   string  — 音声種別 (任意)
 *
 * 環境変数:
 *   IMPERATIVUS_URL        — 例: http://localhost:9000
 *   IMPERATIVUS_API_TOKEN  — サービス間認証トークン
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";

export const voiceDispatcher: ChannelDispatcher = {
  channel: "voice",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const text = p.text as string | undefined;
    if (!text) return { success: false, error: "voice payload requires 'text'" };

    const url = process.env.IMPERATIVUS_URL ?? "";
    const apiToken = process.env.IMPERATIVUS_API_TOKEN ?? "";
    if (!url) {
      console.log(`[voice:dev] userId=${message.userId} text="${text}"`);
      return { success: true, responseBody: "dev mode (Imperativus not configured)" };
    }

    const voice = p.voice as string | undefined;
    try {
      const res = await fetch(`${url}/api/voice/speak`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
        },
        body: JSON.stringify({ text, userId: message.userId, voice }),
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
