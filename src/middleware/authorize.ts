/**
 * ユーザーリソースの認可ヘルパー
 *
 * REST ルートで「他ユーザーの通知データを触れるのは誰か」を集中管理する。
 *
 *  - service (project_token) : service-to-service の信頼経路。全ユーザー可。
 *  - admin   (role=admin)    : admin UI からの操作。全ユーザー可だが監査ログ必須。
 *  - user    (一般ユーザー)  : 自分の userId のみ。
 *
 * 戻り値が 401/403 相当の Response オブジェクトならそのまま返せる。
 */

import type { Context } from "hono";
import { getActorKind, getUserId } from "./auth.js";
import { logAdminAccess, type AdminAccessRecord } from "../audit/logger.js";

export type AuthzOutcome =
  | { ok: true; actor: "service" | "admin" | "user"; sessionUserId: string | null }
  | { ok: false; status: 401 | 403; error: string };

/**
 * `targetUserId` のリソースにアクセスしてよいか判定する。
 * admin アクセスなら同期的に監査ログを書き込む (targetUserId が actor と一致する場合は
 * 自分自身の操作と見なし、ログは残さない)。
 */
export async function authorizeUserAccess(
  c: Context,
  targetUserId: string,
  audit: Omit<AdminAccessRecord, "actorUserId" | "projectKey" | "targetUserId"> & {
    projectKey: string;
  },
): Promise<AuthzOutcome> {
  const kind = getActorKind(c);
  const sessionUserId = getUserId(c);

  if (kind === "service") {
    return { ok: true, actor: "service", sessionUserId };
  }
  if (kind === "admin") {
    if (!sessionUserId) {
      return { ok: false, status: 401, error: "Invalid admin session" };
    }
    // 他ユーザーを覗いた場合のみ監査ログを残す
    if (targetUserId !== sessionUserId) {
      await logAdminAccess({
        actorUserId: sessionUserId,
        projectKey: audit.projectKey,
        action: audit.action,
        resource: audit.resource,
        resourceId: audit.resourceId,
        targetUserId,
        metadata: audit.metadata,
      });
    }
    return { ok: true, actor: "admin", sessionUserId };
  }
  if (kind === "user") {
    if (!sessionUserId) {
      return { ok: false, status: 401, error: "Invalid user session" };
    }
    if (sessionUserId !== targetUserId) {
      return { ok: false, status: 403, error: "Forbidden: cannot access other user's data" };
    }
    return { ok: true, actor: "user", sessionUserId };
  }
  return { ok: false, status: 401, error: "Missing credentials" };
}
