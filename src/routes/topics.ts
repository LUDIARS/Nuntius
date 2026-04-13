/**
 * /api/topics — Pub/Sub (SNS 的)
 *
 * POST /api/topics/:topic/publish     — トピックに publish → 全 subscribers に配信
 * POST /api/topics/:topic/subscribe   — ユーザーが購読登録
 * DELETE /api/topics/:topic/subscribe — 購読解除
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ChannelType } from "../db/schema.js";
import { enqueueMessage } from "../queue/dispatch-queue.js";
import { getProjectKey, getUserId } from "../middleware/auth.js";

export const topicsRoutes = new Hono();

interface PublishBody {
  channel?: ChannelType;              // 指定時は該当チャネルの subscription にのみ送る
  payload: Record<string, unknown>;
  sendAt?: string;                    // 即時なら省略可
  source?: string;
}

// POST /api/topics/:topic/publish
topicsRoutes.post("/:topic/publish", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const topic = c.req.param("topic");
  const body = await c.req.json<PublishBody>();

  const conditions = [
    eq(schema.topicSubscriptions.topic, topic),
    eq(schema.topicSubscriptions.enabled, true),
  ];
  if (body.channel) {
    conditions.push(eq(schema.topicSubscriptions.channel, body.channel));
  }

  const subs = await db.select().from(schema.topicSubscriptions)
    .where(and(...conditions));

  const sendAt = body.sendAt ? new Date(body.sendAt) : new Date();
  const created: Array<{ id: string; userId: string; channel: ChannelType }> = [];

  for (const s of subs) {
    const id = uuidv4();
    // subscription の endpoint が登録されていれば payload にマージ
    const payload = s.endpoint
      ? { ...body.payload, webhookUrl: s.endpoint, url: s.endpoint, to: s.endpoint }
      : body.payload;

    await db.insert(schema.scheduledMessages).values({
      id,
      source: body.source ?? `topic:${topic}`,
      userId: s.userId,
      channel: s.channel,
      sendAt,
      payload,
      projectKey,
    });
    await enqueueMessage(id, sendAt);
    created.push({ id, userId: s.userId, channel: s.channel });
  }

  return c.json({ topic, delivered: created.length, messages: created });
});

interface SubscribeBody {
  userId?: string;
  channel: ChannelType;
  endpoint?: string;
}

// POST /api/topics/:topic/subscribe
topicsRoutes.post("/:topic/subscribe", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const topic = c.req.param("topic");
  const body = await c.req.json<SubscribeBody>();
  const userId = body.userId ?? getUserId(c);
  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!body.channel) return c.json({ error: "channel is required" }, 400);

  const existing = await db.select().from(schema.topicSubscriptions)
    .where(and(
      eq(schema.topicSubscriptions.topic, topic),
      eq(schema.topicSubscriptions.userId, userId),
      eq(schema.topicSubscriptions.channel, body.channel),
    )).limit(1);

  if (existing.length > 0) {
    await db.update(schema.topicSubscriptions).set({
      endpoint: body.endpoint ?? existing[0].endpoint,
      enabled: true,
      updatedAt: new Date(),
    }).where(eq(schema.topicSubscriptions.id, existing[0].id));
    return c.json({ id: existing[0].id, topic, enabled: true });
  }

  const id = uuidv4();
  await db.insert(schema.topicSubscriptions).values({
    id,
    topic,
    userId,
    channel: body.channel,
    endpoint: body.endpoint ?? null,
    projectKey,
  });
  return c.json({ id, topic, enabled: true }, 201);
});

// DELETE /api/topics/:topic/subscribe
topicsRoutes.delete("/:topic/subscribe", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const topic = c.req.param("topic");
  const userId = c.req.query("userId") ?? getUserId(c);
  const channel = c.req.query("channel") as ChannelType | null;
  if (!userId || !channel) return c.json({ error: "userId and channel are required" }, 400);

  await db.update(schema.topicSubscriptions).set({
    enabled: false,
    updatedAt: new Date(),
  }).where(and(
    eq(schema.topicSubscriptions.topic, topic),
    eq(schema.topicSubscriptions.userId, userId),
    eq(schema.topicSubscriptions.channel, channel),
    eq(schema.topicSubscriptions.projectKey, projectKey),
  ));
  return c.json({ topic, enabled: false });
});
