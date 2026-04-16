/**
 * Alexa 配信 (Proactive Events API)
 *
 * https://developer.amazon.com/docs/smapi/proactive-events-api.html
 *
 * payload:
 *   userId:          string  — Alexa UserId (amzn1.ask.account...)
 *   referenceId:     string  — イベント一意 ID (ユーザー+イベントで一意)
 *   event: {
 *     name: string          — 例: "AMAZON.MessageAlert.Activated"
 *     payload: object       — Alexa スキーマに準拠
 *   }
 *   expiryTime?:     string  — ISO 8601 (既定: now + 24h)
 *   localizedAttributes?: Array<{ locale: string; ... }>
 *   credentialName:  string  — channel_credentials.name を参照 (省略時 "default")
 *
 * credentials (JSONB):
 *   { clientId, clientSecret, scope?, endpoint? }
 *     - scope     (既定: "alexa::proactive_events")
 *     - endpoint  (既定: "https://api.amazonalexa.com")
 *
 * 認証情報が揃わない場合は dev モードでログのみ出力する。
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";
import { loadChannelCredentials } from "./credentials.js";

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

interface AlexaCreds {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  endpoint?: string;
}

// LWA トークンは (projectKey + credentialName) 単位でキャッシュ
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getLwaToken(cacheKey: string, creds: AlexaCreds): Promise<string | null> {
  const clientId = creds.clientId ?? "";
  const clientSecret = creds.clientSecret ?? "";
  if (!clientId || !clientSecret) return null;

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const scope = creds.scope ?? "alexa::proactive_events";
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LWA token request failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // 1 分早めに更新
  });
  return data.access_token;
}

export const alexaDispatcher: ChannelDispatcher = {
  channel: "alexa",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    const eventObj = p.event as { name?: string; payload?: Record<string, unknown> } | undefined;
    const referenceId = (p.referenceId as string | undefined) ?? message.id;
    const userId = (p.userId as string | undefined) ?? message.userId;

    if (!eventObj?.name) {
      return { success: false, error: "alexa payload requires 'event.name'" };
    }

    const credName = (p.credentialName as string | undefined) ?? "default";
    const creds = (await loadChannelCredentials<AlexaCreds>(
      message.projectKey,
      "alexa",
      credName,
    )) ?? {};
    const clientId = creds.clientId ?? "";
    const clientSecret = creds.clientSecret ?? "";
    if (!clientId || !clientSecret) {
      console.log(`[alexa:dev] userId=${userId} event=${eventObj.name} (LWA 未設定)`);
      return { success: true, responseBody: "dev mode (alexa credentials not configured)" };
    }

    let token: string | null;
    try {
      token = await getLwaToken(`${message.projectKey}:${credName}`, creds);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (!token) {
      return { success: false, error: "failed to obtain LWA token" };
    }

    const endpoint = creds.endpoint ?? "https://api.amazonalexa.com";
    const now = new Date();
    const expiry = (p.expiryTime as string | undefined)
      ?? new Date(now.getTime() + 24 * 3600 * 1000).toISOString();

    const body = {
      timestamp: now.toISOString(),
      referenceId,
      expiryTime: expiry,
      event: {
        name: eventObj.name,
        payload: eventObj.payload ?? {},
      },
      localizedAttributes: (p.localizedAttributes as unknown[]) ?? [],
      relevantAudience: {
        type: "Unicast",
        payload: { user: userId },
      },
    };

    try {
      const res = await fetch(`${endpoint}/v1/proactiveEvents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text().catch(() => "");
      return {
        success: res.ok,
        httpStatus: res.status,
        responseBody: text.slice(0, 500),
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
