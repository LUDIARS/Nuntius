/**
 * Nuntius backend API クライアント
 *
 * 認証は Cernere Composite (HttpOnly Cookie) 経由。
 * すべての fetch は `credentials: 'include'` で Cookie を送信する。
 */

export const CHANNELS = [
  'slack', 'discord', 'discord_bot', 'line', 'webhook',
  'email', 'sms', 'alexa', 'voice', 'web', 'webpush',
] as const
export type ChannelType = (typeof CHANNELS)[number]

export const CHANNEL_LABELS: Record<ChannelType | 'all', string> = {
  all: '全チャネル',
  slack: 'Slack',
  discord: 'Discord (Webhook)',
  discord_bot: 'Discord (BOT)',
  line: 'LINE',
  webhook: 'Webhook',
  email: 'Email',
  sms: 'SMS',
  alexa: 'Alexa',
  voice: 'Voice (電話)',
  web: 'Web (In-app)',
  webpush: 'Web Push',
}

// ── 型定義 ────────────────────────────────────────────

export interface TemplateVariable {
  name: string
  label?: string
  description?: string
  required?: boolean
  example?: string
}

export interface TemplateMention {
  key: string
  label: string
  channelValues?: Partial<Record<ChannelType | 'all', string>>
}

export interface Pattern {
  id: string
  name: string
  description?: string | null
  channel: ChannelType | 'all'
  locale: string
  subject: string | null
  body: string
  variables: TemplateVariable[]
  mentions: TemplateMention[]
  channelConfig?: Record<string, unknown>
  projectKey: string
  createdAt: string
  updatedAt: string
}

export interface PatternDraft {
  name: string
  description?: string | null
  channel: ChannelType | 'all'
  locale: string
  subject: string | null
  body: string
  variables: TemplateVariable[]
  mentions: TemplateMention[]
  channelConfig?: Record<string, unknown>
}

export interface MentionSuggestion {
  key: string
  label: string
  value: string
}

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: string
}

export interface CompositeAuthResponse {
  authCode?: string
  mfaRequired?: boolean
  mfaMethods?: string[]
  mfaToken?: string
}

// ── fetch ─────────────────────────────────────────────

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const contentType = res.headers.get('content-type') ?? ''
  const data: unknown = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : null
  if (!res.ok) {
    const err = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`
    throw new ApiError(err, res.status)
  }
  return data as T
}

// ── 疎通確認 ──────────────────────────────────────────

export async function pingHealth(): Promise<'ok' | 'auth_error' | 'network_error'> {
  try {
    const health = await fetch('/api/health')
    if (!health.ok) return 'network_error'
    const r = await fetch('/api/templates', { credentials: 'include' })
    if (r.ok) return 'ok'
    if (r.status === 401 || r.status === 403) return 'auth_error'
    return 'network_error'
  } catch {
    return 'network_error'
  }
}

// ── auth API (Cernere Composite) ──────────────────────

export const authApi = {
  me(): Promise<CurrentUser> {
    return request('GET', '/api/auth/me')
  },
  async logout(): Promise<void> {
    await request('POST', '/api/auth/logout')
  },
  login(email: string, password: string): Promise<CompositeAuthResponse> {
    return request('POST', '/api/auth/cernere/login', { email, password })
  },
  register(name: string, email: string, password: string): Promise<CompositeAuthResponse> {
    return request('POST', '/api/auth/cernere/register', { name, email, password })
  },
  mfaVerify(mfaToken: string, method: string, code: string): Promise<CompositeAuthResponse> {
    return request('POST', '/api/auth/cernere/mfa-verify', { mfaToken, method, code })
  },
  exchange(authCode: string): Promise<{ user: { id: string; displayName: string; email: string; role: string } }> {
    return request('POST', '/api/auth/exchange', { authCode })
  },
  loginUrl(origin: string): Promise<{ url: string }> {
    return request('GET', `/api/auth/login-url?origin=${encodeURIComponent(origin)}`)
  },
}

// ── patterns API ──────────────────────────────────────

export const patternsApi = {
  list(channel?: ChannelType | 'all'): Promise<{ templates: Pattern[] }> {
    const qs = channel ? `?channel=${encodeURIComponent(channel)}` : ''
    return request('GET', `/api/templates${qs}`)
  },
  get(id: string): Promise<Pattern> {
    return request('GET', `/api/templates/${encodeURIComponent(id)}`)
  },
  create(data: PatternDraft): Promise<{ id: string; name: string }> {
    return request('POST', '/api/templates', data)
  },
  update(id: string, data: Partial<PatternDraft>): Promise<{ id: string; updated: true }> {
    return request('PUT', `/api/templates/${encodeURIComponent(id)}`, data)
  },
  remove(id: string): Promise<{ id: string; deleted: true }> {
    return request('DELETE', `/api/templates/${encodeURIComponent(id)}`)
  },
  render(id: string, input: {
    values?: Record<string, unknown>
    channel?: ChannelType
    extraMentions?: TemplateMention[]
  }): Promise<{ subject: string | null; body: string }> {
    return request('POST', `/api/templates/${encodeURIComponent(id)}/render`, input)
  },
  testSend(id: string, values: Record<string, unknown>): Promise<{ success: boolean; error?: string; httpStatus?: number; rendered: { subject: string | null; body: string } }> {
    return request('POST', `/api/templates/${encodeURIComponent(id)}/test-send`, { values })
  },
  mentionSuggestions(channel?: ChannelType | 'all'): Promise<{ mentions: MentionSuggestion[] }> {
    const qs = channel ? `?channel=${encodeURIComponent(channel)}` : ''
    return request('GET', `/api/templates/mentions${qs}`)
  },
}

// ── credentials API ──────────────────────────────────

export interface ChannelCredentialRow {
  channel: ChannelType
  name: string
  enabled: boolean
  updatedAt: string
}

export const credentialsApi = {
  list(): Promise<{ credentials: ChannelCredentialRow[] }> {
    return request('GET', '/api/credentials')
  },
  get(channel: ChannelType, name: string): Promise<{ channel: ChannelType; name: string; credentials: Record<string, unknown> }> {
    return request('GET', `/api/credentials/${encodeURIComponent(channel)}/${encodeURIComponent(name)}`)
  },
  save(channel: ChannelType, name: string, credentials: Record<string, unknown>, enabled = true): Promise<{ ok: true }> {
    return request('PUT', `/api/credentials/${encodeURIComponent(channel)}/${encodeURIComponent(name)}`, { credentials, enabled })
  },
  remove(channel: ChannelType, name: string): Promise<{ ok: true }> {
    return request('DELETE', `/api/credentials/${encodeURIComponent(channel)}/${encodeURIComponent(name)}`)
  },
}

// ── Discord ─────────────────────────────────────────

export interface DiscordMentionEntry {
  key: string
  label: string
  value: string
  type: 'role' | 'member' | 'channel'
}

export interface DiscordGuildSummary { id: string; name: string; icon: string | null }
export interface DiscordChannelSummary { id: string; name: string; type: number }

export const discordApi = {
  botStatus(): Promise<{ shared_bot_configured: boolean }> {
    return request('GET', '/api/discord/bot-status')
  },
  fetchMentions(input: {
    channel?: 'discord' | 'discord_bot'
    credentialName?: string
    botToken?: string
    serverId?: string
  } = {}): Promise<{ entries: DiscordMentionEntry[]; warnings: string[] }> {
    return request('POST', '/api/discord/mentions', input)
  },
  fetchGuilds(input: {
    channel?: 'discord' | 'discord_bot'
    credentialName?: string
    botToken?: string
  } = {}): Promise<{ guilds: DiscordGuildSummary[] }> {
    return request('POST', '/api/discord/guilds', input)
  },
  fetchChannels(input: {
    serverId: string
    channel?: 'discord' | 'discord_bot'
    credentialName?: string
    botToken?: string
  }): Promise<{ channels: DiscordChannelSummary[] }> {
    return request('POST', '/api/discord/channels', input)
  },
}

// ── notification preferences API ─────────────────────

export interface NotificationPreferences {
  id?: string
  userId: string
  projectKey?: string
  channels: ChannelType[]
  lineUserId?: string | null
  lineCredentialName?: string | null
  slackUserId?: string | null
  email?: string | null
  updatedAt?: string
}

export const preferencesApi = {
  get(userId: string): Promise<{ preferences: NotificationPreferences }> {
    return request('GET', `/api/notify/preferences?userId=${encodeURIComponent(userId)}`)
  },
  save(input: {
    userId: string
    channels?: ChannelType[]
    lineUserId?: string | null
    lineCredentialName?: string | null
    slackUserId?: string | null
    email?: string | null
  }): Promise<{ id: string; status: 'created' | 'updated' }> {
    return request('PUT', '/api/notify/preferences', input)
  },
}
