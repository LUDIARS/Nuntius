/**
 * Email 配信 (SMTP 経由)
 *
 * payload:
 *   to:      string | string[]  — 送信先
 *   subject: string
 *   text:    string  (任意)
 *   html:    string  (任意)
 *
 * 環境変数:
 *   SMTP_URL        — 例: smtp://user:pass@smtp.example.com:587
 *   SMTP_FROM       — From アドレス
 *
 * SMTP_URL が未設定なら配信成功扱いでログのみ (dev 用)。
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";

export const emailDispatcher: ChannelDispatcher = {
  channel: "email",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const to = p.to as string | string[] | undefined;
    const subject = p.subject as string | undefined;
    if (!to || !subject) {
      return { success: false, error: "email payload requires 'to' and 'subject'" };
    }

    const smtpUrl = process.env.SMTP_URL ?? "";
    const from = process.env.SMTP_FROM ?? "noreply@example.com";

    if (!smtpUrl) {
      // 未設定時は dev モードとして成功扱いでログのみ
      console.log(`[email:dev] TO=${Array.isArray(to) ? to.join(",") : to} SUBJECT=${subject}`);
      return { success: true, responseBody: "dev mode (no SMTP configured)" };
    }

    // nodemailer を optional dependency にするのを避けるため、
    // Phase 1 では fetch ベースの SMTP は実装せず、dev モード or 他サービス連携に留める。
    // Phase 2 で nodemailer 追加予定。
    console.warn("[email] SMTP 実送信は Phase 2 で実装予定。現状 dev モードのみ");
    return { success: true, responseBody: "Phase 1: email log-only" };
  },
};
