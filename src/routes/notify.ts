/**
 * /api/notify — channel-agnostic な「ユーザに通知する」エンドポイント
 *
 * 呼び出し側 (Actio / Schedula / 他サービス) が channel を意識せず
 * 「このユーザに title/body を通知して」 を 1 回叩けば、 Nuntius が
 * notification_preferences を引いて適切な channel を選んで配信する。
 *
 * 優先順位:
 *   1. preferences.channels の **先頭から** 順に試し、 endpoint がある最初を採用
 *   2. preference 行が無い → webpush 購読あれば webpush、 無ければ web (inbox) フォールバック
 *
 * 単一 channel への明示送信は引き続き /api/messages/schedule や
 * /api/topics/:topic/publish を使う。
 *
 * sendAt 指定で予約も可能 (Actio が「イベント前 N 分」通知に使う中核)。
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ChannelType } from "../db/schema.js";
import { enqueueMessage } from "../queue/dispatch-queue.js";
import { getProjectKey } from "../middleware/auth.js";

export const notifyRoutes = new Hono();

interface NotifyUserBody {
  /** 送信先ユーザの Cernere users.id */
  userId: string;
  title: string;
  body: string;
  /** クリック遷移先 URL (webpush / web / line で使う) */
  url?: string;
  /** 通知アイコン URL */
  icon?: string;
  /** 同じ tag は新着で置換 (webpush / line) */
  tag?: string;
  /** ISO 8601。 省略 = 即時 */
  sendAt?: string;
  /** どのサービス由来か (例: "actio.event.start_reminder") */
  source?: string;
  /** 重複防止 (同じ key の予約があれば 409) */
  idempotencyKey?: string;
  /** 強制チャネル (preference を無視して指定 channel に送る) */
  forceChannel?: ChannelType;
  /** 追加 metadata (web inbox のメタ等にそのまま入る) */
  metadata?: Record<string, unknown>;
}

interface NotifyResult {
  /** 採用された channel と enqueue 結果 */
  channel: ChannelType;
  messageId: string;
  status: string;
  /** どの channel が試行され、 どれが選ばれなかったか */
  triedChannels?: { channel: ChannelType; reason: string }[];
}

notifyRoutes.post("/user", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const body = await c.req.json<NotifyUserBody>().catch(() => null);
  if (!body || !body.userId || !body.title || !body.body) {
    return c.json({ error: "userId, title, body are required" }, 400);
  }

  const tried: { channel: ChannelType; reason: string }[] = [];

  // 1. forceChannel が指定されていれば preference をスキップ
  let chosen: ChannelType | null = null;
  let extraPayload: Record<string, unknown> = {};

  if (body.forceChannel) {
    const ok = await canSendVia(body.forceChannel, body.userId, projectKey);
    if (!ok.ok) {
      tried.push({ channel: body.forceChannel, reason: ok.reason });
      return c.json({ error: `forceChannel ${body.forceChannel} unavailable: ${ok.reason}`, triedChannels: tried }, 422);
    }
    chosen = body.forceChannel;
    extraPayload = ok.extra ?? {};
  } else {
    // 2. preferences を引く
    const prefRow = (await db
      .select()
      .from(schema.notificationPreferences)
      .where(and(
        eq(schema.notificationPreferences.userId, body.userId),
        eq(schema.notificationPreferences.projectKey, projectKey),
      ))
      .limit(1))[0];

    const order: ChannelType[] = (prefRow?.channels && prefRow.channels.length > 0)
      ? prefRow.channels
      // デフォルト順序: webpush → line → web (inbox)
      : ["webpush", "line", "web"];

    for (const ch of order) {
      const ok = await canSendVia(ch, body.userId, projectKey, prefRow);
      if (ok.ok) {
        chosen = ch;
        extraPayload = ok.extra ?? {};
        break;
      }
      tried.push({ channel: ch, reason: ok.reason });
    }
  }

  if (!chosen) {
    return c.json({ error: "no usable channel for this user", triedChannels: tried }, 422);
  }

  // 3. 各 channel ごとに dispatch payload を組み立てる
  const payload = buildPayload(chosen, body, extraPayload);

  // 4. enqueue
  const messageId = uuidv4();
  const sendAt = body.sendAt ? new Date(body.sendAt) : new Date();
  await db.insert(schema.scheduledMessages).values({
    id: messageId,
    source: body.source ?? "notify.user",
    userId: body.userId,
    channel: chosen,
    sendAt,
    payload,
    status: "pending",
    idempotencyKey: body.idempotencyKey ?? null,
    projectKey,
  } as typeof schema.scheduledMessages.$inferInsert);

  await enqueueMessage(messageId, sendAt);

  const result: NotifyResult = {
    channel: chosen,
    messageId,
    status: "scheduled",
    triedChannels: tried.length > 0 ? tried : undefined,
  };
  return c.json(result);
});

/** 各 channel が「この user に送信可能か」を判定。 OK なら追加 payload を返す。 */
async function canSendVia(
  channel: ChannelType,
  userId: string,
  projectKey: string,
  pref?: typeof schema.notificationPreferences.$inferSelect,
): Promise<{ ok: true; extra?: Record<string, unknown> } | { ok: false; reason: string }> {
  switch (channel) {
    case "webpush": {
      const subs = await db
        .select({ id: schema.pushSubscriptions.id })
        .from(schema.pushSubscriptions)
        .where(and(
          eq(schema.pushSubscriptions.userId, userId),
          eq(schema.pushSubscriptions.projectKey, projectKey),
          isNull(schema.pushSubscriptions.revokedAt),
        ))
        .limit(1);
      return subs.length > 0
        ? { ok: true }
        : { ok: false, reason: "no active push subscription" };
    }
    case "line": {
      const lineUserId = pref?.lineUserId;
      if (!lineUserId) return { ok: false, reason: "no lineUserId in preferences" };
      return {
        ok: true,
        extra: {
          to: lineUserId,
          credentialName: pref?.lineCredentialName ?? "default",
        },
      };
    }
    case "web": {
      // web は誰でも inbox に保存できる (フォールバック先として常に使える)
      return { ok: true };
    }
    case "email": {
      const email = pref?.email;
      return email
        ? { ok: true, extra: { to: email } }
        : { ok: false, reason: "no email in preferences" };
    }
    case "slack": {
      const slackUserId = pref?.slackUserId;
      return slackUserId
        ? { ok: true, extra: { user: slackUserId } }
        : { ok: false, reason: "no slackUserId in preferences" };
    }
    default:
      return { ok: false, reason: `notify.user does not support channel ${channel} yet` };
  }
}

function buildPayload(
  channel: ChannelType,
  body: NotifyUserBody,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  switch (channel) {
    case "webpush":
      return {
        title: body.title,
        body: body.body,
        url: body.url,
        icon: body.icon,
        tag: body.tag,
        data: body.metadata,
      };
    case "line":
      return {
        ...extra, // to, credentialName
        messages: [
          {
            type: "text",
            text: body.url ? `${body.title}\n${body.body}\n${body.url}` : `${body.title}\n${body.body}`,
          },
        ],
      };
    case "web":
      return {
        title: body.title,
        body: body.body,
        link: body.url,
        icon: body.icon,
        metadata: body.metadata ?? {},
      };
    case "email":
      return {
        ...extra,
        subject: body.title,
        text: body.body + (body.url ? `\n\n${body.url}` : ""),
      };
    case "slack":
      return {
        ...extra,
        text: `*${body.title}*\n${body.body}` + (body.url ? `\n${body.url}` : ""),
      };
    default:
      return { title: body.title, body: body.body, ...extra };
  }
}

// ── 通知設定 (preferences) の管理 ────────────────────────────────────────

interface PreferencesBody {
  userId: string;
  channels?: ChannelType[];
  lineUserId?: string;
  lineCredentialName?: string;
  slackUserId?: string;
  email?: string;
}

notifyRoutes.get("/preferences", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "auth required" }, 401);
  const userId = c.req.query("userId");
  if (!userId) return c.json({ error: "userId required" }, 400);
  const row = (await db
    .select()
    .from(schema.notificationPreferences)
    .where(and(
      eq(schema.notificationPreferences.userId, userId),
      eq(schema.notificationPreferences.projectKey, projectKey),
    ))
    .limit(1))[0];
  return c.json({
    preferences: row ?? {
      userId,
      channels: [],
      projectKey,
    },
  });
});

notifyRoutes.put("/preferences", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "auth required" }, 401);
  const body = await c.req.json<PreferencesBody>().catch(() => null);
  if (!body?.userId) return c.json({ error: "userId required" }, 400);

  const existing = (await db
    .select()
    .from(schema.notificationPreferences)
    .where(and(
      eq(schema.notificationPreferences.userId, body.userId),
      eq(schema.notificationPreferences.projectKey, projectKey),
    ))
    .limit(1))[0];

  const values = {
    channels: body.channels ?? existing?.channels ?? [],
    lineUserId: body.lineUserId ?? existing?.lineUserId ?? null,
    lineCredentialName: body.lineCredentialName ?? existing?.lineCredentialName ?? null,
    slackUserId: body.slackUserId ?? existing?.slackUserId ?? null,
    email: body.email ?? existing?.email ?? null,
    updatedAt: new Date(),
  };
  if (existing) {
    await db
      .update(schema.notificationPreferences)
      .set(values)
      .where(eq(schema.notificationPreferences.id, existing.id));
    return c.json({ id: existing.id, status: "updated" });
  }
  const id = uuidv4();
  await db.insert(schema.notificationPreferences).values({
    id,
    userId: body.userId,
    projectKey,
    ...values,
  });
  return c.json({ id, status: "created" });
});
