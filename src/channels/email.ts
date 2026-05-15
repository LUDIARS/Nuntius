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
 *   attachments?: MediaAttachment[]  — 実体添付 (native)。 バイナリを取得して
 *                                     nodemailer の attachments として同梱する。
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
import { dispatchableAttachments } from "../media/attachment.js";
import { loadAttachmentBytes } from "../media/resolve.js";

interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

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
  attachments?: MailAttachment[];
}

/** payload.attachments[] のバイナリを取得して nodemailer 形式に変換する。
 *  個別の取得失敗はスキップ (添付はベストエフォート)。 */
async function buildMailAttachments(
  payload: Record<string, unknown>,
  projectKey: string,
): Promise<MailAttachment[]> {
  const out: MailAttachment[] = [];
  for (const a of dispatchableAttachments(payload)) {
    try {
      const { buf, mimeType, fileName } = await loadAttachmentBytes(a, projectKey);
      out.push({ filename: fileName, content: buf, contentType: mimeType });
    } catch (err) {
      console.warn(
        `[email] attachment skipped (${a.url}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return out;
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

    const attachments = await buildMailAttachments(p, message.projectKey);
    if (!p.text && !p.html && attachments.length === 0) {
      return { success: false, error: "email payload requires 'text', 'html', or 'attachments'" };
    }

    const transporter = (await getTransporter()) as Transporter | null;
    const from = process.env.SMTP_FROM ?? "noreply@localhost";

    if (!transporter) {
      console.log(
        `[email:dev] FROM=${from} TO=${Array.isArray(to) ? to.join(",") : to} SUBJECT=${subject} attachments=${attachments.length}`,
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
        ...(attachments.length > 0 ? { attachments } : {}),
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
