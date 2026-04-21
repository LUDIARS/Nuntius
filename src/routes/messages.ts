/**
 * /api/messages — スケジュール送信 (SQS 的)
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ChannelType } from "../db/schema.js";
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
