/**
 * /api/templates — メッセージテンプレート CRUD
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ChannelType } from "../db/schema.js";
import { getProjectKey } from "../middleware/auth.js";

export const templatesRoutes = new Hono();

interface TemplateBody {
  name: string;
  channel?: ChannelType | "all";
  locale?: string;
  subject?: string | null;
  body: string;
  variables?: unknown[];
}

// GET /api/templates — 自プロジェクトのテンプレート一覧
templatesRoutes.get("/", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);
  const rows = await db.select().from(schema.messageTemplates)
    .where(eq(schema.messageTemplates.projectKey, projectKey));
  return c.json({ templates: rows });
});

// POST /api/templates — 作成
templatesRoutes.post("/", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);
  const body = await c.req.json<TemplateBody>();
  if (!body.name || !body.body) {
    return c.json({ error: "name and body are required" }, 400);
  }
  const id = uuidv4();
  await db.insert(schema.messageTemplates).values({
    id,
    name: body.name,
    channel: body.channel ?? "all",
    locale: body.locale ?? "ja",
    subject: body.subject ?? null,
    body: body.body,
    variables: body.variables ?? [],
    projectKey,
  });
  return c.json({ id, name: body.name }, 201);
});

// GET /api/templates/:id
templatesRoutes.get("/:id", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);
  const id = c.req.param("id");
  const rows = await db.select().from(schema.messageTemplates)
    .where(and(
      eq(schema.messageTemplates.id, id),
      eq(schema.messageTemplates.projectKey, projectKey),
    )).limit(1);
  if (rows.length === 0) return c.json({ error: "Template not found" }, 404);
  return c.json(rows[0]);
});

// PUT /api/templates/:id
templatesRoutes.put("/:id", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);
  const id = c.req.param("id");
  const body = await c.req.json<Partial<TemplateBody>>();

  const existing = await db.select({ id: schema.messageTemplates.id })
    .from(schema.messageTemplates)
    .where(and(
      eq(schema.messageTemplates.id, id),
      eq(schema.messageTemplates.projectKey, projectKey),
    )).limit(1);
  if (existing.length === 0) return c.json({ error: "Template not found" }, 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.channel !== undefined) updates.channel = body.channel;
  if (body.locale !== undefined) updates.locale = body.locale;
  if (body.subject !== undefined) updates.subject = body.subject;
  if (body.body !== undefined) updates.body = body.body;
  if (body.variables !== undefined) updates.variables = body.variables;

  await db.update(schema.messageTemplates).set(updates)
    .where(eq(schema.messageTemplates.id, id));
  return c.json({ id, updated: true });
});

// DELETE /api/templates/:id
templatesRoutes.delete("/:id", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);
  const id = c.req.param("id");
  await db.delete(schema.messageTemplates).where(and(
    eq(schema.messageTemplates.id, id),
    eq(schema.messageTemplates.projectKey, projectKey),
  ));
  return c.json({ id, deleted: true });
});

/** プレースホルダ置換ヘルパー ({{var}} → values[var]) */
export function renderTemplate(body: string, values: Record<string, unknown>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = values[key];
    return v === undefined || v === null ? "" : String(v);
  });
}
