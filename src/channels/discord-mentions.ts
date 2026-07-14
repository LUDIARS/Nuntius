/**
 * Discord guild の mention 候補を取得する。
 *
 * 入力: { botToken, serverId }
 * 出力: { roles, members, channels } の配列。
 *
 * Webhook 専用設定 (botToken 無し) では使えない。Webhook 利用者が mention
 * 機能を使いたい場合は、別途 BOT credentials を作成して呼び出すか、共有 BOT
 * token を渡す前提。
 */

const DISCORD_API = "https://discord.com/api/v10";

export interface MentionEntry {
  /** "@role:..." / "@user:..." / "#channel:..." の prefix 込み key */
  key: string;
  label: string;
  /** Discord メンション挿入時の文字列 (<@&id> / <@id> / <#id>) */
  value: string;
  type: "role" | "member" | "channel";
}

interface DiscordRole { id: string; name: string }
interface DiscordChannel { id: string; name: string; type: number }
interface DiscordMember {
  user?: { id: string; username: string; global_name?: string | null };
  nick?: string | null;
}

async function discordFetch<T>(path: string, botToken: string): Promise<T | null> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) {
    console.warn(`[discord-mentions] ${path} -> HTTP ${res.status}`);
    return null;
  }
  return res.json() as Promise<T>;
}

export interface DiscordGuildSummary {
  id: string;
  name: string;
  icon: string | null;
}

/** BOT が join している guild の一覧 */
export async function fetchBotGuilds(botToken: string): Promise<DiscordGuildSummary[]> {
  if (!botToken) return [];
  const guilds = await discordFetch<Array<{ id: string; name: string; icon: string | null }>>(
    "/users/@me/guilds",
    botToken,
  );
  return (guilds ?? []).map((g) => ({ id: g.id, name: g.name, icon: g.icon }));
}

/** BOT が join しているチャンネル一覧 (server 単位) */
export async function fetchBotChannels(
  botToken: string,
  serverId: string,
): Promise<Array<{ id: string; name: string; type: number }>> {
  if (!botToken || !serverId) return [];
  const channels = await discordFetch<Array<{ id: string; name: string; type: number }>>(
    `/guilds/${encodeURIComponent(serverId)}/channels`,
    botToken,
  );
  return (channels ?? [])
    .filter((c) => c.type === 0 || c.type === 5) // text + announcement のみ
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));
}

export async function fetchGuildMentions(
  botToken: string,
  serverId: string,
): Promise<{ entries: MentionEntry[]; warnings: string[] }> {
  if (!botToken || !serverId) {
    return { entries: [], warnings: ["botToken / serverId required"] };
  }
  const warnings: string[] = [];
  const out: MentionEntry[] = [];

  const roles = await discordFetch<DiscordRole[]>(`/guilds/${encodeURIComponent(serverId)}/roles`, botToken);
  if (roles) {
    for (const r of roles) {
      if (r.name === "@everyone") continue;
      out.push({ key: `role:${r.name}`, label: `@${r.name}`, value: `<@&${r.id}>`, type: "role" });
    }
  } else warnings.push("roles fetch failed (bot 権限 / scope を確認)");

  const channels = await discordFetch<DiscordChannel[]>(`/guilds/${encodeURIComponent(serverId)}/channels`, botToken);
  if (channels) {
    for (const ch of channels) {
      // type=0 (text) のみ。voice / category 等は除外
      if (ch.type !== 0) continue;
      out.push({ key: `channel:${ch.name}`, label: `#${ch.name}`, value: `<#${ch.id}>`, type: "channel" });
    }
  } else warnings.push("channels fetch failed");

  // GUILD_MEMBERS intent が必要なため取得失敗しがち。ベストエフォート。
  const members = await discordFetch<DiscordMember[]>(
    `/guilds/${encodeURIComponent(serverId)}/members?limit=200`,
    botToken,
  );
  if (members) {
    for (const m of members) {
      if (!m.user) continue;
      const display = m.nick || m.user.global_name || m.user.username;
      out.push({ key: `user:${m.user.username}`, label: `@${display}`, value: `<@${m.user.id}>`, type: "member" });
    }
  } else warnings.push("members fetch failed (Server Members Intent が必要かも)");

  return { entries: out, warnings };
}
