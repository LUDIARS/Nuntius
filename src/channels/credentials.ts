/**
 * channel_credentials テーブルからチャネル認証情報をロード / 保存する。
 *
 * DB 列 `credentials` (JSONB) は AES-256-GCM で暗号化して保存する。
 * 鍵は `NUNTIUS_ENCRYPTION_KEY` (Infisical 管理)。詳細は src/crypto/secret.ts 参照。
 *
 * 後方互換: 既存の平文 JSONB が残っている場合は警告ログを出しつつそのまま返す
 * (次回の save で自動的に暗号化される)。
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { channelCredentials, type ChannelType } from "../db/schema.js";
import { decryptJson, encryptJson, isEncryptedEnvelope } from "../crypto/secret.js";

export async function loadChannelCredentials<T = Record<string, unknown>>(
  projectKey: string,
  channel: ChannelType,
  name: string = "default",
): Promise<T | null> {
  if (!projectKey) return null;
  const rows = await db
    .select({ credentials: channelCredentials.credentials, enabled: channelCredentials.enabled })
    .from(channelCredentials)
    .where(
      and(
        eq(channelCredentials.projectKey, projectKey),
        eq(channelCredentials.channel, channel),
        eq(channelCredentials.name, name),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.enabled) return null;

  const stored = row.credentials as unknown;
  if (isEncryptedEnvelope(stored)) {
    try {
      return decryptJson<T>(stored);
    } catch (err) {
      console.error(
        `[channel_credentials] decrypt failed (project=${projectKey} channel=${channel} name=${name}):`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
  // 後方互換: 平文が残っているケース
  console.warn(
    `[channel_credentials] plaintext row detected (project=${projectKey} channel=${channel} name=${name}); re-save to encrypt`,
  );
  return (stored as T) ?? null;
}

export async function saveChannelCredentials(
  projectKey: string,
  channel: ChannelType,
  name: string,
  plain: Record<string, unknown>,
  enabled: boolean = true,
): Promise<void> {
  const envelope = encryptJson(plain);
  const now = new Date();
  await db
    .insert(channelCredentials)
    .values({
      id: randomUUID(),
      projectKey,
      channel,
      name,
      credentials: envelope,
      enabled,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [channelCredentials.projectKey, channelCredentials.channel, channelCredentials.name],
      set: { credentials: envelope, enabled, updatedAt: now },
    });
}
