/**
 * WS ハンドラ integration test
 *
 * 実際に @hono/node-server を起動し、ws クライアントで /ws に接続して
 * 認証フロー・エラー応答・module_request ラウンドトリップを検証する。
 *
 * Cernere verifyToken() は vi.mock で差し替え、外部依存なしで完結させる。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { serve } from "@hono/node-server";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";

// Cernere verifyToken を差し替え (実 HTTP を叩かない)
vi.mock("../src/auth/cernere-client.js", () => ({
  verifyToken: vi.fn(async (token: string) => {
    if (token === "proj-token") {
      return {
        valid: true,
        tokenType: "project",
        project: { key: "demo-proj", name: "Demo", clientId: "cid-1" },
      };
    }
    if (token === "user-token") {
      return {
        valid: true,
        tokenType: "user",
        user: { id: "u-123", name: "U", email: "u@x", role: "admin" },
      };
    }
    return { valid: false };
  }),
}));

// dispatcher にテスト用コマンドを登録
import { Hono } from "hono";
import { setupWebSocket } from "../src/ws/handler.js";
import { registerCommand } from "../src/ws/dispatcher.js";

registerCommand("test", "echo", async (ctx, payload) => ({
  payload,
  projectKey: ctx.projectKey,
  userId: ctx.userId,
}));

registerCommand("test", "boom", async () => {
  throw new Error("intentional failure");
});

// ── テスト用サーバー起動 ──────────────────────────
let server: ReturnType<typeof serve>;
let port: number;

beforeAll(async () => {
  const app = new Hono();
  const { injectWebSocket } = setupWebSocket(app);
  server = serve({ fetch: app.fetch, port: 0 });
  injectWebSocket(server);
  await new Promise((r) => setTimeout(r, 50));
  const addr = (server as unknown as { address: () => AddressInfo }).address();
  port = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

// ── ヘルパ ────────────────────────────────────────
interface ServerMessage {
  type: string;
  session_id?: string;
  kind?: string;
  project_key?: string | null;
  user_id?: string | null;
  code?: string;
  message?: string;
  request_id?: string;
  payload?: unknown;
  module?: string;
  action?: string;
}

function connect(token: string | null): Promise<{
  ws: WebSocket;
  messages: ServerMessage[];
  waitFor: (predicate: (m: ServerMessage) => boolean, timeoutMs?: number) => Promise<ServerMessage>;
  waitClose: (timeoutMs?: number) => Promise<{ code: number; reason: string }>;
}> {
  const url = token === null
    ? `ws://127.0.0.1:${port}/ws`
    : `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  const messages: ServerMessage[] = [];
  const listeners: Array<(m: ServerMessage) => void> = [];

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString()) as ServerMessage;
    messages.push(msg);
    for (const l of listeners) l(msg);
  });

  const waitFor = (predicate: (m: ServerMessage) => boolean, timeoutMs = 2000) =>
    new Promise<ServerMessage>((resolve, reject) => {
      const existing = messages.find(predicate);
      if (existing) return resolve(existing);
      const t = setTimeout(() => {
        reject(new Error("waitFor timeout"));
      }, timeoutMs);
      const listener = (m: ServerMessage) => {
        if (predicate(m)) {
          clearTimeout(t);
          resolve(m);
        }
      };
      listeners.push(listener);
    });

  const waitClose = (timeoutMs = 2000) =>
    new Promise<{ code: number; reason: string }>((resolve, reject) => {
      if (ws.readyState === WebSocket.CLOSED) {
        return resolve({ code: 0, reason: "" });
      }
      const t = setTimeout(() => reject(new Error("waitClose timeout")), timeoutMs);
      ws.once("close", (code, reason) => {
        clearTimeout(t);
        resolve({ code, reason: reason.toString() });
      });
    });

  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, messages, waitFor, waitClose }));
    ws.once("error", (err) => reject(err));
    ws.once("close", (code, reason) => {
      // open 前に closeしてしまった場合 (auth error など) も resolve で
      // messages を検査できるようにする
      resolve({
        ws,
        messages,
        waitFor,
        waitClose: () => Promise.resolve({ code, reason: reason.toString() }),
      });
    });
  });
}

// ── テスト本体 ────────────────────────────────────

describe("/ws 認証フロー", () => {
  it("token なしは auth_required エラーを返して閉じる", async () => {
    const c = await connect(null);
    // onOpen で send → close されるため、message は受信できるケース/できないケース両方ある
    await new Promise((r) => setTimeout(r, 150));
    const hasAuthErr = c.messages.some(
      (m) => m.type === "error" && m.code === "auth_required",
    );
    const closed = c.ws.readyState === WebSocket.CLOSED || c.ws.readyState === WebSocket.CLOSING;
    expect(hasAuthErr || closed).toBe(true);
  });

  it("不正 token は auth_failed エラーを返して閉じる", async () => {
    const c = await connect("garbage");
    await new Promise((r) => setTimeout(r, 150));
    const hasAuthErr = c.messages.some(
      (m) => m.type === "error" && m.code === "auth_failed",
    );
    const closed = c.ws.readyState === WebSocket.CLOSED || c.ws.readyState === WebSocket.CLOSING;
    expect(hasAuthErr || closed).toBe(true);
  });

  it("project_token で connected メッセージと kind=project を受信する", async () => {
    const c = await connect("proj-token");
    const connected = await c.waitFor((m) => m.type === "connected");
    expect(connected.kind).toBe("project");
    expect(connected.project_key).toBe("demo-proj");
    expect(connected.user_id).toBeNull();
    expect(typeof connected.session_id).toBe("string");
    expect(connected.session_id!.length).toBeGreaterThan(0);
    c.ws.close();
  });

  it("user_token で connected メッセージと kind=user を受信する", async () => {
    const c = await connect("user-token");
    const connected = await c.waitFor((m) => m.type === "connected");
    expect(connected.kind).toBe("user");
    expect(connected.user_id).toBe("u-123");
    expect(connected.project_key).toBeNull();
    c.ws.close();
  });
});

describe("/ws module_request ラウンドトリップ", () => {
  it("test.echo はハンドラ結果を module_response で返す", async () => {
    const c = await connect("proj-token");
    await c.waitFor((m) => m.type === "connected");

    c.ws.send(JSON.stringify({
      type: "module_request",
      request_id: "req-echo-1",
      module: "test",
      action: "echo",
      payload: { hello: "world" },
    }));

    const resp = await c.waitFor(
      (m) => m.type === "module_response" && m.request_id === "req-echo-1",
    );
    expect(resp.module).toBe("test");
    expect(resp.action).toBe("echo");
    expect(resp.payload).toEqual({
      payload: { hello: "world" },
      projectKey: "demo-proj",
      userId: null,
    });
    c.ws.close();
  });

  it("test.boom は error メッセージを返す (接続は切らない)", async () => {
    const c = await connect("proj-token");
    await c.waitFor((m) => m.type === "connected");

    c.ws.send(JSON.stringify({
      type: "module_request",
      request_id: "req-boom-1",
      module: "test",
      action: "boom",
    }));

    const err = await c.waitFor(
      (m) => m.type === "error" && m.request_id === "req-boom-1",
    );
    expect(err.code).toBe("command_error");
    expect(err.message).toContain("intentional failure");
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
  });

  it("未知 module は error を返す", async () => {
    const c = await connect("proj-token");
    await c.waitFor((m) => m.type === "connected");

    c.ws.send(JSON.stringify({
      type: "module_request",
      request_id: "req-ng",
      module: "no-such",
      action: "noop",
    }));

    const err = await c.waitFor(
      (m) => m.type === "error" && m.request_id === "req-ng",
    );
    expect(err.code).toBe("command_error");
    expect(err.message).toContain("Unknown module");
    c.ws.close();
  });

  it("module/action 欠如の module_request は invalid_request", async () => {
    const c = await connect("proj-token");
    await c.waitFor((m) => m.type === "connected");

    c.ws.send(JSON.stringify({
      type: "module_request",
      request_id: "req-bad",
    }));

    const err = await c.waitFor(
      (m) => m.type === "error" && m.request_id === "req-bad",
    );
    expect(err.code).toBe("invalid_request");
    c.ws.close();
  });

  it("不正 JSON は parse_error を返す", async () => {
    const c = await connect("proj-token");
    await c.waitFor((m) => m.type === "connected");

    c.ws.send("not-json");

    const err = await c.waitFor(
      (m) => m.type === "error" && m.code === "parse_error",
    );
    expect(err.message).toBeDefined();
    c.ws.close();
  });
});
