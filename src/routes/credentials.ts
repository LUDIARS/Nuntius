/**
 * /api/credentials — channel_credentials の CRUD
 *
 * - GET    /api/credentials                       project の全 credentials 一覧 (機密値は伏せる)
 * - GET    /api/credentials/:channel/:name        単件取得 (機密値は伏せる)
 * - PUT    /api/credentials/:channel/:name        作成/更新 (credentials JSON 全体)
 * - DELETE /api/credentials/:channel/:name        削除
 *
 * 機密値 (botToken / webhookUrl 等) はレスポンスでマスクし `**configured**` と返す。
 */

import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ChannelType } from "../db/schema.js";
import { getProjectKey } from "../middleware/auth.js";
import { saveChannelCredentials, loadChannelCredentials } from "../channels/credentials.js";

export const credentialsRoutes = new Hono();

const SECRET_KEYS = new Set([
  "botToken", "webhookUrl", "token", "apiKey", "apiSecret", "secret",
  "password", "accessToken", "clientSecret", "signingSecret", "appPassword",
]);

function maskCredentials(plain: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(plain)) {
    if (SECRET_KEYS.has(k) && typeof v === "string" && v.length > 0) {
      out[k] = "**configured**";
    } else {
      out[k] = v;
    }
  }
  return out;
}

credentialsRoutes.get("/", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "project context required" }, 401);

  const rows = await db
    .select({
      channel: schema.channelCredentials.channel,
      name: schema.channelCredentials.name,
      enabled: schema.channelCredentials.enabled,
      updatedAt: schema.channelCredentials.updatedAt,
    })
    .from(schema.channelCredentials)
    .where(eq(schema.channelCredentials.projectKey, projectKey));

  return c.json({ credentials: rows });
});

credentialsRoutes.get("/:channel/:name", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "project context required" }, 401);
  const channel = c.req.param("channel") as ChannelType;
  const name = c.req.param("name");

  const plain = await loadChannelCredentials<Record<string, unknown>>(projectKey, channel, name);
  if (!plain) return c.json({ error: "not found" }, 404);

  return c.json({ channel, name, credentials: maskCredentials(plain) });
});

credentialsRoutes.put("/:channel/:name", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "project context required" }, 401);
  const channel = c.req.param("channel") as ChannelType;
  const name = c.req.param("name");

  const body = await c.req.json<{ credentials: Record<string, unknown>; enabled?: boolean }>().catch(() => null);
  if (!body || typeof body.credentials !== "object" || body.credentials === null) {
    return c.json({ error: "credentials object required" }, 400);
  }

  // **configured** sentinel が来た場合は既存値を引き継ぐ (UI の re-save で漏らさないため)
  const existing = await loadChannelCredentials<Record<string, unknown>>(projectKey, channel, name);
  const merged: Record<string, unknown> = { ...body.credentials };
  for (const [k, v] of Object.entries(merged)) {
    if (v === "**configured**" && existing && k in existing) {
      merged[k] = existing[k];
    }
  }

  await saveChannelCredentials(projectKey, channel, name, merged, body.enabled ?? true);
  return c.json({ ok: true, channel, name });
});

credentialsRoutes.delete("/:channel/:name", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "project context required" }, 401);
  const channel = c.req.param("channel") as ChannelType;
  const name = c.req.param("name");

  await db
    .delete(schema.channelCredentials)
    .where(
      and(
        eq(schema.channelCredentials.projectKey, projectKey),
        eq(schema.channelCredentials.channel, channel),
        eq(schema.channelCredentials.name, name),
      ),
    );
  return c.json({ ok: true });
});
