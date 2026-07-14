/**
 * /api/discord — Discord 関連の admin API
 *
 *   POST /api/discord/mentions — credentials.serverId からメンション候補を fetch
 */

import { Hono } from "hono";
import { getProjectKey } from "../middleware/auth.js";
import { loadChannelCredentials } from "../channels/credentials.js";
import { fetchGuildMentions, fetchBotGuilds, fetchBotChannels } from "../channels/discord-mentions.js";
import { getSharedBotToken } from "../channels/discord-bot.js";

export const discordRoutes = new Hono();

/** 共有 BOT が招待されているかを返す (フロントの状態表示用) */
discordRoutes.get("/bot-status", (c) => {
  const token = getSharedBotToken();
  return c.json({ shared_bot_configured: !!token });
});

/** BOT が join しているサーバ (guild) 一覧 */
discordRoutes.post("/guilds", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "project context required" }, 401);

  type GuildsBody = { credentialName?: string; channel?: "discord" | "discord_bot"; botToken?: string };
  const body = await c.req.json<GuildsBody>().catch(() => ({} as GuildsBody));
  const credName = body.credentialName ?? "default";
  const channel = body.channel ?? "discord_bot";

  const creds = await loadChannelCredentials<{ token?: string; botToken?: string }>(projectKey, channel, credName);
  // 新形式: token / 旧形式: botToken
  const botToken = body.botToken || creds?.token || creds?.botToken || getSharedBotToken();
  if (!botToken) return c.json({ error: "no bot token available" }, 400);

  const guilds = await fetchBotGuilds(botToken);
  return c.json({ guilds });
});

/** 指定サーバの (text/announcement) チャンネル一覧 */
discordRoutes.post("/channels", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "project context required" }, 401);

  type ChannelsBody = { serverId?: string; credentialName?: string; channel?: "discord" | "discord_bot"; botToken?: string };
  const body = await c.req.json<ChannelsBody>().catch(() => ({} as ChannelsBody));
  if (!body.serverId) return c.json({ error: "serverId is required" }, 400);
  const credName = body.credentialName ?? "default";
  const channel = body.channel ?? "discord_bot";

  const creds = await loadChannelCredentials<{ token?: string; botToken?: string }>(projectKey, channel, credName);
  // 新形式: token / 旧形式: botToken
  const botToken = body.botToken || creds?.token || creds?.botToken || getSharedBotToken();
  if (!botToken) return c.json({ error: "no bot token available" }, 400);

  const channels = await fetchBotChannels(botToken, body.serverId);
  return c.json({ channels });
});

discordRoutes.post("/mentions", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "project context required" }, 401);

  type MentionsBody = {
    /** 既定: "default" */
    credentialName?: string;
    /** "discord" (Webhook) または "discord_bot"。default は discord_bot */
    channel?: "discord" | "discord_bot";
    /** credentials に botToken が無い場合の override (任意) */
    botToken?: string;
    /** credentials の serverId を上書きしたい場合 (任意) */
    serverId?: string;
  };
  const body = await c.req.json<MentionsBody>().catch(() => ({} as MentionsBody));

  const credName = body.credentialName ?? "default";
  const channel = body.channel ?? "discord_bot";

  const creds = await loadChannelCredentials<{ token?: string; botToken?: string; webhookUrl?: string; serverId?: string }>(
    projectKey,
    channel,
    credName,
  );

  // 優先順位: body.botToken > credentials.token > credentials.botToken > 共有 BOT (env)
  const botToken = body.botToken || creds?.token || creds?.botToken || getSharedBotToken();
  const serverId = body.serverId ?? creds?.serverId ?? "";

  if (!botToken) {
    return c.json({
      error: "no bot token available",
      hint: "Nuntius 共有 BOT (NUNTIUS_DISCORD_BOT_TOKEN) を Infisical に登録するか、credentials/body で botToken を渡してください",
    }, 400);
  }
  if (!serverId) {
    return c.json({ error: "serverId is required" }, 400);
  }

  const result = await fetchGuildMentions(botToken, serverId);
  return c.json(result);
});
