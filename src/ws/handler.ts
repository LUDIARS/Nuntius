/**
 * WS ハンドラ (/ws)
 *
 * @hono/node-ws で /ws を公開する。接続時の認証は Cernere verifyToken に委譲し、
 * project_token の場合は projectKey を、user_token の場合は userId をセッションに bind する。
 *
 * プロトコル (Cernere service_interface 準拠):
 *   S→C: { type: "connected", session_id, kind, project_key?, user_id? }
 *   S→C: { type: "ping", ts } / C→S: { type: "pong" }
 *   C→S: { type: "module_request", request_id, module, action, payload }
 *   S→C: { type: "module_response", request_id, module, action, payload }
 *   S→C: { type: "error", request_id?, code, message }
 */

import { createNodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";
import { verifyToken } from "../auth/cernere-client.js";
import { registerSession, removeSession, updatePong } from "./session.js";
import { dispatch } from "./dispatcher.js";
import type { WsContext } from "./commands.js";

interface ClientMessage {
  type: string;
  request_id?: string;
  module?: string;
  action?: string;
  payload?: unknown;
  ts?: number;
}

export function setupWebSocket(app: Hono) {
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  app.get(
    "/ws",
    upgradeWebSocket((c) => {
      // token はクエリ経由で受け取る (Authorization ヘッダは WS アップグレードで失われやすい)
      const token = c.req.query("token");

      let sessionId: string | null = null;
      let ctx: WsContext = { projectKey: null, userId: null };
      let kind: "project" | "user" = "project";

      return {
        async onOpen(_evt, ws) {
          if (!token) {
            ws.send(JSON.stringify({
              type: "error",
              code: "auth_required",
              message: "Missing token",
            }));
            ws.close(1008, "Missing token");
            return;
          }

          const verified = await verifyToken(token);
          if (!verified.valid) {
            ws.send(JSON.stringify({
              type: "error",
              code: "auth_failed",
              message: "Invalid token",
            }));
            ws.close(1008, "Authentication failed");
            return;
          }

          if (verified.tokenType === "project" && verified.project) {
            kind = "project";
            ctx = { projectKey: verified.project.key, userId: null };
          } else if (verified.tokenType === "user" && verified.user) {
            kind = "user";
            ctx = { projectKey: null, userId: verified.user.id };
          } else {
            ws.send(JSON.stringify({
              type: "error",
              code: "auth_failed",
              message: "Unknown token type",
            }));
            ws.close(1008, "Unknown token type");
            return;
          }

          const wsSendable = {
            send: (data: string) => ws.send(data),
            close: () => ws.close(),
          };
          sessionId = registerSession({
            kind,
            projectKey: ctx.projectKey,
            userId: ctx.userId,
            ws: wsSendable,
          });

          ws.send(JSON.stringify({
            type: "connected",
            session_id: sessionId,
            kind,
            project_key: ctx.projectKey,
            user_id: ctx.userId,
          }));
          console.log(`[ws] Session connected: ${sessionId} (kind=${kind}, ${ctx.projectKey ?? ctx.userId})`);
        },

        async onMessage(evt, ws) {
          if (!sessionId) return;

          let msg: ClientMessage;
          try {
            const data = typeof evt.data === "string"
              ? evt.data
              : evt.data.toString();
            msg = JSON.parse(data);
          } catch {
            ws.send(JSON.stringify({
              type: "error",
              code: "parse_error",
              message: "Invalid JSON",
            }));
            return;
          }

          switch (msg.type) {
            case "pong":
              updatePong(sessionId);
              break;

            case "module_request": {
              if (!msg.module || !msg.action) {
                ws.send(JSON.stringify({
                  type: "error",
                  request_id: msg.request_id,
                  code: "invalid_request",
                  message: "module and action are required",
                }));
                return;
              }
              try {
                const result = await dispatch(msg.module, msg.action, ctx, msg.payload);
                ws.send(JSON.stringify({
                  type: "module_response",
                  request_id: msg.request_id,
                  module: msg.module,
                  action: msg.action,
                  payload: result,
                }));
              } catch (err) {
                ws.send(JSON.stringify({
                  type: "error",
                  request_id: msg.request_id,
                  code: "command_error",
                  message: err instanceof Error ? err.message : "Unknown error",
                  module: msg.module,
                  action: msg.action,
                }));
              }
              break;
            }

            default:
              ws.send(JSON.stringify({
                type: "error",
                request_id: msg.request_id,
                code: "unknown_message_type",
                message: `Unknown type: ${msg.type}`,
              }));
          }
        },

        onClose() {
          if (sessionId) {
            removeSession(sessionId);
            console.log(`[ws] Session disconnected: ${sessionId}`);
          }
        },

        onError(err) {
          console.error(`[ws] Session error (${sessionId}):`, err);
        },
      };
    }),
  );

  return { injectWebSocket };
}
