/**
 * scheduled_messages.templateId が指定されていた場合に、
 * パターンを引いて payload に rendered.subject / rendered.body を差し込む。
 *
 * payload が直接テキストを持っていれば、それを尊重する (override 防止)。
 * payload.values / payload.extraMentions はレンダー材料として消費される。
 */

import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ScheduledMessage } from "../db/schema.js";
import { renderPattern, type TemplateMention } from "../routes/templates.js";

/** payload が既にテキストを持っているなら上書きしない。 */
function fillIfEmpty(
  payload: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
): void {
  if (value === null || value === undefined || value === "") return;
  const cur = payload[key];
  if (typeof cur === "string" && cur.length > 0) return;
  payload[key] = value;
}

/**
 * templateId を解決して payload を書き換えた新しい message を返す。
 * 解決不要な場合は元のオブジェクトをそのまま返す。
 */
export async function resolveTemplate(message: ScheduledMessage): Promise<ScheduledMessage> {
  if (!message.templateId) return message;

  const rows = await db.select().from(schema.messageTemplates)
    .where(and(
      eq(schema.messageTemplates.id, message.templateId),
      eq(schema.messageTemplates.projectKey, message.projectKey),
    )).limit(1);
  if (rows.length === 0) {
    console.warn(`[worker] templateId ${message.templateId} が見つかりません — payload をそのまま使用`);
    return message;
  }
  const pattern = rows[0];

  // パターンの channel が "all" でなく、メッセージのチャネルと異なる場合は警告のみ
  if (pattern.channel !== "all" && pattern.channel !== message.channel) {
    console.warn(
      `[worker] templateId=${pattern.id} の channel=${pattern.channel} と message.channel=${message.channel} が不一致`,
    );
  }

  const raw = (message.payload ?? {}) as Record<string, unknown>;
  const values = (raw.values && typeof raw.values === "object")
    ? raw.values as Record<string, unknown>
    : raw; // values が無ければ payload 全体を values として扱う
  const extraMentions = Array.isArray(raw.extraMentions)
    ? raw.extraMentions as TemplateMention[]
    : [];

  const { subject, body } = renderPattern(pattern, {
    values,
    channel: message.channel,
    extraMentions,
  });

  // payload に差し込み (既存値は保護)
  const newPayload: Record<string, unknown> = { ...raw };
  delete newPayload.values;
  delete newPayload.extraMentions;

  // チャネルごとに利用されるフィールドを埋める
  fillIfEmpty(newPayload, "subject", subject);
  fillIfEmpty(newPayload, "body", body);
  fillIfEmpty(newPayload, "text", body);      // slack / discord / line / sms / voice / webhook
  fillIfEmpty(newPayload, "content", body);   // discord
  fillIfEmpty(newPayload, "message", body);   // sms
  fillIfEmpty(newPayload, "title", subject ?? body.split("\n")[0]?.slice(0, 80) ?? body); // web / alexa

  return { ...message, payload: newPayload };
}
