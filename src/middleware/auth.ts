/**
 * Nuntius 認証ミドルウェア
 *
 * 以下のいずれかで認証できる:
 *
 * 1. **Bearer <token>**
 *    他サービスが project_credentials で取得した project_token、または
 *    Cernere 発行の user_token を Authorization ヘッダで渡す。
 *    Cernere /api/auth/verify で検証する。
 *
 * 2. **Cookie `nuntius_token`**
 *    admin UI (frontend) が Composite ログイン後に受け取る Nuntius 自身の
 *    service_token (HS256 JWT, iss=nuntius)。ローカルで verify する。
 *
 * 検証結果は `projectKey` / `clientId` / `userId` / `userRole` を context に set する。
 */

import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verifyToken } from "../auth/cernere-client.js";
import { verifyServiceToken } from "../auth/composite.js";
import { TOKEN_COOKIE } from "../auth/routes.js";

export function projectAuth() {
  return createMiddleware(async (c, next) => {
    // 1. Bearer token を優先
    const authHeader = c.req.header("Authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const result = await verifyToken(token);
      if (!result.valid) {
        return c.json({ error: "Invalid token" }, 401);
      }
      if (result.tokenType === "project" && result.project) {
        c.set("projectKey" as never, result.project.key as never);
        c.set("clientId" as never, result.project.clientId as never);
      } else if (result.tokenType === "user" && result.user) {
        c.set("userId" as never, result.user.id as never);
        c.set("userRole" as never, result.user.role as never);
      } else {
        return c.json({ error: "Unknown token type" }, 401);
      }
      await next();
      return;
    }

    // 2. Cookie based service_token (admin UI)
    const cookieToken = getCookie(c, TOKEN_COOKIE);
    if (cookieToken) {
      const payload = await verifyServiceToken(cookieToken);
      if (!payload) {
        return c.json({ error: "Invalid or expired session" }, 401);
      }
      c.set("userId" as never, payload.sub as never);
      c.set("userRole" as never, payload.role as never);
      // admin ロールは NUNTIUS_ADMIN_PROJECT_KEY を projectKey として紐付け、
      // 既存 REST ルート (templates / messages / topics / inbox) にアクセス可能にする。
      if (payload.role === "admin") {
        const adminProjectKey = process.env.NUNTIUS_ADMIN_PROJECT_KEY ?? "";
        if (adminProjectKey) {
          c.set("projectKey" as never, adminProjectKey as never);
        }
      }
      await next();
      return;
    }

    return c.json({ error: "Missing credentials" }, 401);
  });
}

export function getProjectKey(
  c: Parameters<Parameters<typeof createMiddleware>[0]>[0],
): string | null {
  return (c.get("projectKey" as never) as string | undefined) ?? null;
}

export function getUserId(
  c: Parameters<Parameters<typeof createMiddleware>[0]>[0],
): string | null {
  return (c.get("userId" as never) as string | undefined) ?? null;
}

export function getUserRole(
  c: Parameters<Parameters<typeof createMiddleware>[0]>[0],
): string | null {
  return (c.get("userRole" as never) as string | undefined) ?? null;
}

/** project_token 経由なら Cernere project clientId、それ以外なら null */
export function getClientId(
  c: Parameters<Parameters<typeof createMiddleware>[0]>[0],
): string | null {
  return (c.get("clientId" as never) as string | undefined) ?? null;
}

/**
 * 呼び出し元の「アクター種別」を返す。
 *   - "service": project_token (clientId が入っている)
 *   - "admin"  : Cookie セッションで role=admin
 *   - "user"   : 一般ユーザー (userId のみ)
 *   - "anon"   : いずれでもない
 */
export function getActorKind(
  c: Parameters<Parameters<typeof createMiddleware>[0]>[0],
): "service" | "admin" | "user" | "anon" {
  if (getClientId(c)) return "service";
  const role = getUserRole(c);
  if (role === "admin") return "admin";
  if (getUserId(c)) return "user";
  return "anon";
}
