/**
 * /api/delivery-logs — 配信結果の横断クエリ + 集計
 *
 * messages.ts の /:id/logs は単一メッセージの履歴を返すが、監視・
 * ダッシュボードでは「チャネル横断で成功率を見たい」「直近の失敗を
 * 拾いたい」という用途が中心になる。そのためのフラットな取り出し口と
 * 集計 API を分離して置いておく。
 *
 * すべて projectKey で絞り込む (managed_projects 境界の越境を防ぐ)。
 */

import { Hono } from "hono";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import type { ChannelType } from "../db/schema.js";
import { getProjectKey } from "../middleware/auth.js";

export const deliveryLogsRoutes = new Hono();

/// GET /api/delivery-logs
/// クエリ: channel / success (true|false) / from / to / limit / offset
/// 常に projectKey 内に閉じる (scheduled_messages join 経由で絞り込み)。
deliveryLogsRoutes.get("/", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const q = c.req.query();
  const limit  = Math.min(Math.max(Number(q.limit ?? 100) | 0, 1), 1000);
  const offset = Math.max(Number(q.offset ?? 0) | 0, 0);

  // projectKey に属するメッセージ id の集合を先に取る。scheduled_messages
  // の inner join で filter する方が SQL 的には素直だが、drizzle の query
  // builder を小さく保つためサブクエリ風に 2 段階で書く。件数上限があれば
  // 十分現実的 (~10000 msg/project でも数 KB 程度の集合)。
  const msgIds = (
    await db.select({ id: schema.scheduledMessages.id })
      .from(schema.scheduledMessages)
      .where(eq(schema.scheduledMessages.projectKey, projectKey))
  ).map((r) => r.id);

  if (msgIds.length === 0) {
    return c.json({ items: [], total: 0, limit, offset });
  }

  const conds = [inArray(schema.deliveryLogs.messageId, msgIds)];
  if (q.channel) conds.push(eq(schema.deliveryLogs.channel, q.channel as ChannelType));
  if (q.success === "true")  conds.push(eq(schema.deliveryLogs.success, true));
  if (q.success === "false") conds.push(eq(schema.deliveryLogs.success, false));
  if (q.from) {
    const from = new Date(q.from);
    if (!isNaN(from.getTime())) conds.push(gte(schema.deliveryLogs.attemptedAt, from));
  }
  if (q.to) {
    const to = new Date(q.to);
    if (!isNaN(to.getTime())) conds.push(lte(schema.deliveryLogs.attemptedAt, to));
  }

  const items = await db.select().from(schema.deliveryLogs)
    .where(and(...conds))
    .orderBy(desc(schema.deliveryLogs.attemptedAt))
    .limit(limit)
    .offset(offset);

  const totalRows = await db.select({ n: sql<number>`count(*)::int` })
    .from(schema.deliveryLogs)
    .where(and(...conds));
  const total = totalRows[0]?.n ?? 0;

  return c.json({ items, total, limit, offset });
});

/// GET /api/delivery-logs/stats
/// クエリ: window (分単位、既定 1440 = 直近 24h、最大 43200 = 30 日)
/// 返却: per-channel の attempts / success / failure / success_rate
deliveryLogsRoutes.get("/stats", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const q = c.req.query();
  const windowMin = Math.min(Math.max(Number(q.window ?? 1440) | 0, 1), 43200);
  const since = new Date(Date.now() - windowMin * 60 * 1000);

  const msgIds = (
    await db.select({ id: schema.scheduledMessages.id })
      .from(schema.scheduledMessages)
      .where(eq(schema.scheduledMessages.projectKey, projectKey))
  ).map((r) => r.id);

  if (msgIds.length === 0) {
    return c.json({ window_minutes: windowMin, since: since.toISOString(), channels: [] });
  }

  // PG の GROUP BY 集計を 1 クエリで。drizzle の groupBy + sql helper で。
  const rows = await db.select({
    channel:  schema.deliveryLogs.channel,
    attempts: sql<number>`count(*)::int`,
    success:  sql<number>`count(*) filter (where ${schema.deliveryLogs.success})::int`,
    failure:  sql<number>`count(*) filter (where not ${schema.deliveryLogs.success})::int`,
  })
    .from(schema.deliveryLogs)
    .where(and(
      inArray(schema.deliveryLogs.messageId, msgIds),
      gte(schema.deliveryLogs.attemptedAt, since),
    ))
    .groupBy(schema.deliveryLogs.channel);

  const channels = rows.map((r) => ({
    channel:      r.channel,
    attempts:     r.attempts,
    success:      r.success,
    failure:      r.failure,
    success_rate: r.attempts > 0 ? r.success / r.attempts : 0,
  }));

  return c.json({
    window_minutes: windowMin,
    since: since.toISOString(),
    channels,
  });
});
