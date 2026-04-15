/**
 * Nuntius backend API クライアント
 *
 * 認証は Cernere Composite (HttpOnly Cookie) 経由。
 * すべての fetch は `credentials: 'include'` で Cookie を送信する。
 */

export const CHANNELS = [
  'slack', 'discord', 'line', 'webhook',
  'email', 'sms', 'alexa', 'voice', 'web',
] as const
export type ChannelType = (typeof CHANNELS)[number]

export const CHANNEL_LABELS: Record<ChannelType | 'all', string> = {
  all: '全チャネル',
  slack: 'Slack',
  discord: 'Discord',
  line: 'LINE',
  webhook: 'Webhook',
  email: 'Email',
  sms: 'SMS',
  alexa: 'Alexa',
  voice: 'Voice (電話)',
  web: 'Web (In-app)',
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
  mentionSuggestions(channel?: ChannelType | 'all'): Promise<{ mentions: MentionSuggestion[] }> {
    const qs = channel ? `?channel=${encodeURIComponent(channel)}` : ''
    return request('GET', `/api/templates/mentions${qs}`)
  },
}
