/**
 * 監査ログ
 *
 * admin ロールのユーザーが自分以外の通知データにアクセスした際に
 * `admin_access_logs` テーブルへ記録する。service-to-service (project_token)
 * 経由の呼び出しはサービス側で追跡するので対象外。
 *
 * 書き込み失敗は握りつぶす (監査ログの DB 障害で本処理を落とさないため、
 * ただし console.error で必ず検知できるようにする)。
 */

import { v4 as uuidv4 } from "uuid";
import { db, schema } from "../db/connection.js";

export interface AdminAccessRecord {
  actorUserId: string;
  projectKey: string;
  action: string;
  resource: "web_notifications" | "scheduled_messages" | "topic_subscriptions" | "message_templates";
  resourceId?: string | null;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAdminAccess(record: AdminAccessRecord): Promise<void> {
  try {
    await db.insert(schema.adminAccessLogs).values({
      id: uuidv4(),
      actorUserId: record.actorUserId,
      projectKey: record.projectKey,
      action: record.action,
      resource: record.resource,
      resourceId: record.resourceId ?? null,
      targetUserId: record.targetUserId ?? null,
      metadata: record.metadata ?? {},
    });
  } catch (err) {
    console.error("[audit] admin access log write failed:", err);
  }
}
