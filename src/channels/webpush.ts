/**
 * Web Push (PWA) 通知配信
 *
 * iOS 16.4+ / Android Chrome / Desktop の PushManager + Service Worker 経由で
 * デバイスにプッシュ通知を出す。 iOS は **PWA としてホーム画面に追加** された
 * 状態でのみ動作する (Safari タブからでは動かない)。
 *
 * payload:
 *   title:       string
 *   body:        string
 *   url?:        string         — クリック遷移先 (Service Worker が clients.openWindow で開く)
 *   icon?:       string
 *   badge?:      string
 *   tag?:        string         — 同じ tag は新しいので置換
 *   subscriptionIds?: string[]  — 特定の端末だけに送る (未指定なら user の全端末)
 *
 * VAPID 鍵は環境変数:
 *   VAPID_PUBLIC_KEY   — base64url (ブラウザ側 PushManager.subscribe にも渡す)
 *   VAPID_PRIVATE_KEY  — base64url
 *   VAPID_SUBJECT      — "mailto:admin@example.com" 形式
 *
 * 鍵生成: `npx web-push generate-vapid-keys`
 */

import webpush from "web-push";
import { eq, and, isNull } from "drizzle-orm";

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";
import { db, schema } from "../db/connection.js";

/** VAPID を 1 度だけ初期化する。 鍵未設定なら配信時にエラー。 */
let vapidConfigured: boolean | null = null;
function ensureVapid(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;
  const pub = process.env.VAPID_PUBLIC_KEY ?? "";
  const priv = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
  if (!pub || !priv) {
    console.warn("[webpush] VAPID keys not set; webpush dispatcher disabled");
    vapidConfigured = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

export const webpushDispatcher: ChannelDispatcher = {
  channel: "webpush",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    if (!ensureVapid()) {
      return { success: false, error: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not configured" };
    }

    const p = message.payload as Record<string, unknown>;
    const title = p.title as string | undefined;
    const body = p.body as string | undefined;
    if (!title || !body) {
      return { success: false, error: "webpush payload requires 'title' and 'body'" };
    }

    // 対象 subscription を取得
    const subIds = Array.isArray(p.subscriptionIds) ? (p.subscriptionIds as string[]) : null;
    const conditions = [
      eq(schema.pushSubscriptions.userId, message.userId),
      eq(schema.pushSubscriptions.projectKey, message.projectKey),
      isNull(schema.pushSubscriptions.revokedAt),
    ];
    const rows = await db
      .select()
      .from(schema.pushSubscriptions)
      .where(and(...conditions));
    const targets = subIds ? rows.filter((r) => subIds.includes(r.id)) : rows;

    if (targets.length === 0) {
      return { success: false, error: "no active push subscription for this user" };
    }

    const notifPayload = JSON.stringify({
      title,
      body,
      url:   typeof p.url === "string"   ? p.url   : undefined,
      icon:  typeof p.icon === "string"  ? p.icon  : undefined,
      badge: typeof p.badge === "string" ? p.badge : undefined,
      tag:   typeof p.tag === "string"   ? p.tag   : undefined,
      data:  p.data ?? null,
    });

    const results: { id: string; ok: boolean; status?: number; error?: string }[] = [];
    let anyOk = false;
    for (const sub of targets) {
      try {
        const r = await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notifPayload,
          { TTL: 60, urgency: "normal" },
        );
        anyOk = true;
        results.push({ id: sub.id, ok: true, status: r.statusCode });
        await db.update(schema.pushSubscriptions)
          .set({ lastDeliveredAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.pushSubscriptions.id, sub.id));
      } catch (err: unknown) {
        const e = err as { statusCode?: number; body?: string; message?: string };
        const status = e.statusCode;
        const msg = e.body ?? e.message ?? String(err);
        results.push({ id: sub.id, ok: false, status, error: msg });
        // 404 / 410 は購読が無効 (ユーザがブラウザ側で許可取消し / アンインストール)
        if (status === 404 || status === 410) {
          await db.update(schema.pushSubscriptions)
            .set({ revokedAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.pushSubscriptions.id, sub.id));
        }
      }
    }

    return {
      success: anyOk,
      httpStatus: anyOk ? 201 : 502,
      responseBody: JSON.stringify(results).slice(0, 1000),
      error: anyOk ? undefined : "all push targets failed",
    };
  },
};
