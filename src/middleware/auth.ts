/**
 * Nuntius 認証ミドルウェア
 *
 * 他サービスが Nuntius を叩くときは project_credentials で発行した
 * project_token を Bearer で渡す。Cernere の /api/auth/verify で検証する。
 * 検証結果を c.set("projectKey", ...) にセットする。
 */

import { createMiddleware } from "hono/factory";
import { verifyToken } from "../auth/cernere-client.js";

export function projectAuth() {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing Bearer token" }, 401);
    }
    const token = authHeader.slice(7);
    const result = await verifyToken(token);
    if (!result.valid) {
      return c.json({ error: "Invalid token" }, 401);
    }
    if (result.tokenType === "project" && result.project) {
      c.set("projectKey" as never, result.project.key as never);
      c.set("clientId" as never, result.project.clientId as never);
    } else if (result.tokenType === "user" && result.user) {
      // ユーザートークン経由でも許可 (将来的な UI 直接利用向け)
      c.set("userId" as never, result.user.id as never);
      c.set("userRole" as never, result.user.role as never);
    } else {
      return c.json({ error: "Unknown token type" }, 401);
    }
    await next();
  });
}

export function getProjectKey(c: Parameters<Parameters<typeof createMiddleware>[0]>[0]): string | null {
  return (c.get("projectKey" as never) as string | undefined) ?? null;
}

export function getUserId(c: Parameters<Parameters<typeof createMiddleware>[0]>[0]): string | null {
  return (c.get("userId" as never) as string | undefined) ?? null;
}
