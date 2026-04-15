/**
 * WS コマンドディスパッチャ
 *
 * module_request を受けて登録済みハンドラにルーティングする。
 * ハンドラには認証済みコンテキスト (WsContext) が渡される。
 */

import type { WsContext } from "./commands.js";

// ── 型定義 ──────────────────────────────────────────

export type CommandHandler = (ctx: WsContext, payload: unknown) => Promise<unknown>;

// ── レジストリ ──────────────────────────────────────

/** module → action → handler */
const handlers = new Map<string, Map<string, CommandHandler>>();

export function registerCommand(
  module: string,
  action: string,
  handler: CommandHandler,
): void {
  if (!handlers.has(module)) {
    handlers.set(module, new Map());
  }
  handlers.get(module)!.set(action, handler);
}

export async function dispatch(
  module: string,
  action: string,
  ctx: WsContext,
  payload: unknown,
): Promise<unknown> {
  const mod = handlers.get(module);
  if (!mod) throw new Error(`Unknown module: ${module}`);
  const handler = mod.get(action);
  if (!handler) throw new Error(`Unknown action: ${module}.${action}`);
  return handler(ctx, payload);
}

export function listCommands(): Array<{ module: string; action: string }> {
  const result: Array<{ module: string; action: string }> = [];
  for (const [module, actions] of handlers) {
    for (const action of actions.keys()) {
      result.push({ module, action });
    }
  }
  return result;
}
