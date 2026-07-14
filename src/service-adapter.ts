/**
 * Nuntius の peer service adapter 統合レイヤ.
 *
 * LUDIARS 内の他バックエンド (Actio, Imperativus 等) が Nuntius に
 * 直接 WS で到達できるよう、`@ludiars/cernere-service-adapter` の
 * `PeerAdapter` を初期化する。CLAUDE.md の WS-only ルールに準拠し、
 * HTTP 経由の service-to-service 呼び出しは行わない。
 *
 * 受信コマンド:
 *   - `ping` — 疎通確認
 *   - (将来: notify.schedule / notify.publish 等を actio-nuntius bridge から登録)
 */

import { PeerAdapter, type PeerHandler } from "@ludiars/cernere-service-adapter";

let adapter: PeerAdapter | null = null;

export interface NuntiusServiceAdapterConfig {
  projectId?:       string;
  projectSecret?:   string;
  cernereBaseUrl?:  string;
  saPublicBaseUrl?: string;
  extraHandlers?:   Record<string, PeerHandler>;
}

export async function initServiceAdapter(
  cfg: NuntiusServiceAdapterConfig = {},
): Promise<PeerAdapter | null> {
  // Nuntius の env 命名 (CLAUDE.md 参照) は CLIENT_ID / CLIENT_SECRET 形式.
  // 既存 PROJECT_ID / PROJECT_SECRET 形式も念のため fallback.
  const projectId      = cfg.projectId
    ?? process.env.CERNERE_PROJECT_CLIENT_ID ?? process.env.CERNERE_PROJECT_ID ?? "";
  const projectSecret  = cfg.projectSecret
    ?? process.env.CERNERE_PROJECT_CLIENT_SECRET ?? process.env.CERNERE_PROJECT_SECRET ?? "";
  const cernereBaseUrl = cfg.cernereBaseUrl ?? process.env.CERNERE_URL ?? "";

  if (!projectId || !projectSecret || !cernereBaseUrl) {
    console.log("[nuntius-sa] CERNERE_PROJECT_ID/SECRET/URL が未設定 — peer adapter は起動しません");
    return null;
  }
  const saPublicBaseUrl =
    cfg.saPublicBaseUrl ?? process.env.NUNTIUS_SA_PUBLIC_BASE_URL ?? "ws://127.0.0.1:{port}";

  adapter = new PeerAdapter({
    projectId, projectSecret, cernereBaseUrl, saPublicBaseUrl,
    saListenHost: "0.0.0.0",
    saListenPort: 0,
    accept: {
      actio:       ["ping"],
      imperativus: ["ping"],
    },
  });
  adapter.handle("ping", async (caller, payload) => ({
    ok: true, from: caller.projectKey, echo: payload,
  }));
  for (const [cmd, h] of Object.entries(cfg.extraHandlers ?? {})) {
    adapter.handle(cmd, h);
  }
  await adapter.start();
  console.log(`[nuntius-sa] peer adapter started (port ${adapter.boundListenPort})`);
  return adapter;
}

export async function shutdownServiceAdapter(): Promise<void> {
  if (adapter) { await adapter.stop(); adapter = null; }
}

export function currentServiceAdapter(): PeerAdapter | null { return adapter; }
