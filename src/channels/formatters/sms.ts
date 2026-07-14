/**
 * SMS 用フォーマッタ
 *
 * SMS は GSM-7 (7-bit) / UCS-2 (16-bit) のどちらで送るかで長さ上限が
 * 変わる。簡易判定として「BMP 外の文字 / GSM 拡張文字以外の ASCII-
 * 非対応文字」を含む場合を UCS-2 と見なし、70 文字で切り詰める。
 * それ以外は 160 文字。payload.maxLength を指定すればそちらを優先。
 *
 * markdown は解釈されないので stripMarkdown して本文にする。
 */

import { fillIfEmpty, stripMarkdown } from "./index.js";

const GSM7_LIMIT  = 160;
const UCS2_LIMIT  = 70;
const TRUNCATE    = "…";

/** GSM-7 基本 / 拡張テーブル内の文字だけで構成されるか。ASCII 英数字
 *  + 一部記号までを近似でカバーする (厳密な GSM-7 判定ではなく、長さ
 *  計算で安全側に倒すのが目的)。 */
function looksLikeGsm7(s: string): boolean {
  // 非 ASCII を 1 つでも含めば UCS-2 扱い
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E\r\n]*$/.test(s);
}

export function smsLengthLimit(body: string, override?: number): number {
  if (typeof override === "number" && override > 0) return Math.floor(override);
  return looksLikeGsm7(body) ? GSM7_LIMIT : UCS2_LIMIT;
}

export function truncateForSms(body: string, override?: number): string {
  const limit = smsLengthLimit(body, override);
  if (body.length <= limit) return body;
  return body.slice(0, limit - TRUNCATE.length) + TRUNCATE;
}

export function formatForSms(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  const src = (payload.text as string | undefined)
         ?? (payload.body as string | undefined)
         ?? (payload.message as string | undefined);
  if (typeof src === "string" && src.length > 0) {
    const plain = stripMarkdown(src).replace(/\s+\n/g, "\n").trim();
    const override = typeof payload.maxLength === "number" ? payload.maxLength : undefined;
    const body = truncateForSms(plain, override);
    fillIfEmpty(out, "text", body);
    // SMS dispatcher は text のみ読むが、message フィールドも互換のため埋める
    fillIfEmpty(out, "message", body);
  }
  return out;
}
