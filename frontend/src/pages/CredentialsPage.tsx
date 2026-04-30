import { useEffect, useState, useCallback } from 'react'
import {
  CHANNELS, CHANNEL_LABELS,
  credentialsApi, discordApi,
  type ChannelType, type ChannelCredentialRow,
  type DiscordGuildSummary,
} from '../lib/api'

const ALL_CHANNELS: ChannelType[] = [...CHANNELS]

interface DraftCreds {
  channel: ChannelType
  name: string
  enabled: boolean
  values: Record<string, string>
}

/** チャネル毎の token ラベル — credentials.token に格納する値の意味 */
const TOKEN_LABEL: Partial<Record<ChannelType, { label: string; placeholder?: string; hint?: string }>> = {
  discord:      { label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...' },
  discord_bot:  { label: 'Bot Token',   placeholder: 'MTIzNDU2…',
                  hint: '空のままなら Nuntius 共有 BOT (NUNTIUS_DISCORD_BOT_TOKEN) を使用' },
  slack:        { label: 'Bot Token (xoxb-…)', placeholder: 'xoxb-…' },
  line:         { label: 'Channel Access Token' },
  webhook:      { label: 'URL', placeholder: 'https://...' },
  email:        { label: 'SMTP URL', placeholder: 'smtp://user:pass@host:587' },
  sms:          { label: 'API Token' },
  alexa:        { label: 'API Token' },
  voice:        { label: 'API Token' },
  web:          { label: '(不要)', hint: 'Web in-app は token 不要' },
  webpush:      { label: '(不要)', hint: 'WebPush は VAPID 鍵 (環境変数) のみ、 channel credentials 不要' },
}

export function CredentialsPage() {
  const [list, setList] = useState<ChannelCredentialRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftCreds | null>(null)
  const [saving, setSaving] = useState(false)
  const [guilds, setGuilds] = useState<DiscordGuildSummary[]>([])
  const [fetchingGuilds, setFetchingGuilds] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await credentialsApi.list()
      setList(r.credentials)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const startNew = (channel: ChannelType) => {
    setDraft({ channel, name: 'default', enabled: true, values: { token: '' } })
    setGuilds([])
  }

  const startEdit = async (row: ChannelCredentialRow) => {
    try {
      const r = await credentialsApi.get(row.channel, row.name)
      const values: Record<string, string> = { token: String(r.credentials.token ?? '') }
      setDraft({ channel: row.channel, name: row.name, enabled: row.enabled, values })
      setGuilds([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const saveDraft = async () => {
    if (!draft) return
    setSaving(true); setError(null)
    try {
      await credentialsApi.save(draft.channel, draft.name, draft.values, draft.enabled)
      await refresh()
      // 保存後 reload して **configured** sentinel に置き換える
      const r = await credentialsApi.get(draft.channel, draft.name)
      const values: Record<string, string> = {}
      for (const [k, v] of Object.entries(r.credentials)) values[k] = String(v ?? '')
      setDraft({ ...draft, values })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const removeDraft = async () => {
    if (!draft) return
    if (!confirm(`${CHANNEL_LABELS[draft.channel]} / "${draft.name}" を削除しますか?`)) return
    try {
      await credentialsApi.remove(draft.channel, draft.name)
      setDraft(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const fetchGuilds = async () => {
    if (!draft) return
    setFetchingGuilds(true); setError(null)
    try {
      const r = await discordApi.fetchGuilds({
        channel: draft.channel === 'discord_bot' ? 'discord_bot' : 'discord',
        credentialName: draft.name,
        botToken: draft.values.token && draft.values.token !== '**configured**' ? draft.values.token : undefined,
      })
      setGuilds(r.guilds)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFetchingGuilds(false)
    }
  }

  const isDiscord = draft?.channel === 'discord' || draft?.channel === 'discord_bot'

  return (
    <div className="patterns-layout">
      <aside className="pattern-list">
        <div className="pattern-list-head">
          <strong>認証情報 ({list.length})</strong>
          <select
            onChange={(e) => { if (e.target.value) startNew(e.target.value as ChannelType) }}
            defaultValue=""
            style={{ padding: '0.3rem' }}
          >
            <option value="" disabled>+ 新規追加</option>
            {ALL_CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
            ))}
          </select>
        </div>
        {loading && <div className="hint">読み込み中…</div>}
        <ul>
          {list.map((row) => (
            <li
              key={`${row.channel}:${row.name}`}
              className={draft?.channel === row.channel && draft?.name === row.name ? 'selected' : ''}
              onClick={() => startEdit(row)}
            >
              <div className="p-name">{CHANNEL_LABELS[row.channel]} / {row.name}</div>
              <div className="p-meta">
                <span className={`pill ${row.enabled ? 'pill-ok' : 'pill-warn'}`}>{row.enabled ? '有効' : '無効'}</span>
              </div>
            </li>
          ))}
          {!loading && list.length === 0 && (
            <li className="hint">未登録。右上「+ 新規追加」から作成。</li>
          )}
        </ul>
      </aside>

      <section className="pattern-main">
        <div className="main-toolbar">
          <strong>認証情報</strong>
        </div>
        {error && <div className="error-box">{error}</div>}
        {draft === null ? (
          <div className="dashboard-empty">
            <div className="dashboard-hint">
              <h2>チャネル認証情報</h2>
              <p className="hint">左から既存設定を選ぶか、新規追加してください。</p>
            </div>
          </div>
        ) : (
          <div style={{ padding: '1rem' }}>
            <div className="pattern-form-head">
              <h2>{CHANNEL_LABELS[draft.channel]}</h2>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button className="btn-secondary" onClick={() => setDraft(null)}>キャンセル</button>
                <button className="btn-primary" onClick={saveDraft} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
                <button className="btn-secondary" onClick={removeDraft}>削除</button>
              </div>
            </div>

            <div className="form-row">
              <label>名前 (識別用、scheduled_messages.payload.credentialName で参照)</label>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>

            {/* token 単一フィールド (チャネル毎にラベル/プレースホルダだけ変える) */}
            {(() => {
              const t = TOKEN_LABEL[draft.channel] ?? { label: 'Token' }
              return (
                <div className="form-row">
                  <label>{t.label}{draft.channel !== 'web' && <span className="required"> *</span>}</label>
                  <input
                    type="password"
                    value={draft.values.token ?? ''}
                    placeholder={t.placeholder}
                    onChange={(e) => setDraft({ ...draft, values: { ...draft.values, token: e.target.value } })}
                  />
                  {t.hint && <small style={{ color: 'var(--fg-muted)' }}>{t.hint}</small>}
                </div>
              )
            })()}

            <div className="form-row">
              <label>有効</label>
              <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                送信に使う
              </label>
            </div>

            {isDiscord && (
              <section className="pattern-preview" style={{ marginTop: '1rem' }}>
                <h3>BOT 動作確認 — サーバ一覧取得</h3>
                <p className="hint">この token で見えるサーバ一覧を確認できます (chained dropdown はパターン側で利用)。</p>
                <button onClick={fetchGuilds} disabled={fetchingGuilds} className="btn-secondary">
                  {fetchingGuilds ? '取得中…' : 'サーバ一覧を取得'}
                </button>
                {guilds.length > 0 && (
                  <ul className="mention-list" style={{ marginTop: '0.6rem' }}>
                    {guilds.map((g) => (
                      <li key={g.id}>
                        <span className="mention-label">{g.name}</span>
                        <span className="mention-value">{g.id}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
