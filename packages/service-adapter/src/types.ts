/** Nuntius service adapter — public types */

export interface NuntiusAdapterConfig {
  /** Nuntius backend URL (例: "https://nuntius-d.vtn-game.com" / "http://localhost:3100") */
  nuntiusBaseUrl: string;
  /** Cernere backend URL (project credentials の login 先) */
  cernereBaseUrl: string;
  /** Cernere の managed_project で発行された client_id */
  projectId: string;
  /** 同 client_secret (plaintext)。Infisical 経由で各サービスに配布する想定 */
  projectSecret: string;
  /** override fetch (test 用) */
  fetch?: typeof fetch;
  /** debug log を出すか */
  debug?: boolean;
}

/** scheduled_messages 投入 (POST /api/messages/schedule) */
export interface ScheduleInput {
  /** 受信者 ID (Cernere user id) */
  userId: string;
  /** 通知タイプ (slack / discord / discord_bot / email / line / webhook / sms / alexa / voice / web) */
  channel: string;
  /** 配信ペイロード — channel ごとに dispatcher が解釈 */
  payload: Record<string, unknown>;
  /** 送信時刻 ISO 文字列 (省略時は now) */
  sendAt?: string;
  /** 通知パターン ID (template) を使う場合 */
  templateId?: string;
  /** 重複防止キー */
  idempotencyKey?: string;
  /** 繰り返しルール (RFC 5545 RRULE 簡易) */
  recurrenceRule?: string;
  /** 優先度 (高い = 早く配信) */
  priority?: number;
}

export interface ScheduleResult {
  id: string;
  status?: string;
}

/** topic.publish (POST /api/topics/:topic/publish) */
export interface PublishInput {
  topic: string;
  channel?: string;
  payload: Record<string, unknown>;
  sendAt?: string;
  source?: string;
}

export interface PublishResult {
  count?: number;
  scheduledIds?: string[];
}

/** topic.subscribe (POST /api/topics/:topic/subscribe) */
export interface SubscribeInput {
  topic: string;
  userId: string;
  channel: string;
  endpoint?: string;
}

export interface SubscribeResult {
  id: string;
}

/** inbox 取得 (GET /api/inbox?userId=) */
export interface InboxItem {
  id: string;
  userId: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}
