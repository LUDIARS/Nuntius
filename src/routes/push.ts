/**
 * /api/push — Web Push 購読の管理 + VAPID 公開鍵の配信
 *
 * POST   /api/push/subscriptions    — 購読登録 (PushManager.subscribe() の結果を保存)
 * GET    /api/push/subscriptions    — 自分の登録済み端末一覧
 * DELETE /api/push/subscriptions/:id — 端末を解除
 * GET    /api/push/vapid-public-key — フロントエンドが PushManager.subscribe で使う公開鍵
 *
 * 認証: project token または user token (どちらでも可)。
 * project token の場合は body.userId 必須、 user token は session の userId が使われる。
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import { getProjectKey, getUserId } from "../middleware/auth.js";

export const pushRoutes = new Hono();

interface SubscribeBody {
  /** PushManager.subscribe() の結果 (toJSON()) を素直に */
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  /** 端末ラベル (ユーザが自由に付ける、 例: "iPhone 15 Pro") */
  label?: string;
  /** project token で他ユーザ代理登録する場合 */
  userId?: string;
}

// GET /api/push/vapid-public-key — auth 不要 (公開鍵)
pushRoutes.get("/vapid-public-key", (c) => {
  const key = process.env.VAPID_PUBLIC_KEY ?? "";
  if (!key) {
    return c.json({ error: "VAPID_PUBLIC_KEY not configured on server" }, 503);
  }
  return c.json({ publicKey: key });
});

// POST /api/push/subscriptions
pushRoutes.post("/subscriptions", async (c) => {
  const projectKey = getProjectKey(c);
  const sessionUser = getUserId(c);
  if (!projectKey) return c.json({ error: "auth required" }, 401);

  const body = await c.req.json<SubscribeBody>().catch(() => null);
  if (!body || !body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: "endpoint and keys.{p256dh,auth} are required" }, 400);
  }

  const userId = body.userId ?? sessionUser;
  if (!userId) {
    return c.json({ error: "userId required (use user token or pass body.userId)" }, 400);
  }

  // 既存の同 endpoint があれば revoke を解除して再利用 (端末再購読時の整合性)
  const existing = await db
    .select()
    .from(schema.pushSubscriptions)
    .where(and(
      eq(schema.pushSubscriptions.userId, userId),
      eq(schema.pushSubscriptions.endpoint, body.endpoint),
    ))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    await db
      .update(schema.pushSubscriptions)
      .set({
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: c.req.header("user-agent") ?? null,
        label: body.label ?? row.label ?? null,
        revokedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.pushSubscriptions.id, row.id));
    return c.json({ id: row.id, status: "renewed" });
  }

  const id = uuidv4();
  await db.insert(schema.pushSubscriptions).values({
    id,
    userId,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: c.req.header("user-agent") ?? null,
    label: body.label ?? null,
    projectKey,
  });
  return c.json({ id, status: "created" });
});

// GET /api/push/subscriptions
pushRoutes.get("/subscriptions", async (c) => {
  const projectKey = getProjectKey(c);
  const sessionUser = getUserId(c);
  if (!projectKey) return c.json({ error: "auth required" }, 401);
  const queryUser = c.req.query("userId");
  const userId = queryUser ?? sessionUser;
  if (!userId) {
    return c.json({ error: "userId required" }, 400);
  }

  const rows = await db
    .select({
      id: schema.pushSubscriptions.id,
      label: schema.pushSubscriptions.label,
      userAgent: schema.pushSubscriptions.userAgent,
      lastDeliveredAt: schema.pushSubscriptions.lastDeliveredAt,
      revokedAt: schema.pushSubscriptions.revokedAt,
      createdAt: schema.pushSubscriptions.createdAt,
    })
    .from(schema.pushSubscriptions)
    .where(and(
      eq(schema.pushSubscriptions.userId, userId),
      eq(schema.pushSubscriptions.projectKey, projectKey),
      isNull(schema.pushSubscriptions.revokedAt),
    ));
  return c.json({ subscriptions: rows });
});

// DELETE /api/push/subscriptions/:id
pushRoutes.delete("/subscriptions/:id", async (c) => {
  const projectKey = getProjectKey(c);
  const sessionUser = getUserId(c);
  if (!projectKey) return c.json({ error: "auth required" }, 401);
  const id = c.req.param("id");

  const conditions = [
    eq(schema.pushSubscriptions.id, id),
    eq(schema.pushSubscriptions.projectKey, projectKey),
  ];
  // user token なら自分の subscription だけ消せる
  if (sessionUser) {
    conditions.push(eq(schema.pushSubscriptions.userId, sessionUser));
  }
  await db
    .update(schema.pushSubscriptions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(...conditions));
  return c.json({ ok: true });
});
