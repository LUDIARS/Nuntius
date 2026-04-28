/**
 * Nuntius API アプリケーション (Hono)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { projectAuth } from "./middleware/auth.js";
import { messagesRoutes } from "./routes/messages.js";
import { topicsRoutes } from "./routes/topics.js";
import { templatesRoutes } from "./routes/templates.js";
import { inboxRoutes } from "./routes/inbox.js";
import { deliveryLogsRoutes } from "./routes/delivery-logs.js";
import { discordRoutes } from "./routes/discord.js";
import { credentialsRoutes } from "./routes/credentials.js";
import { supportedChannels } from "./channels/index.js";
import { setupWebSocket } from "./ws/handler.js";
import { registerNuntiusCommands } from "./ws/register-commands.js";
import { compositeAuthRoutes } from "./auth/routes.js";
import { initComposite } from "./auth/composite.js";

export function createApp() {
  // WS コマンドを必ず登録 (multi-invocation safe)
  registerNuntiusCommands();
  // Cernere Composite 初期化 (CERNERE_URL / JWT_SECRET が揃っていれば有効化)
  initComposite();

  const app = new Hono();

  app.onError((err, c) => {
    console.error(`[server] 未処理エラー: ${c.req.method} ${c.req.path}`, err);
    const isProduction = process.env.NODE_ENV === "production";
    return c.json({
      error: "Internal server error",
      ...(isProduction ? {} : { message: err.message }),
    }, 500);
  });

  app.use("*", logger());

  // 構造化 access ログ
  app.use("*", async (c, next) => {
    const t0 = Date.now();
    let thrown: unknown = undefined;
    try { await next(); } catch (err) { thrown = err; throw err; }
    finally {
      const status = c.res?.status ?? (thrown ? 500 : 0);
      const userId = (c.get("user") as { id?: string } | undefined)?.id;
      const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        method: c.req.method, path: c.req.path,
        status, durationMs: Date.now() - t0,
      };
      if (userId) entry.userId = userId;
      if (thrown) entry.error = thrown instanceof Error ? thrown.message : String(thrown);
      const tag = status >= 500 ? "[http-error]" : status >= 400 ? "[http-warn]" : "[http]";
      console.log(`${tag} ${JSON.stringify(entry)}`);
    }
  });

  app.use("*", cors({
    origin: process.env.CORS_ORIGIN ?? "*",
    credentials: true,
  }));

  // ヘルスチェック (認証不要)
  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      service: "nuntius",
      channels: supportedChannels(),
      timestamp: new Date().toISOString(),
    });
  });

  // 認証不要: Composite ログイン関連 (Cookie 発行)
  app.route("/api/auth", compositeAuthRoutes);

  // 認証必須エンドポイント
  app.use("/api/messages/*", projectAuth());
  app.use("/api/topics/*", projectAuth());
  app.use("/api/templates/*", projectAuth());
  app.use("/api/inbox/*", projectAuth());
  app.use("/api/delivery-logs/*", projectAuth());
  app.use("/api/discord/*", projectAuth());
  app.use("/api/credentials/*", projectAuth());

  app.route("/api/messages", messagesRoutes);
  app.route("/api/topics", topicsRoutes);
  app.route("/api/templates", templatesRoutes);
  app.route("/api/inbox", inboxRoutes);
  app.route("/api/delivery-logs", deliveryLogsRoutes);
  app.route("/api/discord", discordRoutes);
  app.route("/api/credentials", credentialsRoutes);

  app.get("/", (c) => {
    return c.json({
      name: "Nuntius",
      version: "0.1.0",
      description: "LUDIARS 統合通知・メッセージング基盤",
      endpoints: {
        messages: "/api/messages (list / :schedule / :id / :id/logs)",
        topics: "/api/topics/:topic/{publish, subscribe}",
        templates: "/api/templates (CRUD / :id/render / mentions?channel=)",
        inbox: "/api/inbox?userId={id}",
        delivery_logs: "/api/delivery-logs (list / stats?window=<min>)",
        ws: "/ws?token=<project_or_user_token> (nuntius.schedule|cancel|publish|subscribe|list_my)",
        health: "/api/health",
      },
      channels: supportedChannels(),
    });
  });

  // WebSocket エンドポイント (nuntius.* コマンド受付)
  const { injectWebSocket } = setupWebSocket(app);
  return { app, injectWebSocket };
}
