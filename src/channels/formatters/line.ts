/**
 * LINE 用フォーマッタ
 *
 * LINE Messaging API の text type はプレーンテキストを要求し、markdown
 * は解釈されない。共通 markdown body をプレーンに落とす。
 *
 * LINE の text メッセージは最大 5000 文字。超過時は切り詰める。
 */

import { fillIfEmpty, stripMarkdown } from "./index.js";

const LINE_MAX_LENGTH = 5000;
const TRUNCATE_SUFFIX = "…";

export function truncateForLine(s: string): string {
  if (s.length <= LINE_MAX_LENGTH) return s;
  return s.slice(0, LINE_MAX_LENGTH - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX;
}

export function formatForLine(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  const body = (payload.body as string | undefined) ?? (payload.text as string | undefined);
  if (typeof body === "string" && body.length > 0) {
    const plain = truncateForLine(stripMarkdown(body));
    fillIfEmpty(out, "text", plain);
  }
  return out;
}
