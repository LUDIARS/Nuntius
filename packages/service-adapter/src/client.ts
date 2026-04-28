/**
 * NuntiusClient — REST 経由で Nuntius を呼ぶ薄いラッパー
 *
 * 認証は Cernere の project_credentials grant で project token を取得 → Nuntius に Bearer 渡し。
 * project token は短期 (1h 既定) なので内部で expire 監視 + 自動 refresh する。
 */

import type {
  NuntiusAdapterConfig,
  ScheduleInput, ScheduleResult,
  PublishInput, PublishResult,
  SubscribeInput, SubscribeResult,
  InboxItem,
} from "./types.js";

const TOKEN_REFRESH_MARGIN_SEC = 60;

export class NuntiusClient {
  private readonly fetchImpl: typeof fetch;
  private projectToken: string | null = null;
  private projectTokenExpiresAt = 0;

  constructor(private readonly cfg: NuntiusAdapterConfig) {
    this.fetchImpl = cfg.fetch ?? fetch;
  }

  // ─── Public API ────────────────────────────────────

  /** 通知を schedule (即時 or 遅延)。templateId 指定で通知パターンを使う */
  async schedule(input: ScheduleInput): Promise<ScheduleResult> {
    const body: ScheduleInput = {
      ...input,
      sendAt: input.sendAt ?? new Date().toISOString(),
    };
    return this.request("POST", "/api/messages/schedule", body);
  }

  /** 予約済 message のキャンセル */
  async cancelScheduled(messageId: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/messages/${encodeURIComponent(messageId)}/cancel`);
  }

  /** topic に publish (subscriber 全員にファンアウト) */
  async publish(input: PublishInput): Promise<PublishResult> {
    const { topic, ...rest } = input;
    return this.request("POST", `/api/topics/${encodeURIComponent(topic)}/publish`, rest);
  }

  /** topic を subscribe (受信者を 1 つ追加) */
  async subscribe(input: SubscribeInput): Promise<SubscribeResult> {
    const { topic, ...rest } = input;
    return this.request("POST", `/api/topics/${encodeURIComponent(topic)}/subscribe`, rest);
  }

  /** in-app 通知 (web channel) の inbox を取得 */
  async inbox(userId: string, opts: { limit?: number; unreadOnly?: boolean } = {}): Promise<{ items: InboxItem[] }> {
    const qs = new URLSearchParams({ userId });
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.unreadOnly) qs.set("unreadOnly", "1");
    return this.request("GET", `/api/inbox?${qs.toString()}`);
  }

  /** in-app 通知を既読にする */
  async markInboxRead(itemId: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/inbox/${encodeURIComponent(itemId)}/read`);
  }

  /** ヘルスチェック (Nuntius 単体の死活) */
  async health(): Promise<{ ok: true }> {
    // health は projectAuth 不要。token なしで叩く。
    const res = await this.fetchImpl(`${this.cfg.nuntiusBaseUrl}/api/health`);
    if (!res.ok) throw new Error(`[nuntius] health ${res.status}`);
    return res.json() as Promise<{ ok: true }>;
  }

  // ─── 内部: 認証 + リクエスト ───────────────────────

  /** Cernere project token を取得 (cache + auto refresh) */
  private async getProjectToken(): Promise<string> {
    const now = Date.now();
    if (this.projectToken && this.projectTokenExpiresAt > now) {
      return this.projectToken;
    }
    if (this.cfg.debug) console.log("[nuntius-adapter] refreshing project token");

    const res = await this.fetchImpl(`${this.cfg.cernereBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "project_credentials",
        client_id: this.cfg.projectId,
        client_secret: this.cfg.projectSecret,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`[nuntius-adapter] cernere project login failed: ${res.status} ${body}`);
    }
    const data = await res.json() as {
      accessToken?: string;
      access_token?: string;
      project_token?: string;
      expiresIn?: number;
    };
    const token = data.project_token ?? data.accessToken ?? data.access_token;
    if (!token) throw new Error("[nuntius-adapter] login response missing token");
    this.projectToken = token;
    const ttl = data.expiresIn ?? 3600;
    this.projectTokenExpiresAt = now + Math.max(60, ttl - TOKEN_REFRESH_MARGIN_SEC) * 1000;
    return token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getProjectToken();
    const url = `${this.cfg.nuntiusBaseUrl}${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // 401 ⇒ token 切れの可能性。一度だけ再 login + retry。
    if (res.status === 401) {
      this.projectToken = null;
      const retryToken = await this.getProjectToken();
      const retryRes = await this.fetchImpl(url, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${retryToken}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return parseResponse<T>(retryRes, method, path);
    }
    return parseResponse<T>(res, method, path);
  }
}

async function parseResponse<T>(res: Response, method: string, path: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[nuntius-adapter] ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  // 一部 endpoint は本文を返さない可能性があるので空 body 許容
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
