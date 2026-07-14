/**
 * Slack Incoming Webhook への配信
 *
 * payload:
 *   webhookUrl:     string  — 送信先 URL を直接指定 (最優先)
 *   credentialName: string  — channel_credentials.name を参照 (省略時 "default")
 *   text:           string  — テキスト本文
 *   blocks:         unknown[] (任意) — Block Kit
 *   attachments?:   MediaAttachment[]
 *
 * メディア添付: Incoming Webhook は実ファイルアップロード不可のため URL degrade。
 *   image → Block Kit の image ブロック (公開 URL 必須)
 *   その他 → 本文末尾に URL を追記
 *
 * credentials (JSONB): { webhookUrl: string }
 */

import type { ChannelDispatcher, DispatchResult } from "./types.js";
import type { ScheduledMessage } from "../db/schema.js";
import { loadChannelCredentials } from "./credentials.js";
import { dispatchableAttachments } from "../media/attachment.js";

export const slackDispatcher: ChannelDispatcher = {
  channel: "slack",
  async dispatch(message: ScheduledMessage): Promise<DispatchResult> {
    const p = message.payload as Record<string, unknown>;
    let webhookUrl = (p.webhookUrl as string | undefined) ?? "";
    if (!webhookUrl) {
      const credName = (p.credentialName as string | undefined) ?? "default";
      const creds = await loadChannelCredentials<{ webhookUrl?: string }>(
        message.projectKey,
        "slack",
        credName,
      );
      webhookUrl = creds?.webhookUrl ?? "";
    }
    if (!webhookUrl) {
      return { success: false, error: "No Slack webhook URL configured (channel_credentials)" };
    }

    let text = typeof p.text === "string" ? p.text : "";
    const blocks: unknown[] = Array.isArray(p.blocks) ? [...p.blocks] : [];

    // メディア添付の URL degrade: image は image ブロック、 他は本文末尾に URL
    const extraUrls: string[] = [];
    for (const a of dispatchableAttachments(p)) {
      if (a.kind === "image") {
        blocks.push({
          type: "image",
          image_url: a.url,
          alt_text: a.caption ?? a.fileName ?? "image",
        });
      } else {
        const label = a.caption ?? a.fileName ?? a.kind;
        extraUrls.push(`<${a.url}|${label}>`);
      }
    }
    if (extraUrls.length > 0) {
      text = text ? `${text}\n${extraUrls.join("\n")}` : extraUrls.join("\n");
    }

    const body: Record<string, unknown> = {};
    if (text) body.text = text;
    if (blocks.length > 0) body.blocks = blocks;
    if (Object.keys(body).length === 0) {
      return { success: false, error: "Empty Slack payload (need text, blocks, or attachments)" };
    }

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseText = await res.text().catch(() => "");
      return {
        success: res.ok,
        httpStatus: res.status,
        responseBody: responseText.slice(0, 500),
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
