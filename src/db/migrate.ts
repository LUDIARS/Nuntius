/**
 * 起動時マイグレーション
 *
 * drizzle-kit push は開発用。本番は必要に応じて `drizzle-kit migrate` を使う。
 * ここでは接続確認のみ行う。テーブル作成は drizzle-kit 経由で行うか、
 * 本ファイルで IF NOT EXISTS を使って冪等に作成する。
 */

import { pgClient } from "./connection.js";

export async function ensureSchema(): Promise<void> {
  // scheduled_messages
  await pgClient`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      send_at TIMESTAMPTZ NOT NULL,
      recurrence_rule TEXT,
      payload JSONB NOT NULL DEFAULT '{}',
      template_id TEXT,
      priority INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TIMESTAMPTZ,
      idempotency_key TEXT,
      project_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_scheduled_status_sendat ON scheduled_messages(status, send_at)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_scheduled_user ON scheduled_messages(user_id)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_scheduled_project ON scheduled_messages(project_key)`;
  await pgClient`CREATE UNIQUE INDEX IF NOT EXISTS unique_scheduled_idempotency ON scheduled_messages(project_key, idempotency_key) WHERE idempotency_key IS NOT NULL`;

  // topic_subscriptions
  await pgClient`
    CREATE TABLE IF NOT EXISTS topic_subscriptions (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      endpoint TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      project_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // unique_subscription: projectKey を複合キーに含めてテナント分離を担保する。
  // 既存の (topic, user_id, channel) インデックスが残っているとクロステナントで
  // 衝突するため、存在すれば drop してから再作成する。
  await pgClient`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'unique_subscription'
          AND indexdef NOT LIKE '%project_key%'
      ) THEN
        EXECUTE 'DROP INDEX unique_subscription';
      END IF;
    END $$
  `;
  await pgClient`CREATE UNIQUE INDEX IF NOT EXISTS unique_subscription ON topic_subscriptions(project_key, topic, user_id, channel)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_subscription_topic ON topic_subscriptions(topic)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_subscription_user ON topic_subscriptions(user_id)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_subscription_project ON topic_subscriptions(project_key)`;

  // message_templates (通知パターン)
  await pgClient`
    CREATE TABLE IF NOT EXISTS message_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'all',
      locale TEXT NOT NULL DEFAULT 'ja',
      subject TEXT,
      body TEXT NOT NULL,
      variables JSONB NOT NULL DEFAULT '[]',
      project_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // 後方互換: 既存テーブルに新カラムを追加 (冪等)
  await pgClient`ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS description TEXT`;
  await pgClient`ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'`;
  await pgClient`CREATE UNIQUE INDEX IF NOT EXISTS unique_template_name ON message_templates(project_key, name, channel, locale)`;

  // delivery_logs
  await pgClient`
    CREATE TABLE IF NOT EXISTS delivery_logs (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      success BOOLEAN NOT NULL,
      http_status INTEGER,
      error TEXT,
      response_body TEXT
    )
  `;
  // 後方互換: projectKey / userId を追加 (nullable、旧レコードは NULL)
  await pgClient`ALTER TABLE delivery_logs ADD COLUMN IF NOT EXISTS project_key TEXT`;
  await pgClient`ALTER TABLE delivery_logs ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_log_message ON delivery_logs(message_id)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_log_attempted ON delivery_logs(attempted_at)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_log_project ON delivery_logs(project_key)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_log_user ON delivery_logs(user_id)`;

  // web_notifications (in-app inbox)
  await pgClient`
    CREATE TABLE IF NOT EXISTS web_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      read_at TIMESTAMPTZ,
      project_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_web_notif_user ON web_notifications(user_id, created_at)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_web_notif_unread ON web_notifications(user_id, read_at)`;

  // admin_access_logs: admin UI 経由の参照/変更を監査ログとして記録する
  await pgClient`
    CREATE TABLE IF NOT EXISTS admin_access_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL,
      project_key TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT,
      target_user_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_admin_access_actor ON admin_access_logs(actor_user_id, created_at)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_admin_access_project ON admin_access_logs(project_key, created_at)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_admin_access_target ON admin_access_logs(target_user_id, created_at)`;

  // channel_credentials (チャネル配信用プラットフォーム認証情報)
  await pgClient`
    CREATE TABLE IF NOT EXISTS channel_credentials (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      channel TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'default',
      credentials JSONB NOT NULL DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await pgClient`CREATE UNIQUE INDEX IF NOT EXISTS unique_channel_cred ON channel_credentials(project_key, channel, name)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_channel_cred_lookup ON channel_credentials(project_key, channel)`;

  console.log("[db] schema 確認完了");
}
