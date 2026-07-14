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

    // ─── Media 添付 (画像 / 動画 / ファイル送信) ───────────
    // payload.attachments[] のホスト保存先。
    //   "s3"    … MinIO / AWS S3 (本番既定)
    //   "local" … ローカル FS (dev / 小規模、 GET /media/:id で配信)
    //   "off"   … ホストアップロード無効 (URL passthrough のみ受け付ける)
    NUNTIUS_MEDIA_BACKEND: "off",
    // s3 backend 用 (MinIO 互換。 endpoint 指定時は path-style が自動 ON)
    NUNTIUS_MEDIA_S3_ENDPOINT: "",
    NUNTIUS_MEDIA_S3_BUCKET: "nuntius-media",
    NUNTIUS_MEDIA_S3_REGION: "us-east-1",
    NUNTIUS_MEDIA_S3_ACCESS_KEY: "",
    NUNTIUS_MEDIA_S3_SECRET_KEY: "",
    NUNTIUS_MEDIA_S3_FORCE_PATH_STYLE: "",
    // local backend 用の保存ディレクトリ
    NUNTIUS_MEDIA_LOCAL_DIR: "./data/media",
    // GET /media/:id を組み立てる公開ベース URL (LINE 等の外部 PF が取得するため到達可能な URL)
    NUNTIUS_MEDIA_PUBLIC_BASE_URL: "",
    // アップロード全体の上限 (bytes、 0 = kind 別上限のみ)
    NUNTIUS_MEDIA_MAX_BYTES: "0",
    // アップロード資産の既定 TTL (秒、 0 = 無期限。 既定 7 日)
    NUNTIUS_MEDIA_DEFAULT_TTL_SEC: "604800",

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
