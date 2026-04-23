/**
 * Nuntius WS コマンド実装
 *
 * Cernere Project WS 経由で Nuntius に届く module_request を処理する。
 * REST API と同じ業務ロジックを共有し、payload と認証済みの userId /
 * projectKey を引数に取るピュア関数として提供する。
 */

import { v4 as uuidv4 } from "uuid";
import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ChannelType } from "../db/schema.js";
import { enqueueMessage, cancelMessage } from "../queue/dispatch-queue.js";
import { isValidRecurrenceRule } from "../queue/recurrence.js";
import { getDispatcher } from "../channels/index.js";
import { encryptField, decryptField } from "../auth/crypto.js";

// ─── 共通型 ────────────────────────────────────────────────

/**
 * WS ハンドラのコンテキスト。Cernere が検証済みの認証情報を注入する。
 * project_token 経由なら projectKey、user_token 経由なら userId がセットされる。
 */
export interface WsContext {
  projectKey: string | null;
  userId: string | null;
}

function requireProject(ctx: WsContext): string {
  if (!ctx.projectKey) {
    throw new Error("project context required (nuntius.* commands must be called via project token)");
  }
  return ctx.projectKey;
}

// ─── nuntius.schedule ─────────────────────────────────────
// REST POST /api/messages/schedule と同ロジック

export interface ScheduleInput {
  userId: string;
  channel: ChannelType;
  sendAt: string;
  payload: Record<string, unknown>;
  source?: string;
  templateId?: string;
  priority?: number;
  recurrenceRule?: string;
  idempotencyKey?: string;
}

export async function scheduleMessage(
  ctx: WsContext,
  input: ScheduleInput,
): Promise<{ id: string; sendAt: string; status: "pending"; duplicated?: boolean }> {
  const projectKey = requireProject(ctx);

  if (!input.userId || !input.channel || !input.sendAt) {
    throw new Error("userId, channel, sendAt are required");
  }
  if (!getDispatcher(input.channel)) {
    throw new Error(`Unsupported channel: ${input.channel}`);
  }
  const sendAt = new Date(input.sendAt);
  if (isNaN(sendAt.getTime())) {
    throw new Error("Invalid sendAt");
  }
  if (input.recurrenceRule && !isValidRecurrenceRule(input.recurrenceRule)) {
    throw new Error(`Invalid recurrenceRule: ${input.recurrenceRule}`);
  }

  if (input.idempotencyKey) {
    const existing = await db.select({ id: schema.scheduledMessages.id })
      .from(schema.scheduledMessages)
      .where(and(
        eq(schema.scheduledMessages.projectKey, projectKey),
        eq(schema.scheduledMessages.idempotencyKey, input.idempotencyKey),
      )).limit(1);
    if (existing.length > 0) {
      return { id: existing[0].id, sendAt: sendAt.toISOString(), status: "pending", duplicated: true };
    }
  }

  const id = uuidv4();
  await db.insert(schema.scheduledMessages).values({
    id,
    source: input.source ?? projectKey,
    userId: input.userId,
    channel: input.channel,
    sendAt,
    recurrenceRule: input.recurrenceRule ?? null,
    payload: input.payload ?? {},
    templateId: input.templateId ?? null,
    priority: input.priority ?? 5,
    idempotencyKey: input.idempotencyKey ?? null,
    projectKey,
  });
  await enqueueMessage(id, sendAt, input.priority ?? 5);
  return { id, sendAt: sendAt.toISOString(), status: "pending" };
}

// ─── nuntius.cancel ──────────────────────────────────────

export async function cancelScheduledMessage(
  ctx: WsContext,
  input: { id: string },
): Promise<{ id: string; status: "cancelled" }> {
  const projectKey = requireProject(ctx);
  if (!input?.id) throw new Error("id is required");

  const rows = await db.select().from(schema.scheduledMessages)
    .where(and(
      eq(schema.scheduledMessages.id, input.id),
      eq(schema.scheduledMessages.projectKey, projectKey),
    )).limit(1);
  if (rows.length === 0) throw new Error("Message not found");

  await db.update(schema.scheduledMessages).set({
    status: "cancelled",
    updatedAt: new Date(),
  }).where(eq(schema.scheduledMessages.id, input.id));
  await cancelMessage(input.id);
  return { id: input.id, status: "cancelled" };
}

// ─── nuntius.publish ─────────────────────────────────────

export interface PublishInput {
  topic: string;
  channel?: ChannelType;
  payload: Record<string, unknown>;
  sendAt?: string;
  source?: string;
}

export async function publishToTopic(
  ctx: WsContext,
  input: PublishInput,
): Promise<{ topic: string; delivered: number; messages: Array<{ id: string; userId: string; channel: ChannelType }> }> {
  const projectKey = requireProject(ctx);
  if (!input?.topic) throw new Error("topic is required");

  const conditions = [
    eq(schema.topicSubscriptions.topic, input.topic),
    eq(schema.topicSubscriptions.projectKey, projectKey),
    eq(schema.topicSubscriptions.enabled, true),
  ];
  if (input.channel) conditions.push(eq(schema.topicSubscriptions.channel, input.channel));

  const subs = await db.select().from(schema.topicSubscriptions).where(and(...conditions));
  const sendAt = input.sendAt ? new Date(input.sendAt) : new Date();
  const created: Array<{ id: string; userId: string; channel: ChannelType }> = [];

  for (const s of subs) {
    const id = uuidv4();
    const endpoint = decryptField(s.endpoint);
    const payload = endpoint
      ? { ...(input.payload ?? {}), webhookUrl: endpoint, url: endpoint, to: endpoint }
      : (input.payload ?? {});
    await db.insert(schema.scheduledMessages).values({
      id,
      source: input.source ?? `topic:${input.topic}`,
      userId: s.userId,
      channel: s.channel,
      sendAt,
      payload,
      projectKey,
    });
    await enqueueMessage(id, sendAt);
    created.push({ id, userId: s.userId, channel: s.channel });
  }
  return { topic: input.topic, delivered: created.length, messages: created };
}

// ─── nuntius.subscribe ───────────────────────────────────

export interface SubscribeInput {
  topic: string;
  userId?: string;
  channel: ChannelType;
  endpoint?: string;
}

export async function subscribeTopic(
  ctx: WsContext,
  input: SubscribeInput,
): Promise<{ id: string; topic: string; enabled: true }> {
  const projectKey = requireProject(ctx);
  if (!input?.topic) throw new Error("topic is required");
  const userId = input.userId ?? ctx.userId;
  if (!userId) throw new Error("userId is required");
  if (!input.channel) throw new Error("channel is required");

  const existing = await db.select().from(schema.topicSubscriptions)
    .where(and(
      eq(schema.topicSubscriptions.topic, input.topic),
      eq(schema.topicSubscriptions.userId, userId),
      eq(schema.topicSubscriptions.channel, input.channel),
      eq(schema.topicSubscriptions.projectKey, projectKey),
    )).limit(1);

  if (existing.length > 0) {
    const newEndpoint = input.endpoint !== undefined
      ? encryptField(input.endpoint)
      : existing[0].endpoint;
    await db.update(schema.topicSubscriptions).set({
      endpoint: newEndpoint,
      enabled: true,
      updatedAt: new Date(),
    }).where(eq(schema.topicSubscriptions.id, existing[0].id));
    return { id: existing[0].id, topic: input.topic, enabled: true };
  }

  const id = uuidv4();
  await db.insert(schema.topicSubscriptions).values({
    id,
    topic: input.topic,
    userId,
    channel: input.channel,
    endpoint: encryptField(input.endpoint ?? null),
    projectKey,
  });
  return { id, topic: input.topic, enabled: true };
}

// ─── nuntius.list_my ─────────────────────────────────────
// ユーザー自身のスケジュール済みメッセージ + inbox (web 通知) を返す。
//
// project_token 経由では projectKey でテナント分離し、任意の userId を指定可。
// user_token 経由では projectKey 横断で自分自身 (ctx.userId) のデータのみ参照可。

export interface ListMyInput {
  userId?: string;
  limit?: number;
  includeInbox?: boolean;
}

export async function listMyMessages(
  ctx: WsContext,
  input: ListMyInput = {},
): Promise<{
  scheduled: Array<{
    id: string;
    channel: ChannelType;
    sendAt: string;
    status: string;
    source: string;
  }>;
  inbox: Array<{
    id: string;
    title: string;
    body: string;
    readAt: string | null;
    createdAt: string;
  }>;
}> {
  if (!ctx.projectKey && !ctx.userId) {
    throw new Error("authentication required");
  }

  const userId = input.userId ?? ctx.userId;
  if (!userId) throw new Error("userId is required");

  // user_token 経由では自分自身のデータしか読めない (他ユーザー指定を禁止)
  if (!ctx.projectKey && ctx.userId && userId !== ctx.userId) {
    throw new Error("forbidden: user token cannot access other user's data");
  }

  const limit = Math.max(1, Math.min(200, input.limit ?? 50));

  const scheduledWhere = ctx.projectKey
    ? and(
        eq(schema.scheduledMessages.userId, userId),
        eq(schema.scheduledMessages.projectKey, ctx.projectKey),
      )
    : eq(schema.scheduledMessages.userId, userId);

  const scheduled = await db.select({
    id: schema.scheduledMessages.id,
    channel: schema.scheduledMessages.channel,
    sendAt: schema.scheduledMessages.sendAt,
    status: schema.scheduledMessages.status,
    source: schema.scheduledMessages.source,
  }).from(schema.scheduledMessages)
    .where(scheduledWhere)
    .orderBy(desc(schema.scheduledMessages.sendAt))
    .limit(limit);

  const includeInbox = input.includeInbox ?? true;
  const inboxWhere = ctx.projectKey
    ? and(
        eq(schema.webNotifications.userId, userId),
        eq(schema.webNotifications.projectKey, ctx.projectKey),
      )
    : eq(schema.webNotifications.userId, userId);

  const inbox = includeInbox
    ? await db.select({
        id: schema.webNotifications.id,
        title: schema.webNotifications.title,
        body: schema.webNotifications.body,
        readAt: schema.webNotifications.readAt,
        createdAt: schema.webNotifications.createdAt,
      }).from(schema.webNotifications)
        .where(inboxWhere)
        .orderBy(desc(schema.webNotifications.createdAt))
        .limit(limit)
    : [];

  return {
    scheduled: scheduled.map((r) => ({
      id: r.id,
      channel: r.channel,
      sendAt: r.sendAt.toISOString(),
      status: r.status,
      source: r.source,
    })),
    inbox: inbox.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

