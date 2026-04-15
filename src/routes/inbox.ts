/**
 * /api/inbox — Web チャネル (in-app 通知) の受信箱
 */

import { Hono } from "hono";
import { eq, and, desc, isNull } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import { getProjectKey } from "../middleware/auth.js";

export const inboxRoutes = new Hono();

// GET /api/inbox?userId=&unread=true&limit=50
inboxRoutes.get("/", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const userId = c.req.query("userId");
  if (!userId) return c.json({ error: "userId query required" }, 400);

  const unreadOnly = c.req.query("unread") === "true";
  const limitParam = c.req.query("limit");
  const limit = Math.max(1, Math.min(200, parseInt(limitParam ?? "50", 10) || 50));

  const whereClause = unreadOnly
    ? and(
        eq(schema.webNotifications.userId, userId),
        eq(schema.webNotifications.projectKey, projectKey),
        isNull(schema.webNotifications.readAt),
      )
    : and(
        eq(schema.webNotifications.userId, userId),
        eq(schema.webNotifications.projectKey, projectKey),
      );

  const rows = await db.select().from(schema.webNotifications)
    .where(whereClause)
    .orderBy(desc(schema.webNotifications.createdAt))
    .limit(limit);

  return c.json({ notifications: rows });
});

// POST /api/inbox/:id/read — 既読化
inboxRoutes.post("/:id/read", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const id = c.req.param("id");
  const rows = await db.select().from(schema.webNotifications)
    .where(and(
      eq(schema.webNotifications.id, id),
      eq(schema.webNotifications.projectKey, projectKey),
    ))
    .limit(1);
  if (rows.length === 0) return c.json({ error: "Notification not found" }, 404);

  await db.update(schema.webNotifications)
    .set({ readAt: new Date() })
    .where(eq(schema.webNotifications.id, id));

  return c.json({ id, readAt: new Date().toISOString() });
});

// DELETE /api/inbox/:id
inboxRoutes.delete("/:id", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const id = c.req.param("id");
  const rows = await db.select().from(schema.webNotifications)
    .where(and(
      eq(schema.webNotifications.id, id),
      eq(schema.webNotifications.projectKey, projectKey),
    ))
    .limit(1);
  if (rows.length === 0) return c.json({ error: "Notification not found" }, 404);

  await db.delete(schema.webNotifications)
    .where(eq(schema.webNotifications.id, id));

  return c.json({ deleted: id });
});
