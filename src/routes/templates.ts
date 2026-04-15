/**
 * /api/templates — 通知パターン (旧: メッセージテンプレート) CRUD
 *
 * 通知パターン = 名前 + チャネル + 本文 + プレースホルダ定義 + メンション候補。
 * 送信側は patternId (= scheduled_messages.templateId) を指定するだけで、
 * worker がパターンを引いて {{var}} / {{@mention}} を解決して配信する。
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ChannelType, MessageTemplate } from "../db/schema.js";
import { getProjectKey } from "../middleware/auth.js";

export const templatesRoutes = new Hono();

// ─── 型定義 ────────────────────────────────────────────────

/** プレースホルダ定義 */
export interface TemplateVariable {
  name: string;
  label?: string;
  description?: string;
  required?: boolean;
  example?: string;
}

/** メンション候補定義 */
export interface TemplateMention {
  /** テンプレート内で `{{@key}}` として参照するキー */
  key: string;
  /** 表示用ラベル */
  label: string;
  /** チャネル固有の実値 (未設定のチャネルは label で代替) */
  channelValues?: Partial<Record<ChannelType | "all", string>>;
}

interface TemplateBody {
  name: string;
  description?: string | null;
  channel?: ChannelType | "all";
  locale?: string;
  subject?: string | null;
  body: string;
  variables?: TemplateVariable[];
  mentions?: TemplateMention[];
}

// ─── CRUD ─────────────────────────────────────────────────

// GET /api/templates — 自プロジェクトのテンプレート一覧
templatesRoutes.get("/", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);
  const channel = c.req.query("channel");
  const rows = await db.select().from(schema.messageTemplates)
    .where(eq(schema.messageTemplates.projectKey, projectKey));
  const filtered = channel ? rows.filter((r) => r.channel === channel || r.channel === "all") : rows;
  return c.json({ templates: filtered });
});

// GET /api/templates/mentions?channel=slack — メンションサジェスト
// 全パターンの mentions を集約し、指定チャネルで解決した一覧を返す。
templatesRoutes.get("/mentions", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);
  const channel = c.req.query("channel") as ChannelType | "all" | undefined;

  const rows = await db.select().from(schema.messageTemplates)
    .where(eq(schema.messageTemplates.projectKey, projectKey));

  // key で重複排除し、指定 channel の値を解決
  const seen = new Map<string, { key: string; label: string; value: string }>();
  for (const row of rows) {
    const mentions = (row.mentions ?? []) as TemplateMention[];
    for (const m of mentions) {
      if (!m?.key) continue;
      if (seen.has(m.key)) continue;
      const value = resolveMentionValue(m, channel);
      seen.set(m.key, { key: m.key, label: m.label, value });
    }
  }
  return c.json({ mentions: Array.from(seen.values()) });
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
    description: body.description ?? null,
    channel: body.channel ?? "all",
    locale: body.locale ?? "ja",
    subject: body.subject ?? null,
    body: body.body,
    variables: body.variables ?? [],
    mentions: body.mentions ?? [],
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
  if (body.description !== undefined) updates.description = body.description;
  if (body.channel !== undefined) updates.channel = body.channel;
  if (body.locale !== undefined) updates.locale = body.locale;
  if (body.subject !== undefined) updates.subject = body.subject;
  if (body.body !== undefined) updates.body = body.body;
  if (body.variables !== undefined) updates.variables = body.variables;
  if (body.mentions !== undefined) updates.mentions = body.mentions;

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

// POST /api/templates/:id/render — プレビュー (values を差し込んだ結果を返す)
templatesRoutes.post("/:id/render", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);
  const id = c.req.param("id");
  const rows = await db.select().from(schema.messageTemplates)
    .where(and(
      eq(schema.messageTemplates.id, id),
      eq(schema.messageTemplates.projectKey, projectKey),
    )).limit(1);
  if (rows.length === 0) return c.json({ error: "Template not found" }, 404);

  const pattern = rows[0];
  const req = await c.req.json<{
    values?: Record<string, unknown>;
    channel?: ChannelType;
    extraMentions?: TemplateMention[];
  }>().catch(() => ({} as Record<string, never>));

  const channel = req.channel ?? (pattern.channel === "all" ? undefined : pattern.channel as ChannelType);
  const rendered = renderPattern(pattern, {
    values: req.values ?? {},
    channel,
    extraMentions: req.extraMentions ?? [],
  });
  return c.json(rendered);
});

// ─── レンダラ (公開ヘルパー) ──────────────────────────────

/** プレースホルダ置換 ({{var}} → values[var]) */
export function renderTemplate(body: string, values: Record<string, unknown>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = values[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** mention をチャネルごとに解決。未設定なら label にフォールバック。 */
function resolveMentionValue(m: TemplateMention, channel?: ChannelType | "all"): string {
  const cv = m.channelValues ?? {};
  if (channel && typeof cv[channel] === "string") return cv[channel] as string;
  if (typeof cv.all === "string") return cv.all;
  return m.label;
}

/**
 * パターンを values + channel で完全に描画する。
 * - `{{var}}` を values で置換
 * - `{{@key}}` を mentions (pattern + extra) で置換、チャネル別に解決
 */
export function renderPattern(
  pattern: Pick<MessageTemplate, "subject" | "body" | "mentions">,
  opts: {
    values?: Record<string, unknown>;
    channel?: ChannelType;
    extraMentions?: TemplateMention[];
  },
): { subject: string | null; body: string } {
  const values = opts.values ?? {};
  const allMentions: TemplateMention[] = [
    ...((pattern.mentions ?? []) as TemplateMention[]),
    ...(opts.extraMentions ?? []),
  ];
  const mentionMap = new Map<string, TemplateMention>();
  for (const m of allMentions) {
    if (m?.key) mentionMap.set(m.key, m); // extra が後勝ち
  }

  const render = (str: string): string => {
    // {{@key}} → mention を先に処理 (key と重ならないよう @ プレフィクス)
    const withMentions = str.replace(/\{\{@([\w.-]+)\}\}/g, (_, key) => {
      const m = mentionMap.get(key);
      return m ? resolveMentionValue(m, opts.channel) : "";
    });
    // {{var}} → values
    return withMentions.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const v = values[key];
      return v === undefined || v === null ? "" : String(v);
    });
  };

  return {
    subject: pattern.subject ? render(pattern.subject) : null,
    body: render(pattern.body),
  };
}
