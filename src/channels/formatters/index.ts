/**
 * チャネル別メッセージフォーマッタ
 *
 * テンプレートの `body` / `subject` は Markdown ライクな共通記法で
 * 書かれる想定。ここではそれを実際に各チャネルの要求する記法に
 * 変換 (Slack mrkdwn / Discord markdown / LINE plaintext / SMS 長さ制限
 * / Email html↔text 補完) し、payload を書き換える。
 *
 * 設計方針:
 *  - **純粋関数**: 各 formatter は payload を受け取って新しい payload を
 *    返す。副作用なし・I/O なし。
 *  - **既存値は保護**: payload に既にチャネル固有のフィールドが入って
 *    いればそれを尊重し、フォーマッタは「空のフィールドを埋める」側に
 *    立つ。`resolveTemplate` と同じ `fillIfEmpty` スタンス。
 *  - **worker から 1 回だけ呼ぶ**: resolveTemplate → applyChannelFormat
 *    → dispatcher.dispatch の順に挟む。
 */

import type { ChannelType } from "../../db/schema.js";
import { formatForSlack }   from "./slack.js";
import { formatForDiscord } from "./discord.js";
import { formatForLine }    from "./line.js";
import { formatForSms }     from "./sms.js";
import { formatForEmail }   from "./email.js";

export type Formatter = (payload: Record<string, unknown>) => Record<string, unknown>;

const FORMATTERS: Partial<Record<ChannelType, Formatter>> = {
  slack:   formatForSlack,
  discord: formatForDiscord,
  line:    formatForLine,
  sms:     formatForSms,
  email:   formatForEmail,
};

/**
 * チャネルに応じた変換を payload に適用する。未登録チャネル
 * (webhook / alexa / voice / web) は素通し。
 */
export function applyChannelFormat(
  channel: ChannelType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const fn = FORMATTERS[channel];
  return fn ? fn(payload) : payload;
}

// ─── shared helpers (exported for dedicated formatter modules) ──

/** 値が空文字 / null / undefined なら上書きする。 */
export function fillIfEmpty(
  out: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
): void {
  if (value === null || value === undefined || value === "") return;
  const cur = out[key];
  if (typeof cur === "string" && cur.length > 0) return;
  out[key] = value;
}

/**
 * 入力 markdown から強調・リンク・コード記法を**落とした plain text** を
 * 返す。Slack / Discord 以外のチャネル向けフォールバックに使う。
 */
export function stripMarkdown(md: string): string {
  return md
    // コードブロック ``` ... ``` → 中身
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/^```\w*\n?|```$/g, ""))
    // インラインコード `x` → x
    .replace(/`([^`]+)`/g, "$1")
    // 画像 ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // リンク [text](url) → text (url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    // 太字 **x** / __x__ → x
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // イタリック *x* / _x_ → x (行頭の * リスト記号は保護)
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1$2")
    // 打ち消し ~~x~~ → x
    .replace(/~~([^~]+)~~/g, "$1");
}
