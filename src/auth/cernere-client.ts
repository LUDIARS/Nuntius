/**
 * Cernere project WS クライアント
 *
 * Nuntius は Cernere にプロジェクトとして登録され、他サービスから
 * Nuntius に来るユーザートークンを Cernere で検証する。
 *
 * 接続: GET ws://cernere/ws/project?token=<project_jwt>
 */

import { WebSocket } from "ws";

const REQUEST_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 5_000;

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class CernereProjectClient {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private pending = new Map<string, PendingRequest>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private async fetchProjectToken(): Promise<string> {
    const cernereUrl = process.env.CERNERE_URL ?? "";
    const clientId = process.env.CERNERE_PROJECT_CLIENT_ID ?? "";
    const clientSecret = process.env.CERNERE_PROJECT_CLIENT_SECRET ?? "";
    if (!cernereUrl || !clientId || !clientSecret) {
      throw new Error(
        "Cernere project credentials not configured (CERNERE_URL / CERNERE_PROJECT_CLIENT_ID / SECRET)",
      );
    }
    const res = await fetch(`${cernereUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "project_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cernere project login failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { accessToken: string };
    return data.accessToken;
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const cernereUrl = process.env.CERNERE_URL ?? "";
      const wsUrl = cernereUrl.replace(/^http/, "ws") + "/ws/project";
      console.log("[cernere-client] project token 取得中...");
      const token = await this.fetchProjectToken();
      console.log(`[cernere-client] WS 接続先: ${wsUrl}`);

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
        let opened = false;
        const connectTimer = setTimeout(() => {
          ws.close();
          reject(new Error("Cernere project WS connect timeout"));
        }, 10_000);

        ws.on("open", () => {
          clearTimeout(connectTimer);
          opened = true;
          this.ws = ws;
          console.log("[cernere-client] project WS 接続成功");
          resolve();
        });

        ws.on("message", (raw) => this.handleMessage(raw.toString()));

        ws.on("close", (code) => {
          console.warn(`[cernere-client] project WS 切断 (code=${code})`);
          this.ws = null;
          for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new Error("WS closed"));
          }
          this.pending.clear();
          if (!opened) {
            clearTimeout(connectTimer);
            reject(new Error(`WS closed before open: code=${code}`));
          } else {
            this.scheduleReconnect();
          }
        });

        ws.on("error", (err) => {
          console.error("[cernere-client] project WS エラー:", err.message);
        });

        ws.on("ping", () => ws.pong());
      });
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected().catch((err) => {
        console.error("[cernere-client] 再接続失敗:", err.message);
        this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS);
  }

  private handleMessage(raw: string): void {
    let msg: {
      type: string;
      request_id?: string;
      payload?: unknown;
      code?: string;
      message?: string;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "ping") return;
    if (!msg.request_id) return;

    const pending = this.pending.get(msg.request_id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(msg.request_id);

    if (msg.type === "module_response") {
      pending.resolve(msg.payload);
    } else {
      pending.reject(new Error(msg.message ?? `Cernere error: ${msg.code ?? "unknown"}`));
    }
  }

  async request(module: string, action: string, payload: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Cernere WS is not connected");
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Cernere request timeout: ${module}.${action}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({
        type: "module_request",
        request_id: requestId,
        module,
        action,
        payload,
      }));
    });
  }
}

export const cernereClient = new CernereProjectClient();

// ── ヘルパー (他サービスがNuntiusに対して渡すユーザートークンを検証) ──

export interface CernereUserVerify {
  valid: boolean;
  tokenType?: "user" | "project";
  user?: { id: string; name: string; email: string; role: string };
  project?: { key: string; name: string; clientId: string };
}

/**
 * Cernere の /api/auth/verify に問い合わせて、任意のトークンを検証する。
 * REST 呼び出しは Nuntius backend → Cernere (同一クラスタ or HTTPS) で行う。
 */
export async function verifyToken(token: string): Promise<CernereUserVerify> {
  const cernereUrl = process.env.CERNERE_URL ?? "";
  if (!cernereUrl) return { valid: false };
  try {
    const res = await fetch(`${cernereUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return { valid: false };
    return (await res.json()) as CernereUserVerify;
  } catch {
    return { valid: false };
  }
}

// ── Composite auth (埋め込みログイン用) ──────────────────
// Cernere project WS 経由で auth モジュールを叩き、authCode (または MFA) を返す。
// Cernere 側の実装は Schedula と共通。

export interface CompositeAuthResponse {
  authCode?: string;
  mfaRequired?: boolean;
  mfaMethods?: string[];
  mfaToken?: string;
}

export async function compositeLogin(
  email: string,
  password: string,
): Promise<CompositeAuthResponse> {
  return cernereClient.request("auth", "login", { email, password }) as Promise<CompositeAuthResponse>;
}

export async function compositeRegister(
  name: string,
  email: string,
  password: string,
): Promise<CompositeAuthResponse> {
  return cernereClient.request("auth", "register", { name, email, password }) as Promise<CompositeAuthResponse>;
}

export async function compositeMfaVerify(
  mfaToken: string,
  method: string,
  code: string,
): Promise<CompositeAuthResponse> {
  return cernereClient.request("auth", "mfa-verify", { mfaToken, method, code }) as Promise<CompositeAuthResponse>;
}
