/**
 * メディア添付の制約定義
 *
 * - kind 別の受け入れ上限 (Nuntius にアップロードできるサイズ)
 * - kind 別の許可 MIME プレフィックス
 * - チャネル別のメディア対応レベル (dispatcher の degrade 判定に使う)
 */

import type { MediaKind } from "./attachment.js";
import type { ChannelType } from "../db/schema.js";

/** 環境変数 NUNTIUS_MEDIA_MAX_BYTES (全体上限)。 未設定なら 0 = kind 別上限のみ。 */
export function globalMaxBytes(): number {
  const raw = Number(process.env.NUNTIUS_MEDIA_MAX_BYTES ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** kind 別の Nuntius 受け入れ上限 (bytes)。 各チャネル固有の上限とは別。 */
export const KIND_MAX_BYTES: Record<MediaKind, number> = {
  image: 10 * 1024 * 1024,   // 10 MB
  video: 200 * 1024 * 1024,  // 200 MB
  audio: 50 * 1024 * 1024,   // 50 MB
  file: 50 * 1024 * 1024,    // 50 MB
};

/** kind 別の許可 MIME プレフィックス。 これに前方一致しないものは拒否。 */
export const ALLOWED_MIME_PREFIX: Record<MediaKind, string[]> = {
  image: ["image/"],
  video: ["video/"],
  audio: ["audio/"],
  file: ["application/", "text/"],
};

/**
 * アップロード時の (kind, mimeType, size) を検証する。
 * 問題なければ null、 あればエラーメッセージを返す。
 */
export function validateUpload(
  kind: MediaKind,
  mimeType: string,
  size: number,
): string | null {
  const prefixes = ALLOWED_MIME_PREFIX[kind];
  if (!prefixes.some((p) => mimeType.toLowerCase().startsWith(p))) {
    return `mimeType "${mimeType}" not allowed for kind "${kind}"`;
  }
  const kindLimit = KIND_MAX_BYTES[kind];
  if (size > kindLimit) {
    return `size ${size} exceeds ${kind} limit ${kindLimit}`;
  }
  const gMax = globalMaxBytes();
  if (gMax > 0 && size > gMax) {
    return `size ${size} exceeds NUNTIUS_MEDIA_MAX_BYTES ${gMax}`;
  }
  return null;
}

/**
 * チャネルが各 kind をどう扱えるか。
 *   - "native" … バイナリを実体添付できる (Email / Discord)
 *   - "url"    … 公開 URL を渡す形なら配信できる (LINE / Web / Webhook / Slack / SMS など)
 *   - "none"   … そもそも添付を運べない → dispatcher は無視 (delivery_logs に degrade を記録)
 */
export type ChannelMediaSupport = "native" | "url" | "none";

export const CHANNEL_MEDIA_SUPPORT: Record<ChannelType, Record<MediaKind, ChannelMediaSupport>> = {
  // Email: nodemailer の attachments で実体添付できる
  email:       { image: "native", video: "native", audio: "native", file: "native" },
  // Discord: webhook / bot とも multipart で実体添付できる
  discord:     { image: "native", video: "native", audio: "native", file: "native" },
  discord_bot: { image: "native", video: "native", audio: "native", file: "native" },
  // LINE: image/video/audio は originalContentUrl (URL) が必須。 file 型は汎用メッセージが無い
  line:        { image: "url",    video: "url",    audio: "url",    file: "url"  },
  // Web (in-app): metadata.attachments に URL を保存、 クライアントが描画
  web:         { image: "url",    video: "url",    audio: "url",    file: "url"  },
  // Webhook: 受け側に attachments[] をそのまま渡す
  webhook:     { image: "url",    video: "url",    audio: "url",    file: "url"  },
  // WebPush: image は通知の大画像に使える。 video/audio/file は運べない
  webpush:     { image: "url",    video: "none",   audio: "none",   file: "none" },
  // Slack: Incoming Webhook はファイルアップロード不可 → 公開 URL を本文に degrade
  slack:       { image: "url",    video: "url",    audio: "url",    file: "url"  },
  // SMS: SNS の電話番号宛 publish は MMS 非対応 → 本文末尾に URL を degrade
  sms:         { image: "url",    video: "url",    audio: "url",    file: "url"  },
  // Voice: Imperativus は音声再生。 audio の URL のみ意味を持つ
  voice:       { image: "none",   video: "none",   audio: "url",    file: "none" },
  // Alexa: Proactive Events はメディア添付の口が無い
  alexa:       { image: "none",   video: "none",   audio: "none",   file: "none" },
};

/** チャネル × kind の対応レベルを引く。 */
export function channelSupport(channel: ChannelType, kind: MediaKind): ChannelMediaSupport {
  return CHANNEL_MEDIA_SUPPORT[channel]?.[kind] ?? "none";
}
