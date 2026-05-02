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

    // ─── Channel Credentials 暗号化鍵 (AES-256-GCM) ────────
    // channel_credentials.credentials (JSONB) を暗号化する。
    // 32 byte を base64 エンコードした文字列 (例: `openssl rand -base64 32`)。
    // 本番では必ず Infisical 経由で配布し、ローテーション時は再暗号化スクリプトを別途用意する。
    NUNTIUS_ENCRYPTION_KEY: "",

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

    // ─── Nuntius 共有 Discord BOT ──────────────────────────
    // 全プロジェクトで共有する Discord BOT トークン。
    // 個別 channel_credentials.botToken があればそちらが優先される。
    // BOT に対する Server Members Intent 有効化 + 各サーバへの招待が必要。
    NUNTIUS_DISCORD_BOT_TOKEN: "",

    // ─── Email (SMTP) ──────────────────────────────────────
    SMTP_URL: "",
    SMTP_FROM: "noreply@localhost",

    // NOTE: 以下のチャネル認証情報は DB (channel_credentials) で管理するため env には登録しない:
    //   Slack (webhook URL), Discord (webhook URL), LINE (channel access token),
    //   Alexa (client_id/secret/scope/endpoint), SMS (AWS access key/secret/region/sender_id)
  },

  defaultSiteUrl: "https://app.infisical.com",
  defaultEnvironment: "dev",

  /**
   * production 環境で env-cli env / up を実行したとき、
   * Infisical に存在しない (= dev 用 placeholder のまま) と .env 生成を中止するキー。
   * dev fallback が本番に漏れると致命的になる項目を列挙する。
   */
  required: {
    production: [
      "JWT_SECRET",
      "DATABASE_URL",
      "REDIS_URL",
      "NUNTIUS_ENCRYPTION_KEY",
      "CERNERE_PROJECT_CLIENT_SECRET",
    ],
  },
};

export default config;
