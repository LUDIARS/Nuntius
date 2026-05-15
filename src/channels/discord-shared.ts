/**
 * Discord 配信の共通送信ロジック (Webhook / BOT API 共用)
 *
 * payload.attachments[] があれば multipart/form-data で実体添付する。
 * 無ければ従来どおり application/json で送る。
 * 添付バイナリの取得失敗は個別にスキップ (ベストエフォート)。
 */

import type { DispatchResult } from "./types.js";
import { dispatchableAttachments } from "../media/attachment.js";
import { loadAttachmentBytes } from "../media/resolve.js";

export async function sendDiscordMessage(opts: {
  /** 送信先 URL (webhook URL または BOT API の messages エンドポイント) */
  url: string;
  /** Authorization 等の追加ヘッダ (Content-Type は付けない) */
  authHeaders: Record<string, string>;
  /** content / embeds などの JSON 本体 */
  jsonBody: Record<string, unknown>;
  /** 配信元 projectKey (ホスト資産の取得スコープ) */
  projectKey: string;
  /** 解決済み payload (attachments を含む) */
  payload: Record<string, unknown>;
}): Promise<DispatchResult> {
  const { url, authHeaders, jsonBody, projectKey, payload } = opts;
  const attachments = dispatchableAttachments(payload);

  try {
    let res: Response;
    if (attachments.length === 0) {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(jsonBody),
      });
    } else {
      // multipart: payload_json + files[n]
      const form = new FormData();
      const fileMeta: Array<{ id: number; filename: string }> = [];
      let idx = 0;
      for (const a of attachments) {
        try {
          const { buf, mimeType, fileName } = await loadAttachmentBytes(a, projectKey);
          const blob = new Blob([buf], { type: mimeType });
          form.append(`files[${idx}]`, blob, fileName);
          fileMeta.push({ id: idx, filename: fileName });
          idx++;
        } catch (err) {
          console.warn(
            `[discord] attachment skipped (${a.url}):`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      const jsonWithAttachments =
        fileMeta.length > 0 ? { ...jsonBody, attachments: fileMeta } : jsonBody;
      form.append("payload_json", JSON.stringify(jsonWithAttachments));
      // FormData を渡すと fetch が Content-Type (boundary 付き) を自動設定する
      res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders },
        body: form,
      });
    }

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
}
