import { useState } from 'react'
import {
  CHANNELS, CHANNEL_LABELS,
  preferencesApi,
  ApiError,
  type ChannelType, type NotificationPreferences,
} from '../lib/api'

const ALL_CHANNELS: ChannelType[] = [...CHANNELS]

export function PreferencesPage() {
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pref, setPref] = useState<NotificationPreferences | null>(null)

  const load = async () => {
    if (!userId.trim()) return
    setLoading(true); setError(null); setInfo(null)
    try {
      const r = await preferencesApi.get(userId.trim())
      setPref({
        ...r.preferences,
        userId: r.preferences.userId ?? userId.trim(),
        channels: r.preferences.channels ?? [],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPref(null)
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (!pref) return
    setSaving(true); setError(null); setInfo(null)
    try {
      const r = await preferencesApi.save({
        userId: pref.userId,
        channels: pref.channels,
        lineUserId: pref.lineUserId ?? null,
        lineCredentialName: pref.lineCredentialName ?? null,
        slackUserId: pref.slackUserId ?? null,
        email: pref.email ?? null,
      })
      setInfo(`保存しました (${r.status})`)
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message} (HTTP ${err.status})` : String(err)
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const toggleChannel = (ch: ChannelType) => {
    if (!pref) return
    const next = pref.channels.includes(ch)
      ? pref.channels.filter((c) => c !== ch)
      : [...pref.channels, ch]
    setPref({ ...pref, channels: next })
  }

  const move = (ch: ChannelType, dir: -1 | 1) => {
    if (!pref) return
    const idx = pref.channels.indexOf(ch)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= pref.channels.length) return
    const next = [...pref.channels]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setPref({ ...pref, channels: next })
  }

  const enabled = pref?.channels ?? []
  const disabled = ALL_CHANNELS.filter((c) => !enabled.includes(c))

  return (
    <div className="page-pad">
      <h2>通知設定</h2>
      <p className="hint">
        ユーザの <code>channels</code> 優先順位 / LINE / Slack / Email を編集します。
        <code>/api/notify/user</code> はこの設定を引いて配信先 channel を選びます。
      </p>

      <section className="card">
        <div className="row">
          <label>
            ユーザ ID (Cernere users.id)
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="UUID"
              onKeyDown={(e) => { if (e.key === 'Enter') load() }}
            />
          </label>
          <button className="btn-primary" onClick={load} disabled={loading || !userId.trim()}>
            {loading ? '読み込み中…' : '読み込み'}
          </button>
        </div>
      </section>

      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-ok">{info}</div>}

      {pref && (
        <>
          <section className="card">
            <h3>配信 channel と優先順位</h3>
            <p className="hint">先頭の channel から試行され、 endpoint がある最初を採用します。</p>

            {enabled.length === 0 && <p className="empty-hint">優先 channel が未設定です (デフォルト: webpush → line → web)</p>}

            <ol className="channel-order">
              {enabled.map((ch, i) => (
                <li key={ch}>
                  <span className="channel-rank">#{i + 1}</span>
                  <span className="channel-name">{CHANNEL_LABELS[ch]}</span>
                  <button type="button" onClick={() => move(ch, -1)} disabled={i === 0}>↑</button>
                  <button type="button" onClick={() => move(ch, 1)} disabled={i === enabled.length - 1}>↓</button>
                  <button type="button" className="btn-danger" onClick={() => toggleChannel(ch)}>外す</button>
                </li>
              ))}
            </ol>

            {disabled.length > 0 && (
              <div className="channel-add">
                <span className="hint">追加:</span>
                {disabled.map((ch) => (
                  <button type="button" key={ch} className="btn-secondary" onClick={() => toggleChannel(ch)}>
                    + {CHANNEL_LABELS[ch]}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <h3>各 channel の宛先</h3>

            <label>
              LINE userId
              <input
                value={pref.lineUserId ?? ''}
                onChange={(e) => setPref({ ...pref, lineUserId: e.target.value || null })}
                placeholder="U..."
              />
            </label>

            <label>
              LINE credentialName
              <input
                value={pref.lineCredentialName ?? ''}
                onChange={(e) => setPref({ ...pref, lineCredentialName: e.target.value || null })}
                placeholder="default"
              />
            </label>

            <label>
              Slack userId
              <input
                value={pref.slackUserId ?? ''}
                onChange={(e) => setPref({ ...pref, slackUserId: e.target.value || null })}
                placeholder="U..."
              />
            </label>

            <label>
              Email
              <input
                type="email"
                value={pref.email ?? ''}
                onChange={(e) => setPref({ ...pref, email: e.target.value || null })}
                placeholder="user@example.com"
              />
            </label>

            <p className="hint">
              WebPush は別途このユーザがブラウザで購読登録 (<code>POST /api/push/subscriptions</code>) する必要があります。
              ここでは設定しません。
            </p>
          </section>

          <div className="row">
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
