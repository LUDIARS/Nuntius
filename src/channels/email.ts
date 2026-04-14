/**
 * Email 配信 (SMTP / nodemailer)
 *
 * payload:
 *   to:      string | string[]
 *   subject: string
 *   text?:   string
 *   html?:   string
 *   cc?:     string | string[]
 *   bcc?:    string | string[]
 *   replyTo?: string
 *
 * 環境変数:
 *   SMTP_URL   例: smtp://user:pass@smtp.example.com:587
 *              または smtps://... / smtp://... (ローカル MTA)
 *   SMTP_FROM  From アドレス (必須: 未設定なら noreply@localhost)
 *
 * SMTP_URL が未設定の場合は dev モードでログのみ出力する。
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";

// nodemailer Transporter キャッシュ (モジュール単位で 1 つ)
let transporterPromise: Promise<unknown> | null = null;

async function getTransporter(): Promise<unknown | null> {
  const smtpUrl = process.env.SMTP_URL ?? "";
  if (!smtpUrl) return null;

  if (!transporterPromise) {
    transporterPromise = (async () => {
      try {
        const mod = (await import("nodemailer")) as {
          default?: { createTransport: (url: string) => unknown };
          createTransport?: (url: string) => unknown;
        };
        const create = mod.default?.createTransport ?? mod.createTransport;
        if (!create) {
          console.warn("[email] nodemailer.createTransport not found");
          return null;
        }
        return create(smtpUrl);
      } catch (err) {
        console.warn(
          "[email] nodemailer load failed:",
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    })();
  }
  return transporterPromise;
}

interface MailOptions {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

interface Transporter {
  sendMail(opts: MailOptions): Promise<{ messageId?: string; response?: string }>;
}

export const emailDispatcher: ChannelDispatcher = {
  channel: "email",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const to = p.to as string | string[] | undefined;
    const subject = p.subject as string | undefined;
    if (!to || !subject) {
      return { success: false, error: "email payload requires 'to' and 'subject'" };
    }
    if (!p.text && !p.html) {
      return { success: false, error: "email payload requires 'text' or 'html'" };
    }

    const transporter = (await getTransporter()) as Transporter | null;
    const from = process.env.SMTP_FROM ?? "noreply@localhost";

    if (!transporter) {
      console.log(
        `[email:dev] FROM=${from} TO=${Array.isArray(to) ? to.join(",") : to} SUBJECT=${subject}`,
      );
      return { success: true, responseBody: "dev mode (SMTP_URL not configured)" };
    }

    try {
      const res = await transporter.sendMail({
        from,
        to,
        subject,
        text: p.text as string | undefined,
        html: p.html as string | undefined,
        cc: p.cc as string | string[] | undefined,
        bcc: p.bcc as string | string[] | undefined,
        replyTo: p.replyTo as string | undefined,
      });
      return {
        success: true,
        responseBody: res.messageId ? `messageId=${res.messageId}` : res.response ?? "sent",
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
