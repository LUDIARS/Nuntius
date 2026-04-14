/**
 * Nuntius backend API クライアント
 *
 * project_token (Cernere 発行) を Authorization: Bearer でそのまま送る。
 * token は localStorage に保存 (ブラウザ限定。本番環境では Cernere Composite などで
 * HttpOnly Cookie 化する想定だが、管理 UI としては十分)。
 */

const STORAGE_KEY = 'nuntius.admin.project_token'

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

// ── token ─────────────────────────────────────────────

export function getProjectToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setProjectToken(t: string): void {
  localStorage.setItem(STORAGE_KEY, t)
}

export function clearProjectToken(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// ── fetch ─────────────────────────────────────────────

async function request<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
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

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// ── 疎通確認 ──────────────────────────────────────────

export async function pingHealth(token: string): Promise<'ok' | 'auth_error' | 'network_error'> {
  try {
    // まず /api/health でネットワーク疎通、次に /api/templates で認証疎通
    const health = await fetch('/api/health')
    if (!health.ok) return 'network_error'
    const r = await fetch('/api/templates', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (r.ok) return 'ok'
    if (r.status === 401 || r.status === 403) return 'auth_error'
    return 'network_error'
  } catch {
    return 'network_error'
  }
}

// ── patterns API ──────────────────────────────────────

export const patternsApi = {
  list(token: string, channel?: ChannelType | 'all'): Promise<{ templates: Pattern[] }> {
    const qs = channel ? `?channel=${encodeURIComponent(channel)}` : ''
    return request(token, 'GET', `/api/templates${qs}`)
  },
  get(token: string, id: string): Promise<Pattern> {
    return request(token, 'GET', `/api/templates/${encodeURIComponent(id)}`)
  },
  create(token: string, data: PatternDraft): Promise<{ id: string; name: string }> {
    return request(token, 'POST', '/api/templates', data)
  },
  update(token: string, id: string, data: Partial<PatternDraft>): Promise<{ id: string; updated: true }> {
    return request(token, 'PUT', `/api/templates/${encodeURIComponent(id)}`, data)
  },
  remove(token: string, id: string): Promise<{ id: string; deleted: true }> {
    return request(token, 'DELETE', `/api/templates/${encodeURIComponent(id)}`)
  },
  render(token: string, id: string, input: {
    values?: Record<string, unknown>
    channel?: ChannelType
    extraMentions?: TemplateMention[]
  }): Promise<{ subject: string | null; body: string }> {
    return request(token, 'POST', `/api/templates/${encodeURIComponent(id)}/render`, input)
  },
  mentionSuggestions(token: string, channel?: ChannelType | 'all'): Promise<{ mentions: MentionSuggestion[] }> {
    const qs = channel ? `?channel=${encodeURIComponent(channel)}` : ''
    return request(token, 'GET', `/api/templates/mentions${qs}`)
  },
}
