/**
 * Voice 配信 (Imperativus へリレー)
 *
 * Nuntius は Imperativus に音声合成・再生を依頼する。
 * Imperativus 側に送信 REST エンドポイント (POST /api/voice/speak) があることを前提。
 *
 * payload:
 *   text:           string  — 読み上げテキスト (必須)
 *   userId:         string  — 対象ユーザー (デバイスの紐付けは Imperativus 側)
 *   voice?:         string  — 音声種別 (任意)
 *   credentialName: string  — channel_credentials.name を参照 (省略時 "default")
 *
 * credentials (JSONB):
 *   { url, apiToken?, voice? }
 *     - url       (必須)  例: http://imperativus:9000
 *     - apiToken  (任意)  サービス間認証ヘッダ
 *     - voice     (任意)  payload.voice が無いときのデフォルト
 *
 * 後方互換: channel_credentials が未登録の場合は env (`IMPERATIVUS_URL` /
 * `IMPERATIVUS_API_TOKEN`) を fallback として読む。両方とも揃わなければ
 * dev モードでログのみ出力する。
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";
import { loadChannelCredentials } from "./credentials.js";

interface VoiceCreds {
  url?: string;
  apiToken?: string;
  voice?: string;
}

async function resolveVoiceCreds(projectKey: string, credName: string): Promise<VoiceCreds> {
  const fromDb = await loadChannelCredentials<VoiceCreds>(projectKey, "voice", credName);
  if (fromDb && fromDb.url) return fromDb;

  // env fallback (旧運用) — DB 未登録時の互換動作
  const envUrl   = process.env.IMPERATIVUS_URL ?? "";
  const envToken = process.env.IMPERATIVUS_API_TOKEN ?? "";
  if (envUrl) {
    return { url: envUrl, apiToken: envToken || undefined };
  }
  // どちらも空ならそのまま返す (呼び出し側が dev モード扱い)
  return fromDb ?? {};
}

export const voiceDispatcher: ChannelDispatcher = {
  channel: "voice",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const text = p.text as string | undefined;
    if (!text) return { success: false, error: "voice payload requires 'text'" };

    const credName = (p.credentialName as string | undefined) ?? "default";
    const creds = await resolveVoiceCreds(message.projectKey, credName);

    if (!creds.url) {
      console.log(`[voice:dev] userId=${message.userId} text="${text}"`);
      return { success: true, responseBody: "dev mode (Imperativus not configured)" };
    }

    const voice = (p.voice as string | undefined) ?? creds.voice;
    try {
      const res = await fetch(`${creds.url}/api/voice/speak`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(creds.apiToken ? { Authorization: `Bearer ${creds.apiToken}` } : {}),
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
