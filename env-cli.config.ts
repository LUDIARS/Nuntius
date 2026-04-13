import type { EnvCliConfig } from "../Cernere/packages/env-cli/src/types.js";

const config: EnvCliConfig = {
  name: "Nuntius",

  infraKeys: {
    // ─── Docker Compose (Ports) ────────────────────────────
    BACKEND_PORT: "3100",

    // ─── Standalone 用 ─────────────────────────────────────
    POSTGRES_USER: "nuntius",
    POSTGRES_PASSWORD: "nuntius",
    POSTGRES_DB: "nuntius",
    DB_PORT: "5432",
    REDIS_PORT: "6379",

    // ─── Application ───────────────────────────────────────
    DATABASE_URL: "postgresql://nuntius_user:nuntius@localhost:5432/nuntius",
    REDIS_URL: "redis://127.0.0.1:6379",
    CERNERE_URL: "http://localhost:8080",

    // ─── JWT ───────────────────────────────────────────────
    JWT_SECRET: "nuntius-dev-secret-change-in-production",

    // ─── Cernere プロジェクト認証 (WS接続用) ──────────────
    CERNERE_PROJECT_CLIENT_ID: "",
    CERNERE_PROJECT_CLIENT_SECRET: "",

    // ─── チャネル設定 (プラットフォーム) ────────────────────
    // Slack: 配信先 Incoming Webhook URL を登録すれば動く
    SLACK_DEFAULT_WEBHOOK_URL: "",
    // Discord: Bot トークンまたは Webhook URL
    DISCORD_DEFAULT_WEBHOOK_URL: "",
    // LINE: Messaging API のチャネルアクセストークン
    LINE_CHANNEL_ACCESS_TOKEN: "",
  },

  defaultSiteUrl: "https://app.infisical.com",
  defaultEnvironment: "dev",
};

export default config;
