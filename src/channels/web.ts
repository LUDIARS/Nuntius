/**
 * Web (in-app) 通知配信
 *
 * payload:
 *   title:     string
 *   body:      string
 *   link?:     string      — クリック遷移先
 *   icon?:     string      — 表示アイコン URL
 *   metadata?: object      — 追加メタ情報
 *
 * Nuntius の web_notifications テーブルに保存する。
 * クライアントは GET /api/messages/inbox?userId= で取得する。
 */

import { v4 as uuidv4 } from "uuid";
import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";
import { db, schema } from "../db/connection.js";

export const webDispatcher: ChannelDispatcher = {
  channel: "web",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const title = p.title as string | undefined;
    const body = p.body as string | undefined;
    if (!title || !body) {
      return { success: false, error: "web payload requires 'title' and 'body'" };
    }

    const metadata: Record<string, unknown> = {};
    if (typeof p.link === "string") metadata.link = p.link;
    if (typeof p.icon === "string") metadata.icon = p.icon;
    if (p.metadata && typeof p.metadata === "object") {
      Object.assign(metadata, p.metadata as Record<string, unknown>);
    }

    try {
      await db.insert(schema.webNotifications).values({
        id: uuidv4(),
        userId: message.userId,
        messageId: message.id,
        title,
        body,
        metadata,
        projectKey: message.projectKey,
      });
      return { success: true, responseBody: "web notification stored" };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
