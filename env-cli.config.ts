import type { EnvCliConfig } from "../Cernere/packages/env-cli/src/types.js";

const config: EnvCliConfig = {
  name: "Nuntius",

  infraKeys: {
    // ─── Docker Compose (Ports) ────────────────────────────
    BACKEND_PORT: "3100",
    FRONTEND_PORT: "5175",

    // ─── Frontend (Vite) ───────────────────────────────────
    // カンマ区切りで dev server の allowedHosts に追加
    VITE_ALLOWED_HOSTS: "",

    // ─── Backend CORS ──────────────────────────────────────
    CORS_ORIGIN: "*",

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

    // ─── Imperativus (音声チャネル) ────────────────────────
    IMPERATIVUS_URL: "",
    IMPERATIVUS_API_TOKEN: "",

    // ─── Email (SMTP) ──────────────────────────────────────
    SMTP_URL: "",
    SMTP_FROM: "noreply@localhost",

    // NOTE: 以下のチャネル認証情報は DB (channel_credentials) で管理するため env には登録しない:
    //   Slack (webhook URL), Discord (webhook URL), LINE (channel access token),
    //   Alexa (client_id/secret/scope/endpoint), SMS (AWS access key/secret/region/sender_id)
  },

  defaultSiteUrl: "https://app.infisical.com",
  defaultEnvironment: "dev",
};

export default config;
