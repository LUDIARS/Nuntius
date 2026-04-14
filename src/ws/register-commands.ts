/**
 * nuntius.* WS コマンド登録
 *
 * Nuntius WS (/ws) 経由で呼び出されるコマンドを一括登録する。
 * REST API (src/routes/*) と同じビジネスロジックを commands.ts から呼ぶ。
 *
 * 各ハンドラは `commands.ts` を遅延 import する。これにより DB/Redis を
 * 初期化せずに登録だけ完了できるため、ユニットテスト (vitest) でも安全。
 *
 * すべて project-scoped。project_token での接続時に限り実行可能
 * (ctx.projectKey が null の場合はコマンド側でエラーになる)。
 */

import { registerCommand } from "./dispatcher.js";
import type { WsContext } from "./commands.js";

let registered = false;

export function registerNuntiusCommands(): void {
  if (registered) return;
  registered = true;

  registerCommand("nuntius", "schedule", async (ctx: WsContext, payload) => {
    const { scheduleMessage, type } = await loadCommands();
    void type;
    return scheduleMessage(ctx, payload as Parameters<typeof scheduleMessage>[1]);
  });

  registerCommand("nuntius", "cancel", async (ctx: WsContext, payload) => {
    const { cancelScheduledMessage } = await loadCommands();
    return cancelScheduledMessage(ctx, payload as { id: string });
  });

  registerCommand("nuntius", "publish", async (ctx: WsContext, payload) => {
    const { publishToTopic } = await loadCommands();
    return publishToTopic(ctx, payload as Parameters<typeof publishToTopic>[1]);
  });

  registerCommand("nuntius", "subscribe", async (ctx: WsContext, payload) => {
    const { subscribeTopic } = await loadCommands();
    return subscribeTopic(ctx, payload as Parameters<typeof subscribeTopic>[1]);
  });

  registerCommand("nuntius", "list_my", async (ctx: WsContext, payload) => {
    const { listMyMessages } = await loadCommands();
    return listMyMessages(ctx, (payload ?? {}) as Parameters<typeof listMyMessages>[1]);
  });
}

async function loadCommands() {
  const mod = await import("./commands.js");
  return { ...mod, type: undefined };
}
