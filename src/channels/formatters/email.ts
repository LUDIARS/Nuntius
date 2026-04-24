/**
 * Email 用フォーマッタ
 *
 * email の dispatcher は payload.text / payload.html を要求する。どちらか
 * しか無いケースが多いので、欠けている側を自動生成する:
 *   - html のみ → text は innerText 相当を生成
 *   - text (または body) のみ → text はそのまま、html は段落化した最小版
 *
 * body (共通 markdown) が入ってきた場合は両方生成する。
 * subject は resolveTemplate 側で埋められる前提。
 */

import { fillIfEmpty, stripMarkdown } from "./index.js";

/** 非常に単純な html → text 変換。`<br>` と段落タグを改行に、残りの
 *  タグを剥がす。完全な html パーサではないが、生成 email の
 *  `text` fallback には十分。 */
export function htmlToPlainText(html: string): string {
  return html
    // <br>
    .replace(/<br\s*\/?>/gi, "\n")
    // </p>, </div>, </li> → 改行
    .replace(/<\/(p|div|li)>/gi, "\n")
    // <li> の頭に箇条書きマーク
    .replace(/<li[^>]*>/gi, "• ")
    // その他のタグを全部剥がす
    .replace(/<[^>]+>/g, "")
    // 実体参照 (&amp; &lt; &gt; &nbsp; の最小セット)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    // 連続空行を 1 行にまとめる
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 共通 markdown から最低限の html に起こす。リンクと段落だけで十分な
 *  用途。凝った見た目が要るならテンプレート側で html を書く。 */
export function markdownToMinimalHtml(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // リンク [label](url)
  const linked = escaped.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, url) => `<a href="${url}">${label}</a>`,
  );

  // 段落化: 空行区切りを <p>...</p> に、単独改行を <br> に
  const paragraphs = linked.split(/\n{2,}/).map((p) => {
    const withBr = p.replace(/\n/g, "<br>");
    return `<p>${withBr}</p>`;
  });
  return paragraphs.join("\n");
}

export function formatForEmail(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  const body = payload.body as string | undefined;
  const text = payload.text as string | undefined;
  const html = payload.html as string | undefined;

  // 1. どちらも既に入っている → 触らない
  if (text && html) return out;

  // 2. html のみ → text を生成
  if (html && !text) {
    out.text = htmlToPlainText(html);
    return out;
  }

  // 3. text のみ → html は質素な段落化を生成
  if (text && !html) {
    out.html = markdownToMinimalHtml(text);
    return out;
  }

  // 4. どちらも無いが body (共通 markdown) がある → 両方生成
  if (body) {
    out.text = stripMarkdown(body);
    out.html = markdownToMinimalHtml(body);
    return out;
  }

  return out;
}
