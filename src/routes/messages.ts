/**
 * /api/messages — スケジュール送信 (SQS 的)
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { eq, and, desc, gte, lte, sql, like, inArray } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ChannelType, MessageStatus } from "../db/schema.js";
import { enqueueMessage, cancelMessage } from "../queue/dispatch-queue.js";
import { isValidRecurrenceRule } from "../queue/recurrence.js";
import { getProjectKey } from "../middleware/auth.js";
import { authorizeUserAccess } from "../middleware/authorize.js";
import { getDispatcher } from "../channels/index.js";

export const messagesRoutes = new Hono();

interface ScheduleBody {
  userId: string;
  channel: ChannelType;
  sendAt: string;            // ISO 8601
  payload: Record<string, unknown>;
  source?: string;
  templateId?: string;
  priority?: number;
  recurrenceRule?: string;
  idempotencyKey?: string;
}

// POST /api/messages/schedule
messagesRoutes.post("/schedule", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const body = await c.req.json<ScheduleBody>();
  if (!body.userId || !body.channel || !body.sendAt) {
    return c.json({ error: "userId, channel, sendAt are required" }, 400);
  }

  if (!getDispatcher(body.channel)) {
    return c.json({ error: `Unsupported channel: ${body.channel}` }, 400);
  }

  const sendAt = new Date(body.sendAt);
  if (isNaN(sendAt.getTime())) {
    return c.json({ error: "Invalid sendAt" }, 400);
  }

  if (body.recurrenceRule && !isValidRecurrenceRule(body.recurrenceRule)) {
    return c.json({ error: `Invalid recurrenceRule: ${body.recurrenceRule}` }, 400);
  }

  // idempotency 確認
  if (body.idempotencyKey) {
    const existing = await db.select({ id: schema.scheduledMessages.id })
      .from(schema.scheduledMessages)
      .where(and(
        eq(schema.scheduledMessages.projectKey, projectKey),
        eq(schema.scheduledMessages.idempotencyKey, body.idempotencyKey),
      )).limit(1);
    if (existing.length > 0) {
      return c.json({ id: existing[0].id, duplicated: true });
    }
  }

  const id = uuidv4();
  await db.insert(schema.scheduledMessages).values({
    id,
    source: body.source ?? projectKey,
    userId: body.userId,
    channel: body.channel,
    sendAt,
    recurrenceRule: body.recurrenceRule ?? null,
    payload: body.payload ?? {},
    templateId: body.templateId ?? null,
    priority: body.priority ?? 5,
    idempotencyKey: body.idempotencyKey ?? null,
    projectKey,
  });

  await enqueueMessage(id, sendAt, body.priority ?? 5);
  return c.json({ id, sendAt: sendAt.toISOString(), status: "pending" }, 201);
});

// DELETE /api/messages/by-source — source 一致で予約メッセージを一括キャンセル
//   query / body:
//     source: 完全一致
//     sourcePrefix: LIKE 'prefix%' (Actio が "actio.event.<id>.reminder." 等で使う)
//   pending のものだけが対象。 既に sent/cancelled は無視。
//
// `/:id` ルートより先に登録すること (Hono は static > param だが明示的に上に置く)。
messagesRoutes.delete("/by-source", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  type Body = { source?: string; sourcePrefix?: string };
  const body = await c.req.json<Body>().catch(() => ({} as Body));
  const source = body.source ?? c.req.query("source");
  const sourcePrefix = body.sourcePrefix ?? c.req.query("sourcePrefix");

  if (!source && !sourcePrefix) {
    return c.json({ error: "source or sourcePrefix is required" }, 400);
  }

  const conds = [
    eq(schema.scheduledMessages.projectKey, projectKey),
    eq(schema.scheduledMessages.status, "pending" as MessageStatus),
  ];
  if (source) conds.push(eq(schema.scheduledMessages.source, source));
  if (sourcePrefix) {
    // LIKE のメタ文字 (% _) を escape して prefix match のみ
    const escaped = sourcePrefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    conds.push(like(schema.scheduledMessages.source, `${escaped}%`));
  }

  const rows = await db.select({ id: schema.scheduledMessages.id })
    .from(schema.scheduledMessages)
    .where(and(...conds));

  if (rows.length === 0) return c.json({ count: 0, ids: [] });

  const ids = rows.map((r) => r.id);
  await db.update(schema.scheduledMessages).set({
    status: "cancelled",
    updatedAt: new Date(),
  }).where(inArray(schema.scheduledMessages.id, ids));

  for (const id of ids) {
    await cancelMessage(id);
  }

  return c.json({ count: ids.length, ids });
});

// DELETE /api/messages/:id — キャンセル
messagesRoutes.delete("/:id", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const id = c.req.param("id");
  const rows = await db.select().from(schema.scheduledMessages)
    .where(and(
      eq(schema.scheduledMessages.id, id),
      eq(schema.scheduledMessages.projectKey, projectKey),
    )).limit(1);
  if (rows.length === 0) return c.json({ error: "Message not found" }, 404);

  const authz = await authorizeUserAccess(c, rows[0].userId, {
    projectKey,
    action: "messages.cancel",
    resource: "scheduled_messages",
    resourceId: id,
  });
  if (!authz.ok) return c.json({ error: authz.error }, authz.status);

  await db.update(schema.scheduledMessages).set({
    status: "cancelled",
    updatedAt: new Date(),
  }).where(eq(schema.scheduledMessages.id, id));
  await cancelMessage(id);

  return c.json({ id, status: "cancelled" });
});

// GET /api/messages/:id — ステータス取得
messagesRoutes.get("/:id", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const id = c.req.param("id");
  const rows = await db.select().from(schema.scheduledMessages)
    .where(and(
      eq(schema.scheduledMessages.id, id),
      eq(schema.scheduledMessages.projectKey, projectKey),
    )).limit(1);
  if (rows.length === 0) return c.json({ error: "Message not found" }, 404);

  const authz = await authorizeUserAccess(c, rows[0].userId, {
    projectKey,
    action: "messages.get",
    resource: "scheduled_messages",
    resourceId: id,
  });
  if (!authz.ok) return c.json({ error: authz.error }, authz.status);

  return c.json(rows[0]);
});

// ─── List / audit endpoints ─────────────────────────────────
//
// admin UI や運用者が「何が予約中 / 失敗したか」を即座に把握できるように
// scheduled_messages を status/channel/userId/date でクエリできる
// 一覧と、メッセージ単位の delivery 試行履歴を公開する。

/// GET /api/messages
/// クエリ: status / channel / userId / from / to / limit (既定 50, 最大 500) / offset
///   - 指定された projectKey のメッセージのみ返す
///   - 並び順は sendAt desc (最新予約から)
messagesRoutes.get("/", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const q = c.req.query();
  const limit  = Math.min(Math.max(Number(q.limit ?? 50) | 0, 1), 500);
  const offset = Math.max(Number(q.offset ?? 0) | 0, 0);

  const conds = [eq(schema.scheduledMessages.projectKey, projectKey)];
  if (q.status)  conds.push(eq(schema.scheduledMessages.status,  q.status as MessageStatus));
  if (q.channel) conds.push(eq(schema.scheduledMessages.channel, q.channel as ChannelType));
  if (q.userId)  conds.push(eq(schema.scheduledMessages.userId,  q.userId));
  if (q.from) {
    const from = new Date(q.from);
    if (!isNaN(from.getTime())) conds.push(gte(schema.scheduledMessages.sendAt, from));
  }
  if (q.to) {
    const to = new Date(q.to);
    if (!isNaN(to.getTime())) conds.push(lte(schema.scheduledMessages.sendAt, to));
  }

  const rows = await db.select().from(schema.scheduledMessages)
    .where(and(...conds))
    .orderBy(desc(schema.scheduledMessages.sendAt))
    .limit(limit)
    .offset(offset);

  // 合計件数 (pagination 用). 小規模運用なら十分、大規模なら後述の
  // cursor ベース listing に差し替え可能。
  const totalRows = await db.select({ n: sql<number>`count(*)::int` })
    .from(schema.scheduledMessages)
    .where(and(...conds));
  const total = totalRows[0]?.n ?? 0;

  return c.json({ items: rows, total, limit, offset });
});

/// GET /api/messages/:id/logs
/// 指定メッセージの delivery_logs を新しい順で返す。リトライの試行経過や
/// エラー内容の参照に使う。
messagesRoutes.get("/:id/logs", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const id = c.req.param("id");
  // projectKey 越境を防ぐため、メッセージ自体の所有確認を先に行う
  const msg = await db.select({ id: schema.scheduledMessages.id })
    .from(schema.scheduledMessages)
    .where(and(
      eq(schema.scheduledMessages.id, id),
      eq(schema.scheduledMessages.projectKey, projectKey),
    )).limit(1);
  if (msg.length === 0) return c.json({ error: "Message not found" }, 404);

  const logs = await db.select().from(schema.deliveryLogs)
    .where(eq(schema.deliveryLogs.messageId, id))
    .orderBy(desc(schema.deliveryLogs.attemptedAt));
  return c.json({ messageId: id, logs });
});
