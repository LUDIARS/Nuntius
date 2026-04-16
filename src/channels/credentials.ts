/**
 * channel_credentials テーブルからチャネル認証情報をロードする。
 *
 * 呼び出し側は `loadChannelCredentials(projectKey, channel, name?)` で
 * JSONB の credentials オブジェクトを取得する。未登録または enabled=false の
 * 場合は null を返す。
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { channelCredentials, type ChannelType } from "../db/schema.js";

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
  return (row.credentials as T) ?? null;
}
