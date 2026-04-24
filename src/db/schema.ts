/**
 * Nuntius DB スキーマ (PostgreSQL + Drizzle)
 *
 * - scheduled_messages: 時間指定メッセージ (SQS 的)
 * - topic_subscriptions: Pub/Sub トピック購読 (SNS 的)
 * - message_templates: 多言語・多チャネルメッセージテンプレート
 * - delivery_logs: 配信結果ログ (監査 + リトライ管理)
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ─── Channel 型 ──────────────────────────────────────────────
// 対応チャネル:
//   slack / discord / line / webhook
//   email / sms / alexa / voice (Imperativus リレー)
//   web: in-app 通知 (Nuntius に保存し、クライアントが REST で取得)
export type ChannelType =
  | "slack"
  | "discord"
  | "line"
  | "webhook"
  | "alexa"
  | "email"
  | "sms"
  | "voice"
  | "web";

export type MessageStatus =
  | "pending"    // キュー投入済、送信待ち
  | "processing" // 配信中
  | "delivered"  // 配信成功
  | "failed"     // 最大リトライ失敗
  | "cancelled"; // ユーザーキャンセル

// ─── Scheduled Messages (時間指定メッセージ) ──────────────

export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: text("id").primaryKey(),
    /** どのサービス由来か (例: "schedula.personal_event", "imperativus.voice") */
    source: text("source").notNull(),
    /** 送信対象ユーザー (Cernere users.id) */
    userId: text("user_id").notNull(),
    /** 配信チャネル */
    channel: text("channel").$type<ChannelType>().notNull(),
    /** 配信時刻 (ISO 8601) */
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    /** 繰り返しルール (cron-like)、null なら単発 */
    recurrenceRule: text("recurrence_rule"),
    /** 配信ペイロード (チャネル依存の本文・埋め込み等) */
    payload: jsonb("payload").notNull().default({}),
    /** テンプレート参照 (任意) */
    templateId: text("template_id"),
    /** 配信優先度 (1=low / 5=normal / 10=high) */
    priority: integer("priority").notNull().default(5),
    /** ステータス */
    status: text("status").$type<MessageStatus>().notNull().default("pending"),
    /** 試行回数 */
    attempts: integer("attempts").notNull().default(0),
    /** 最後の配信試行時刻 */
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    /** Idempotency key (サービス側で重複送信防止に使う) */
    idempotencyKey: text("idempotency_key"),
    /** 作成元プロジェクト (Cernere managed_projects.key) */
    projectKey: text("project_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 発火対象を効率よく拾うため (status + send_at)
    index("idx_scheduled_status_sendat").on(t.status, t.sendAt),
    index("idx_scheduled_user").on(t.userId),
    index("idx_scheduled_project").on(t.projectKey),
    uniqueIndex("unique_scheduled_idempotency").on(t.projectKey, t.idempotencyKey),
  ],
);

// ─── Topic Subscriptions (Pub/Sub) ────────────────────────

export const topicSubscriptions = pgTable(
  "topic_subscriptions",
  {
    id: text("id").primaryKey(),
    /** トピック名 (例: "schedula.group.42.events") */
    topic: text("topic").notNull(),
    userId: text("user_id").notNull(),
    channel: text("channel").$type<ChannelType>().notNull(),
    /** チャネル固有の送信先 (例: Slack Webhook URL, LINE user ID) */
    endpoint: text("endpoint"),
    enabled: boolean("enabled").notNull().default(true),
    projectKey: text("project_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("unique_subscription").on(t.projectKey, t.topic, t.userId, t.channel),
    index("idx_subscription_topic").on(t.topic),
    index("idx_subscription_user").on(t.userId),
    index("idx_subscription_project").on(t.projectKey),
  ],
);

// ─── Notification Patterns (旧称: Message Templates) ───────
// 通知パターン = 「名前 + チャネル + 本文テンプレート + プレースホルダ定義 + メンション候補」。
// 送信側は patternId (templateId) を指定するだけで、worker がパターンを引いて
// payload の values を {{var}} に差し込み、mentions を channel ごとに解決して注入する。

export const messageTemplates = pgTable(
  "message_templates",
  {
    id: text("id").primaryKey(),
    /** パターン名 (表示用・一意) */
    name: text("name").notNull(),
    /** 任意の説明 (管理 UI 用) */
    description: text("description"),
    /** チャネル ("all" で全チャネル共通) */
    channel: text("channel").$type<ChannelType | "all">().notNull().default("all"),
    /** 言語コード (ja, en, ...) */
    locale: text("locale").notNull().default("ja"),
    /** 件名 (任意、email 等で利用、プレースホルダ対応) */
    subject: text("subject"),
    /** 本文 (プレースホルダ {{var}} / メンション {{@key}} 対応) */
    body: text("body").notNull(),
    /**
     * プレースホルダ定義 (サジェスト用)
     * 形式: [{ name, label?, required?, example?, description? }]
     */
    variables: jsonb("variables").notNull().default([]),
    /**
     * メンション候補 (サジェスト用)
     * 形式: [{ key, label, channelValues: { slack?: "<@U123>", discord?: "<@123>", line?: "@user", web?: "@name" } }]
     */
    mentions: jsonb("mentions").notNull().default([]),
    projectKey: text("project_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("unique_template_name").on(t.projectKey, t.name, t.channel, t.locale),
  ],
);

// ─── Delivery Logs (配信結果) ─────────────────────────────

export const deliveryLogs = pgTable(
  "delivery_logs",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    channel: text("channel").$type<ChannelType>().notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    success: boolean("success").notNull(),
    httpStatus: integer("http_status"),
    error: text("error"),
    responseBody: text("response_body"),
    /**
     * 配信元プロジェクト。GDPR 等の right-to-delete を projectKey 単位で絞り込むため保持。
     * 旧レコードは null が残る可能性があるので notNull にはしない。
     */
    projectKey: text("project_key"),
    /** 配信対象ユーザー (監査用)。旧レコード互換のため nullable */
    userId: text("user_id"),
  },
  (t) => [
    index("idx_log_message").on(t.messageId),
    index("idx_log_attempted").on(t.attemptedAt),
    index("idx_log_project").on(t.projectKey),
    index("idx_log_user").on(t.userId),
  ],
);

// ─── Web (in-app) Notifications ─────────────────────────
// web チャネルで配信されたメッセージをユーザー単位で保存する。
// クライアントは GET /api/messages/inbox?userId= で取得、POST /:id/read で既読化。

export const webNotifications = pgTable(
  "web_notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** 元となった scheduled_messages.id (配信経路を辿れるよう保持) */
    messageId: text("message_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** チャネル固有のメタ情報 (link URL, icon 等) */
    metadata: jsonb("metadata").notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    projectKey: text("project_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_web_notif_user").on(t.userId, t.createdAt),
    index("idx_web_notif_unread").on(t.userId, t.readAt),
  ],
);

// ─── Admin Access Logs (監査ログ) ──────────────────────────
// admin ロールのユーザーが他ユーザーの通知データに触れた操作を記録する。
// service-to-service (project_token) 呼び出しはサービス側で追跡するため、
// ここでは admin UI 経由のアクセスのみをロギング対象とする。

export const adminAccessLogs = pgTable(
  "admin_access_logs",
  {
    id: text("id").primaryKey(),
    /** 操作者 (admin ユーザーの Cernere users.id) */
    actorUserId: text("actor_user_id").notNull(),
    /** 操作時の projectKey (NUNTIUS_ADMIN_PROJECT_KEY) */
    projectKey: text("project_key").notNull(),
    /** 操作種別: inbox.list / inbox.read / inbox.delete / messages.get / messages.cancel 等 */
    action: text("action").notNull(),
    /** 対象リソース種別: web_notifications / scheduled_messages / topic_subscriptions */
    resource: text("resource").notNull(),
    /** 対象リソース ID (一覧操作等で null 可) */
    resourceId: text("resource_id"),
    /** 対象ユーザー ID (他ユーザーのデータに触れた場合に記録) */
    targetUserId: text("target_user_id"),
    /** 追加メタ情報 (件数・クエリパラメータ等) */
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_admin_access_actor").on(t.actorUserId, t.createdAt),
    index("idx_admin_access_project").on(t.projectKey, t.createdAt),
    index("idx_admin_access_target").on(t.targetUserId, t.createdAt),
  ],
);

// ─── Channel Credentials (プラットフォーム認証情報) ───────
// Slack / Discord / LINE / Alexa / SMS など、チャネル配信に必要な API 認証情報を
// projectKey 単位で保持する。同一チャネルに複数設定を持てる (name で識別)。
//
// credentials の構造はチャネルごとに異なる:
//   slack:   { webhookUrl }
//   discord: { webhookUrl }
//   line:    { channelAccessToken }
//   alexa:   { clientId, clientSecret, scope?, endpoint? }
//   sms:     { accessKeyId, secretAccessKey, region?, senderId? }

export const channelCredentials = pgTable(
  "channel_credentials",
  {
    id: text("id").primaryKey(),
    projectKey: text("project_key").notNull(),
    channel: text("channel").$type<ChannelType>().notNull(),
    /** 同一チャネル内の識別名 (既定は "default") */
    name: text("name").notNull().default("default"),
    /** チャネル依存の認証情報 JSON */
    credentials: jsonb("credentials").notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("unique_channel_cred").on(t.projectKey, t.channel, t.name),
    index("idx_channel_cred_lookup").on(t.projectKey, t.channel),
  ],
);

// ─── Types ────────────────────────────────────────────────

export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type NewScheduledMessage = typeof scheduledMessages.$inferInsert;
export type TopicSubscription = typeof topicSubscriptions.$inferSelect;
export type NewTopicSubscription = typeof topicSubscriptions.$inferInsert;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
export type DeliveryLog = typeof deliveryLogs.$inferSelect;
export type NewDeliveryLog = typeof deliveryLogs.$inferInsert;
export type WebNotification = typeof webNotifications.$inferSelect;
export type NewWebNotification = typeof webNotifications.$inferInsert;
export type AdminAccessLog = typeof adminAccessLogs.$inferSelect;
export type NewAdminAccessLog = typeof adminAccessLogs.$inferInsert;
export type ChannelCredential = typeof channelCredentials.$inferSelect;
export type NewChannelCredential = typeof channelCredentials.$inferInsert;
