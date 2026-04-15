/**
 * 繰り返し配信 (recurrence) のスケジュール計算
 *
 * recurrenceRule はまず cron 式として解釈する (5 または 6 フィールド)。
 * cron でパースできない場合、以下の簡易エイリアスを解釈する:
 *
 *   daily         — 0 0 * * *   (毎日 0:00)
 *   hourly        — 0 * * * *   (毎時 00 分)
 *   weekly        — 0 0 * * 0   (毎週日曜 0:00)
 *   monthly       — 0 0 1 * *   (毎月 1 日 0:00)
 *   yearly        — 0 0 1 1 *   (毎年 1/1 0:00)
 *   every:<n>m    — n 分毎
 *   every:<n>h    — n 時間毎
 *   every:<n>d    — n 日毎
 */

import cronParser from "cron-parser";

const CRON_ALIASES: Record<string, string> = {
  daily: "0 0 * * *",
  hourly: "0 * * * *",
  weekly: "0 0 * * 0",
  monthly: "0 0 1 * *",
  yearly: "0 0 1 1 *",
  annually: "0 0 1 1 *",
};

/**
 * 次回配信時刻を計算する。
 * @param rule 繰り返しルール
 * @param from 基準時刻 (既定: 現在時刻)
 * @returns 次回時刻、または null (ルール無効)
 */
export function computeNextSendAt(rule: string, from: Date = new Date()): Date | null {
  if (!rule) return null;
  const trimmed = rule.trim();

  // every:<n>(m|h|d) を解釈
  const everyMatch = /^every:(\d+)([mhd])$/i.exec(trimmed);
  if (everyMatch) {
    const n = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2].toLowerCase();
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = unit === "m" ? n * 60_000
      : unit === "h" ? n * 3_600_000
      : n * 86_400_000;
    return new Date(from.getTime() + ms);
  }

  // エイリアスを cron 式に展開
  const expr = CRON_ALIASES[trimmed.toLowerCase()] ?? trimmed;

  try {
    const iter = cronParser.parseExpression(expr, { currentDate: from });
    const next = iter.next();
    return next.toDate();
  } catch {
    return null;
  }
}

/** ルールが有効かどうかを検証 */
export function isValidRecurrenceRule(rule: string): boolean {
  return computeNextSendAt(rule) !== null;
}
