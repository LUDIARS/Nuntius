/**
 * メディア添付の解決
 *
 * worker が dispatch 直前に呼ぶ resolveAttachmentsInPayload で、
 * payload.attachments[] の `mediaId` を実際の公開 URL に変換する。
 * passthrough の `url` 添付はそのまま通す。
 *
 * native 配信 (Email / Discord) は loadAttachmentBytes でバイナリを取得する:
 *   - Nuntius がホストした URL → storage から直接読む (HTTP を介さない)
 *   - 外部 URL → SSRF ガードした上で fetch
 */

import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ResolvedAttachment } from "./attachment.js";
import { parseAttachments, defaultMime } from "./attachment.js";
import { getMediaStorage, mediaPublicUrl, mediaPublicBaseUrl } from "./storage.js";
import { KIND_MAX_BYTES, globalMaxBytes } from "./limits.js";
import { assertSafeFetchUrl } from "./url-guard.js";

/** `.../media/<id>` の末尾から id を取り出す。 */
const HOSTED_RE = /\/media\/([A-Za-z0-9_-]+)\/?$/;

/**
 * payload.attachments の mediaId を解決し、 全添付が `url` を持つ状態にする。
 * worker が dispatch 直前に 1 回だけ呼ぶ。 attachments が無ければ payload をそのまま返す。
 * 解決できない (存在しない / 期限切れ) mediaId 添付は静かに除外する。
 */
export async function resolveAttachmentsInPayload(
  payload: Record<string, unknown>,
  projectKey: string,
): Promise<Record<string, unknown>> {
  const atts = parseAttachments(payload);
  if (atts.length === 0) return payload;

  const resolved: ResolvedAttachment[] = [];
  for (const a of atts) {
    if (a.url) {
      // passthrough: 呼び出し側の URL をそのまま使う
      resolved.push({ ...a, url: a.url, mimeType: a.mimeType ?? defaultMime(a.kind) });
      continue;
    }
    if (!a.mediaId) continue;
    const rows = await db
      .select()
      .from(schema.mediaAssets)
      .where(
        and(
          eq(schema.mediaAssets.id, a.mediaId),
          eq(schema.mediaAssets.projectKey, projectKey),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      console.warn(`[media] mediaId not found (project=${projectKey} id=${a.mediaId})`);
      continue;
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      console.warn(`[media] mediaId expired (id=${a.mediaId})`);
      continue;
    }
    resolved.push({
      kind: a.kind,
      url: mediaPublicUrl(row.id),
      mimeType: row.mimeType,
      fileName: a.fileName ?? row.fileName ?? undefined,
      size: a.size ?? row.size,
      caption: a.caption,
      previewUrl: a.previewUrl,
      width: a.width,
      height: a.height,
      durationMs: a.durationMs,
      mediaId: row.id,
    });
  }
  return { ...payload, attachments: resolved };
}

/** mimeType から拡張子を雑に補う (fileName 未指定時のフォールバック)。 */
function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "application/pdf": "pdf",
  };
  return map[mimeType.toLowerCase()] ?? "bin";
}

/**
 * native 配信用にバイナリを取得する。
 * Nuntius ホスト由来は storage から直接、 外部 URL は SSRF ガード付き fetch。
 */
export async function loadAttachmentBytes(
  att: ResolvedAttachment,
  projectKey: string,
): Promise<{ buf: Buffer; mimeType: string; fileName: string }> {
  const fallbackName = att.fileName ?? `attachment.${extFromMime(att.mimeType)}`;

  // 1) Nuntius がホストした URL か判定
  const m = att.url.match(HOSTED_RE);
  const base = mediaPublicBaseUrl();
  const looksHosted =
    !!m && (base === "" || att.url.startsWith(base) || att.url.startsWith("/media/"));
  if (m && looksHosted) {
    const id = m[1];
    const rows = await db
      .select()
      .from(schema.mediaAssets)
      .where(
        and(
          eq(schema.mediaAssets.id, id),
          eq(schema.mediaAssets.projectKey, projectKey),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row) {
      const storage = getMediaStorage();
      if (storage && storage.backend === row.storageBackend) {
        const buf = await storage.getBuffer(row.storageKey);
        return { buf, mimeType: row.mimeType, fileName: row.fileName ?? fallbackName };
      }
    }
    // 行が無い / backend 不一致 → 下の HTTP 取得にフォールバック
  }

  // 2) 外部 URL → SSRF ガード + fetch
  assertSafeFetchUrl(att.url);
  const res = await fetch(att.url);
  if (!res.ok) {
    throw new Error(`fetch attachment failed: HTTP ${res.status}`);
  }
  // サイズ上限チェック (Content-Length が信用できる範囲で)
  const cap = globalMaxBytes() || KIND_MAX_BYTES[att.kind];
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > 0 && declared > cap) {
    throw new Error(`attachment too large: ${declared} > ${cap}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > cap) {
    throw new Error(`attachment too large: ${buf.length} > ${cap}`);
  }
  const mimeType =
    res.headers.get("content-type")?.split(";")[0]?.trim() || att.mimeType;
  return { buf, mimeType, fileName: fallbackName };
}
