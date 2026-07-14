/**
 * Slack 用フォーマッタ (mrkdwn)
 *
 * Slack の mrkdwn は github-flavored markdown と微妙に違う:
 *   - 太字は `*bold*` (not `**bold**`)
 *   - イタリックは `_italic_` (not `*italic*`)
 *   - リンクは `<url|label>` (not `[label](url)`)
 *   - `<`, `>`, `&` は HTML エスケープが必要
 *
 * 入力は共通 markdown 形式を想定。text が既にセットされていれば
 * 尊重し、未セットなら body を mrkdwn に変換して差し込む。
 *
 * refs: https://api.slack.com/reference/surfaces/formatting
 */

import { fillIfEmpty } from "./index.js";

// 非表示の制御文字。bold を一時退避するプレースホルダに使うので、入力
// ユーザーが生で含めてくる可能性はほぼゼロ。
const BOLD_MARK = "";

/** Github-flavored markdown → Slack mrkdwn */
export function markdownToSlackMrkdwn(md: string): string {
  // 1. HTML 的特殊文字をエスケープ (Slack は <> を制御記号に使う)
  let out = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 2. リンク [label](url) → <url|label>  (Slack の山括弧を先に埋める)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, url) => `<${url}|${label}>`);

  // 3. 太字 `**x**` / `__x__` を一旦プレースホルダに退避。
  //    この後のイタリック置換で bold の `*` を食われないようにする。
  out = out.replace(/\*\*([^*]+)\*\*/g, `${BOLD_MARK}$1${BOLD_MARK}`);
  out = out.replace(/__([^_]+)__/g,     `${BOLD_MARK}$1${BOLD_MARK}`);

  // 4. イタリック `*x*` → `_x_`  (行頭の `* ` リスト記号は保護)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1_$2_");
  // `_x_` は Slack でも italic と同じ記法 — 変更不要

  // 5. 打ち消し ~~x~~ → ~x~
  out = out.replace(/~~([^~]+)~~/g, "~$1~");

  // 6. プレースホルダを Slack の太字 `*x*` に復元
  const boldPat = new RegExp(`${BOLD_MARK}([^${BOLD_MARK}]+)${BOLD_MARK}`, "g");
  out = out.replace(boldPat, "*$1*");

  return out;
}

export function formatForSlack(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  const body = (payload.body as string | undefined) ?? (payload.text as string | undefined);
  if (typeof body === "string" && body.length > 0) {
    fillIfEmpty(out, "text", markdownToSlackMrkdwn(body));
  }
  return out;
}
