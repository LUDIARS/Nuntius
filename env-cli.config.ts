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
    // admin UI の Composite 認証で発行する service_token (nuntius_token Cookie) の署名鍵
    JWT_SECRET: "nuntius-dev-secret-change-in-production",

    // ─── Cernere プロジェクト認証 (WS接続用) ──────────────
    // Cernere で Nuntius をプロジェクト登録した際の client_id / client_secret
    CERNERE_PROJECT_CLIENT_ID: "",
    CERNERE_PROJECT_CLIENT_SECRET: "",

    // ─── admin UI (Composite) 用の projectKey バインド ─────
    // admin ロールのユーザーセッションをこの projectKey と紐付け、
    // 既存 REST ルート (templates / messages / topics / inbox) にアクセス可能にする。
    NUNTIUS_ADMIN_PROJECT_KEY: "nuntius",

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
