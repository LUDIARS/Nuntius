/**
 * Discord 用フォーマッタ
 *
 * Discord の markdown は github-flavored に近く、ほぼそのまま通せる。
 * ただし:
 *   - `@everyone` / `@here` は意図しない限り ZWSP を挿入して無効化する
 *   - メッセージ長は最大 2000 文字 (添付やエンベッドでの拡張は別枠)
 *   - payload.content フィールドが実際に送られる
 */

import { fillIfEmpty } from "./index.js";

const DISCORD_MAX_LENGTH = 2000;
const TRUNCATE_SUFFIX    = "…";

/**
 * `@everyone` / `@here` を中和 (ZWSP 挿入)。
 * 明示的に許可したい場合は payload.allowMassMentions=true を渡す。
 */
export function neutralizeMassMentions(md: string): string {
  return md
    .replace(/@everyone/g, "@​everyone")
    .replace(/@here/g,     "@​here");
}

export function truncateForDiscord(s: string): string {
  if (s.length <= DISCORD_MAX_LENGTH) return s;
  return s.slice(0, DISCORD_MAX_LENGTH - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX;
}

export function formatForDiscord(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  const allow = payload.allowMassMentions === true;
  const body = (payload.body as string | undefined) ?? (payload.text as string | undefined);

  if (typeof body === "string" && body.length > 0) {
    let processed = allow ? body : neutralizeMassMentions(body);
    processed = truncateForDiscord(processed);
    // Discord dispatcher は content を読む
    fillIfEmpty(out, "content", processed);
    // text も併設しておく (他用途のメタデータ互換性のため)
    fillIfEmpty(out, "text", processed);
  }
  return out;
}
