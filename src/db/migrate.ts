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
  await pgClient`CREATE UNIQUE INDEX IF NOT EXISTS unique_subscription ON topic_subscriptions(topic, user_id, channel)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_subscription_topic ON topic_subscriptions(topic)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_subscription_user ON topic_subscriptions(user_id)`;

  // message_templates
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
  await pgClient`CREATE INDEX IF NOT EXISTS idx_log_message ON delivery_logs(message_id)`;
  await pgClient`CREATE INDEX IF NOT EXISTS idx_log_attempted ON delivery_logs(attempted_at)`;

  console.log("[db] schema 確認完了");
}
