/**
 * WS セッション管理
 *
 * インメモリで WS 接続を管理する。Nuntius は project/user 両方の token を
 * 受け付けるため、セッションは認証種別 (kind) を保持する。
 *
 * - kind: "project" — 他サービスからの接続 (projectKey が確定)
 * - kind: "user"    — エンドユーザー直接接続 (userId が確定)
 */

import { randomUUID } from "node:crypto";

// ── 型定義 ──────────────────────────────────────────

interface WsSendable {
  send(data: string): void;
  close(): void;
}

export type WsSessionKind = "project" | "user";

export interface WsSession {
  sessionId: string;
  kind: WsSessionKind;
  projectKey: string | null;
  userId: string | null;
  ws: WsSendable;
  lastPong: number;
  pingTimer: ReturnType<typeof setInterval> | null;
}

// ── セッションレジストリ ────────────────────────────

const sessions = new Map<string, WsSession>();

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 40_000; // ping + 10s margin

/**
 * 新しい WS セッションを登録し、Ping タイマーを開始する。
 */
export function registerSession(
  opts: {
    kind: WsSessionKind;
    projectKey: string | null;
    userId: string | null;
    ws: WsSendable;
  },
): string {
  const sessionId = randomUUID();

  const pingTimer = setInterval(() => {
    const s = sessions.get(sessionId);
    if (!s) return;
    if (Date.now() - s.lastPong > PONG_TIMEOUT_MS) {
      s.ws.close();
      removeSession(sessionId);
      return;
    }
    s.ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
  }, PING_INTERVAL_MS);

  sessions.set(sessionId, {
    sessionId,
    kind: opts.kind,
    projectKey: opts.projectKey,
    userId: opts.userId,
    ws: opts.ws,
    lastPong: Date.now(),
    pingTimer,
  });

  return sessionId;
}

export function removeSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (s.pingTimer) clearInterval(s.pingTimer);
  sessions.delete(sessionId);
}

export function updatePong(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (s) s.lastPong = Date.now();
}

export function getSession(sessionId: string): WsSession | undefined {
  return sessions.get(sessionId);
}

/** 指定ユーザー (kind=user) の全セッションを取得 */
export function getSessionsByUser(userId: string): WsSession[] {
  return [...sessions.values()].filter((s) => s.kind === "user" && s.userId === userId);
}

/** 指定ユーザー (kind=user) の全 WS にメッセージを送信 */
export function broadcastToUser(userId: string, message: unknown): void {
  const json = JSON.stringify(message);
  for (const s of getSessionsByUser(userId)) {
    s.ws.send(json);
  }
}

export function getSessionCount(): number {
  return sessions.size;
}
