/**
 * Nuntius API サーバーエントリポイント
 */

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ensureSchema } from "./db/migrate.js";

async function main(): Promise<void> {
  console.log("=== Nuntius API ===");

  // DB スキーマ確認 (起動時)
  try {
    await ensureSchema();
  } catch (err) {
    console.error("[server] DB スキーマ作成失敗:", err);
    process.exit(1);
  }

  const { app, injectWebSocket } = createApp();
  const port = parseInt(process.env.BACKEND_PORT ?? "3100", 10);

  console.log(`[server] 起動中... ポート ${port}`);
  console.log(`[server] CERNERE_URL = ${process.env.CERNERE_URL ?? "(未設定)"}`);
  console.log(`[server] DATABASE_URL = ${(process.env.DATABASE_URL ?? "").replace(/\/\/.*@/, "//***:***@")}`);

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[server] Nuntius listening on http://localhost:${info.port} (WS: /ws)`);
  });
  injectWebSocket(server);

  // Peer service adapter (backend-to-backend WS via Cernere).
  // env 未設定なら no-op (user-facing API には影響なし).
  const { initServiceAdapter } = await import("./service-adapter.js");
  void initServiceAdapter().catch((err) => {
    console.warn("[nuntius-sa] peer adapter 起動失敗 (user-facing API は継続):", err);
  });
}

main().catch((err) => {
  console.error("[server] 致命的エラー:", err);
  process.exit(1);
});
