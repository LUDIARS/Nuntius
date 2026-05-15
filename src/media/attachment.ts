/**
 * メディア添付の共通データ型
 *
 * `scheduled_messages.payload.attachments[]` に載る channel-agnostic な添付。
 * 各 dispatcher はこれを自チャネルの表現 (LINE image message / Discord 添付 /
 * Email attachment / ...) に変換する。
 *
 * ソースは 2 モード:
 *   - `url`     … 呼び出し側が用意した公開 URL をそのまま転送 (passthrough)
 *   - `mediaId` … `POST /api/media` で Nuntius にアップロード済みの資産を参照
 * どちらか一方のみ指定する (exactly-one)。
 */

export type MediaKind = "image" | "video" | "audio" | "file";

export const MEDIA_KINDS: readonly MediaKind[] = ["image", "video", "audio", "file"];

export function isMediaKind(v: unknown): v is MediaKind {
  return typeof v === "string" && (MEDIA_KINDS as readonly string[]).includes(v);
}

/** payload.attachments[] の 1 件 (送信側が渡す生の形)。 */
export interface MediaAttachment {
  kind: MediaKind;
  /** passthrough モード: 公開 URL */
  url?: string;
  /** Nuntius ホストモード: media_assets.id */
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  /** bytes */
  size?: number;
  /** チャネルが対応していれば添付ごとのキャプション */
  caption?: string;
  /** LINE image/video の preview。 未指定なら原本を流用 */
  previewUrl?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

/** worker の resolveMedia 後。 `url` は必ず使える状態になっている。 */
export interface ResolvedAttachment extends MediaAttachment {
  url: string;
  mimeType: string;
}

/**
 * payload から attachments を取り出し、 形を検証して返す。
 * 不正な要素 (kind 不正 / url と mediaId が 0 個 or 2 個) は黙って除外する。
 */
export function parseAttachments(payload: Record<string, unknown>): MediaAttachment[] {
  const raw = payload.attachments;
  if (!Array.isArray(raw)) return [];
  const out: MediaAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (!isMediaKind(a.kind)) continue;
    const hasUrl = typeof a.url === "string" && (a.url as string).length > 0;
    const hasMediaId = typeof a.mediaId === "string" && (a.mediaId as string).length > 0;
    // exactly-one: 0 個でも 2 個でも不正
    if (hasUrl === hasMediaId) continue;
    out.push({
      kind: a.kind,
      url: hasUrl ? (a.url as string) : undefined,
      mediaId: hasMediaId ? (a.mediaId as string) : undefined,
      mimeType: typeof a.mimeType === "string" ? (a.mimeType as string) : undefined,
      fileName: typeof a.fileName === "string" ? (a.fileName as string) : undefined,
      size: typeof a.size === "number" ? (a.size as number) : undefined,
      caption: typeof a.caption === "string" ? (a.caption as string) : undefined,
      previewUrl: typeof a.previewUrl === "string" ? (a.previewUrl as string) : undefined,
      width: typeof a.width === "number" ? (a.width as number) : undefined,
      height: typeof a.height === "number" ? (a.height as number) : undefined,
      durationMs: typeof a.durationMs === "number" ? (a.durationMs as number) : undefined,
    });
  }
  return out;
}

/**
 * worker の resolveMedia 後の payload から、 dispatcher が実際に使える
 * (= `url` が埋まっている) 添付だけを取り出す。 dispatcher 側はこれを呼ぶ。
 */
export function dispatchableAttachments(payload: Record<string, unknown>): ResolvedAttachment[] {
  const raw = payload.attachments;
  if (!Array.isArray(raw)) return [];
  const out: ResolvedAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (!isMediaKind(a.kind)) continue;
    if (typeof a.url !== "string" || a.url.length === 0) continue;
    out.push({
      ...(item as MediaAttachment),
      kind: a.kind,
      url: a.url as string,
      mimeType: typeof a.mimeType === "string" && a.mimeType ? (a.mimeType as string) : defaultMime(a.kind),
    });
  }
  return out;
}

/** kind から最低限の Content-Type を補う (mimeType 未指定時のフォールバック)。 */
export function defaultMime(kind: MediaKind): string {
  switch (kind) {
    case "image": return "image/jpeg";
    case "video": return "video/mp4";
    case "audio": return "audio/mpeg";
    case "file":  return "application/octet-stream";
  }
}
