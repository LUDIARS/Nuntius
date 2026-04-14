/**
 * Cernere Composite 認証ルート
 *
 * Nuntius の admin UI はエンドユーザーではなく運用者 (admin ロール) が
 * アクセスする想定。UI は Cernere Composite でログインし、セッション
 * トークンは HttpOnly Cookie で保持する。
 *
 *   POST /api/auth/cernere/login        — 埋め込みログイン (email + password)
 *   POST /api/auth/cernere/register     — ユーザー登録
 *   POST /api/auth/cernere/mfa-verify   — MFA 検証
 *   GET  /api/auth/login-url            — popup モード URL
 *   POST /api/auth/exchange             — authCode → serviceToken (Cookie 発行)
 *   POST /api/auth/logout               — Cookie 削除
 *   GET  /api/auth/me                   — 現在のユーザー (Cookie 前提)
 *   GET  /api/auth/ws-token             — Cookie → URL クエリ用 token (WS 接続用)
 */

import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import {
  isCompositeEnabled,
  getLoginUrl,
  exchangeAuthCode,
  verifyServiceToken,
} from "./composite.js";

export const TOKEN_COOKIE = "nuntius_token";
const TOKEN_COOKIE_MAX_AGE = 3600; // 1 時間 (serviceToken の exp に合わせる)

function setTokenCookie(
  c: Parameters<typeof setCookie>[0],
  token: string,
): void {
  const isProd = (process.env.NODE_ENV ?? "") === "production";
  setCookie(c, TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "Lax",
    path: "/",
    maxAge: TOKEN_COOKIE_MAX_AGE,
  });
}

export const compositeAuthRoutes = new Hono();

// ─── popup モード URL ──────────────────────────────
compositeAuthRoutes.get("/login-url", (c) => {
  if (!isCompositeEnabled()) {
    return c.json({ error: "Cernere Composite is not configured" }, 503);
  }
  const origin = c.req.query("origin");
  if (!origin) {
    return c.json({ error: "origin query parameter is required" }, 400);
  }
  const url = getLoginUrl(origin);
  return c.json({ url });
});

// ─── authCode → serviceToken 交換 ──────────────────
compositeAuthRoutes.post("/exchange", async (c) => {
  if (!isCompositeEnabled()) {
    return c.json({ error: "Cernere Composite is not configured" }, 503);
  }
  const body = await c.req.json<{ authCode: string }>().catch(() => ({ authCode: "" }));
  if (!body.authCode) {
    return c.json({ error: "authCode is required" }, 400);
  }
  try {
    const result = await exchangeAuthCode(body.authCode);
    setTokenCookie(c, result.serviceToken);
    return c.json({ user: result.user });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Exchange failed";
    return c.json({ error: message }, 401);
  }
});

// ─── ログアウト (Cookie 削除) ──────────────────────
compositeAuthRoutes.post("/logout", (c) => {
  deleteCookie(c, TOKEN_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ─── WS 接続用の短期トークン発行 (Cookie → URL パラメータ用) ──
compositeAuthRoutes.get("/ws-token", (c) => {
  const token = getCookie(c, TOKEN_COOKIE);
  if (!token) return c.json({ error: "Not authenticated" }, 401);
  return c.json({ token });
});

// ─── 現在のユーザー情報 ────────────────────────────
compositeAuthRoutes.get("/me", async (c) => {
  const token = getCookie(c, TOKEN_COOKIE);
  if (!token) return c.json({ error: "Not authenticated" }, 401);
  const payload = await verifyServiceToken(token);
  if (!payload) return c.json({ error: "Invalid or expired token" }, 401);
  return c.json({
    id: payload.sub,
    name: payload.name,
    email: payload.email,
    role: payload.role,
  });
});

// ─── Cernere 埋め込み認証プロキシ (同一 origin で CORS 回避) ──
compositeAuthRoutes.post("/cernere/login", async (c) => {
  const { compositeLogin } = await import("./cernere-client.js");
  try {
    const body = await c.req.json<{ email: string; password: string }>();
    const res = await compositeLogin(body.email, body.password);
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login failed";
    return c.json({ error: message }, 401);
  }
});

compositeAuthRoutes.post("/cernere/register", async (c) => {
  const { compositeRegister } = await import("./cernere-client.js");
  try {
    const body = await c.req.json<{ name: string; email: string; password: string }>();
    const res = await compositeRegister(body.name, body.email, body.password);
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Registration failed";
    return c.json({ error: message }, 400);
  }
});

compositeAuthRoutes.post("/cernere/mfa-verify", async (c) => {
  const { compositeMfaVerify } = await import("./cernere-client.js");
  try {
    const body = await c.req.json<{ mfaToken: string; method: string; code: string }>();
    const res = await compositeMfaVerify(body.mfaToken, body.method, body.code);
    return c.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "MFA verification failed";
    return c.json({ error: message }, 401);
  }
});
