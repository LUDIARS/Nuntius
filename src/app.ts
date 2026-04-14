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
import { supportedChannels } from "./channels/index.js";

export function createApp() {
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

  // 認証必須エンドポイント
  app.use("/api/messages/*", projectAuth());
  app.use("/api/topics/*", projectAuth());
  app.use("/api/templates/*", projectAuth());
  app.use("/api/inbox/*", projectAuth());

  app.route("/api/messages", messagesRoutes);
  app.route("/api/topics", topicsRoutes);
  app.route("/api/templates", templatesRoutes);
  app.route("/api/inbox", inboxRoutes);

  app.get("/", (c) => {
    return c.json({
      name: "Nuntius",
      version: "0.1.0",
      description: "LUDIARS 統合通知・メッセージング基盤",
      endpoints: {
        messages: "/api/messages/{schedule, :id}",
        topics: "/api/topics/:topic/{publish, subscribe}",
        templates: "/api/templates (CRUD / :id/render / mentions?channel=)",
        inbox: "/api/inbox?userId={id}",
        health: "/api/health",
      },
      channels: supportedChannels(),
    });
  });

  return app;
}
