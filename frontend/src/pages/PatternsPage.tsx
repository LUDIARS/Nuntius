import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  CHANNELS, CHANNEL_LABELS,
  patternsApi, ApiError,
  type Pattern, type PatternDraft, type TemplateVariable, type TemplateMention,
  type ChannelType, type MentionSuggestion,
} from '../lib/api'

const EMPTY_DRAFT: PatternDraft = {
  name: '',
  description: '',
  channel: 'all',
  locale: 'ja',
  subject: '',
  body: '',
  variables: [],
  mentions: [],
}

export function PatternsPage({ token, onAuthError }: {
  token: string
  onAuthError: () => void
}) {
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PatternDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({})
  const [previewChannel, setPreviewChannel] = useState<ChannelType | ''>('')
  const [preview, setPreview] = useState<{ subject: string | null; body: string } | null>(null)
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([])

  const handleApiError = useCallback((err: unknown) => {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      onAuthError()
    }
    setError(err instanceof Error ? err.message : String(err))
  }, [onAuthError])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await patternsApi.list(token)
      setPatterns(r.templates)
    } catch (err) {
      handleApiError(err)
    } finally {
      setLoading(false)
    }
  }, [token, handleApiError])

  useEffect(() => { refresh() }, [refresh])

  // ── 選択 ─────────────────────────────────────────
  const selectPattern = useCallback(async (id: string | null) => {
    setError(null)
    setPreview(null)
    setSelectedId(id)
    if (id === null) {
      setDraft({ ...EMPTY_DRAFT })
      setPreviewChannel('')
      setPreviewValues({})
      return
    }
    try {
      const p = await patternsApi.get(token, id)
      setDraft({
        name: p.name,
        description: p.description ?? '',
        channel: p.channel,
        locale: p.locale,
        subject: p.subject ?? '',
        body: p.body,
        variables: p.variables ?? [],
        mentions: p.mentions ?? [],
      })
      setPreviewChannel(p.channel === 'all' ? '' : p.channel)
      setPreviewValues({})
    } catch (err) {
      handleApiError(err)
    }
  }, [token, handleApiError])

  // ── 保存 ─────────────────────────────────────────
  const saveDraft = useCallback(async () => {
    if (!draft) return
    if (!draft.name || !draft.body) {
      setError('name と body は必須です')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (selectedId) {
        await patternsApi.update(token, selectedId, draft)
      } else {
        const r = await patternsApi.create(token, draft)
        setSelectedId(r.id)
      }
      await refresh()
    } catch (err) {
      handleApiError(err)
    } finally {
      setSaving(false)
    }
  }, [draft, selectedId, token, refresh, handleApiError])

  // ── 削除 ─────────────────────────────────────────
  const removeDraft = useCallback(async () => {
    if (!selectedId) return
    if (!confirm('このパターンを削除しますか？')) return
    try {
      await patternsApi.remove(token, selectedId)
      setSelectedId(null)
      setDraft(null)
      await refresh()
    } catch (err) {
      handleApiError(err)
    }
  }, [selectedId, token, refresh, handleApiError])

  // ── プレビュー ────────────────────────────────────
  const runPreview = useCallback(async () => {
    if (!selectedId) {
      setError('プレビューには保存済みパターンが必要です')
      return
    }
    try {
      const r = await patternsApi.render(token, selectedId, {
        values: previewValues,
        channel: previewChannel || undefined,
      })
      setPreview(r)
    } catch (err) {
      handleApiError(err)
    }
  }, [selectedId, token, previewValues, previewChannel, handleApiError])

  // ── mention サジェスト ───────────────────────────
  useEffect(() => {
    if (!previewChannel && !draft) { setSuggestions([]); return }
    const channel = previewChannel || (draft?.channel && draft.channel !== 'all' ? draft.channel : undefined)
    patternsApi.mentionSuggestions(token, channel)
      .then((r) => setSuggestions(r.mentions))
      .catch(() => setSuggestions([]))
  }, [token, previewChannel, draft])

  // ── 変数自動抽出 (body から {{var}} を拾う) ─────
  const extractedVars = useMemo(() => {
    if (!draft) return []
    const set = new Set<string>()
    const re = /\{\{(\w+)\}\}/g
    for (const src of [draft.subject ?? '', draft.body]) {
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) set.add(m[1])
    }
    return Array.from(set)
  }, [draft])

  const extractedMentionKeys = useMemo(() => {
    if (!draft) return []
    const set = new Set<string>()
    const re = /\{\{@([\w.-]+)\}\}/g
    for (const src of [draft.subject ?? '', draft.body]) {
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) set.add(m[1])
    }
    return Array.from(set)
  }, [draft])

  return (
    <div className="patterns-layout">
      <aside className="pattern-list">
        <div className="pattern-list-head">
          <strong>パターン ({patterns.length})</strong>
          <button className="btn-primary" onClick={() => selectPattern(null)}>+ 新規</button>
        </div>
        {loading && <div className="hint">読み込み中…</div>}
        <ul>
          {patterns.map((p) => (
            <li
              key={p.id}
              className={selectedId === p.id ? 'selected' : ''}
              onClick={() => selectPattern(p.id)}
            >
              <div className="p-name">{p.name}</div>
              <div className="p-meta">
                <span className="pill pill-muted">{CHANNEL_LABELS[p.channel]}</span>
                <span className="pill pill-muted">{p.locale}</span>
              </div>
            </li>
          ))}
          {!loading && patterns.length === 0 && (
            <li className="hint">パターン未登録。右上の「+ 新規」から追加してください。</li>
          )}
        </ul>
      </aside>

      <section className="pattern-editor">
        {error && <div className="error-box">{error}</div>}
        {draft === null ? (
          <div className="empty-hint">左の一覧からパターンを選択するか、+ 新規 を押してください。</div>
        ) : (
          <PatternForm
            draft={draft}
            onChange={setDraft}
            isNew={selectedId === null}
            onSave={saveDraft}
            onDelete={removeDraft}
            saving={saving}
            extractedVars={extractedVars}
            extractedMentionKeys={extractedMentionKeys}
          />
        )}
      </section>

      <aside className="pattern-preview">
        <h3>プレビュー / mention サジェスト</h3>
        <div className="form-row">
          <label>チャネル</label>
          <select
            value={previewChannel}
            onChange={(e) => setPreviewChannel(e.target.value as ChannelType | '')}
          >
            <option value="">(未指定)</option>
            {CHANNELS.map((ch) => (
              <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>
            ))}
          </select>
        </div>

        {extractedVars.length > 0 && (
          <div className="form-row">
            <label>テスト値</label>
            <div className="var-inputs">
              {extractedVars.map((v) => (
                <label key={v} className="var-input">
                  <span>{v}</span>
                  <input
                    type="text"
                    value={previewValues[v] ?? ''}
                    onChange={(e) => setPreviewValues({ ...previewValues, [v]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <button onClick={runPreview} disabled={!selectedId} className="btn-primary">
          レンダー実行
        </button>
        {preview && (
          <div className="preview-output">
            {preview.subject !== null && (
              <div>
                <small>subject</small>
                <pre>{preview.subject}</pre>
              </div>
            )}
            <div>
              <small>body</small>
              <pre>{preview.body}</pre>
            </div>
          </div>
        )}

        <h3 style={{ marginTop: '1.5rem' }}>使える mention ({suggestions.length})</h3>
        <ul className="mention-list">
          {suggestions.map((m) => (
            <li key={m.key}>
              <code>{`{{@${m.key}}}`}</code>
              <span className="mention-label">{m.label}</span>
              <span className="mention-value">→ {m.value}</span>
            </li>
          ))}
          {suggestions.length === 0 && <li className="hint">他のパターンに mention が定義されていません</li>}
        </ul>
      </aside>
    </div>
  )
}

// ── 編集フォーム ─────────────────────────────────────

function PatternForm({ draft, onChange, isNew, onSave, onDelete, saving, extractedVars, extractedMentionKeys }: {
  draft: PatternDraft
  onChange: (d: PatternDraft) => void
  isNew: boolean
  onSave: () => void
  onDelete: () => void
  saving: boolean
  extractedVars: string[]
  extractedMentionKeys: string[]
}) {
  const addVariable = () => {
    onChange({
      ...draft,
      variables: [...draft.variables, { name: '', required: false }],
    })
  }
  const updateVariable = (i: number, v: TemplateVariable) => {
    const next = [...draft.variables]
    next[i] = v
    onChange({ ...draft, variables: next })
  }
  const removeVariable = (i: number) => {
    onChange({ ...draft, variables: draft.variables.filter((_, idx) => idx !== i) })
  }

  const addMention = () => {
    onChange({
      ...draft,
      mentions: [...draft.mentions, { key: '', label: '', channelValues: {} }],
    })
  }
  const updateMention = (i: number, m: TemplateMention) => {
    const next = [...draft.mentions]
    next[i] = m
    onChange({ ...draft, mentions: next })
  }
  const removeMention = (i: number) => {
    onChange({ ...draft, mentions: draft.mentions.filter((_, idx) => idx !== i) })
  }

  const varNames = new Set(draft.variables.map((v) => v.name))
  const missingVars = extractedVars.filter((v) => !varNames.has(v))
  const mentionKeys = new Set(draft.mentions.map((m) => m.key))
  const missingMentionKeys = extractedMentionKeys.filter((k) => !mentionKeys.has(k))

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave() }} className="pattern-form">
      <div className="pattern-form-head">
        <h2>{isNew ? '新規パターン' : `編集: ${draft.name}`}</h2>
        <div>
          {!isNew && (
            <button type="button" onClick={onDelete} className="btn-danger" disabled={saving}>
              削除
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? '保存中…' : (isNew ? '作成' : '保存')}
          </button>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>パターン名 <span className="required">*</span></label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            required
          />
        </div>

        <div className="form-row">
          <label>説明 (管理用)</label>
          <input
            type="text"
            value={draft.description ?? ''}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
          />
        </div>

        <div className="form-row">
          <label>チャネル</label>
          <select
            value={draft.channel}
            onChange={(e) => onChange({ ...draft, channel: e.target.value as ChannelType | 'all' })}
          >
            <option value="all">{CHANNEL_LABELS.all}</option>
            {CHANNELS.map((ch) => (
              <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label>言語</label>
          <select
            value={draft.locale}
            onChange={(e) => onChange({ ...draft, locale: e.target.value })}
          >
            <option value="ja">ja</option>
            <option value="en">en</option>
            <option value="zh">zh</option>
          </select>
        </div>
      </div>

      <div className="form-row">
        <label>件名 (任意、メール等で利用)</label>
        <input
          type="text"
          value={draft.subject ?? ''}
          placeholder="例: {{name}} さんへのお知らせ"
          onChange={(e) => onChange({ ...draft, subject: e.target.value })}
        />
      </div>

      <div className="form-row">
        <label>本文 <span className="required">*</span></label>
        <textarea
          value={draft.body}
          rows={8}
          placeholder="例: {{name}} さん、{{@alice}} さんから返信がありました: {{summary}}"
          onChange={(e) => onChange({ ...draft, body: e.target.value })}
          required
        />
        <div className="hint">
          プレースホルダ: <code>{'{{var_name}}'}</code> / メンション: <code>{'{{@key}}'}</code>
        </div>
      </div>

      {/* ── variables ────────────────────────────── */}
      <section className="sub-section">
        <div className="sub-section-head">
          <h3>プレースホルダ定義 ({draft.variables.length})</h3>
          <button type="button" className="btn-secondary" onClick={addVariable}>+ 追加</button>
        </div>
        {missingVars.length > 0 && (
          <div className="hint warn">
            本文/件名で使われているが未定義: {missingVars.map((v, i) => (
              <span key={v}>{i > 0 && ' '}<code>{`{{${v}}}`}</code></span>
            ))}
          </div>
        )}
        <table className="var-table">
          <thead>
            <tr><th>name</th><th>label</th><th>example</th><th>required</th><th></th></tr>
          </thead>
          <tbody>
            {draft.variables.map((v, i) => (
              <tr key={i}>
                <td><input value={v.name} placeholder="name" onChange={(e) => updateVariable(i, { ...v, name: e.target.value })} /></td>
                <td><input value={v.label ?? ''} placeholder="(表示名)" onChange={(e) => updateVariable(i, { ...v, label: e.target.value })} /></td>
                <td><input value={v.example ?? ''} placeholder="(サンプル値)" onChange={(e) => updateVariable(i, { ...v, example: e.target.value })} /></td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={!!v.required} onChange={(e) => updateVariable(i, { ...v, required: e.target.checked })} />
                </td>
                <td><button type="button" className="btn-danger-sm" onClick={() => removeVariable(i)}>×</button></td>
              </tr>
            ))}
            {draft.variables.length === 0 && (
              <tr><td colSpan={5} className="hint">未定義。「+ 追加」で定義するとサジェストが効きます。</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ── mentions ─────────────────────────────── */}
      <section className="sub-section">
        <div className="sub-section-head">
          <h3>メンション候補 ({draft.mentions.length})</h3>
          <button type="button" className="btn-secondary" onClick={addMention}>+ 追加</button>
        </div>
        {missingMentionKeys.length > 0 && (
          <div className="hint warn">
            本文/件名で使われているが未定義: {missingMentionKeys.map((k) => `{{@${k}}}`).join(', ')}
          </div>
        )}
        <div className="mention-table">
          {draft.mentions.map((m, i) => (
            <div key={i} className="mention-row">
              <div className="mention-basic">
                <label>
                  <span>key</span>
                  <input value={m.key} placeholder="alice" onChange={(e) => updateMention(i, { ...m, key: e.target.value })} />
                </label>
                <label>
                  <span>label</span>
                  <input value={m.label} placeholder="Alice (山田)" onChange={(e) => updateMention(i, { ...m, label: e.target.value })} />
                </label>
                <button type="button" className="btn-danger-sm" onClick={() => removeMention(i)}>×</button>
              </div>
              <div className="mention-channel-values">
                {CHANNELS.map((ch) => (
                  <label key={ch}>
                    <span>{CHANNEL_LABELS[ch]}</span>
                    <input
                      value={m.channelValues?.[ch] ?? ''}
                      placeholder={ch === 'slack' ? '<@U01234>' : ch === 'discord' ? '<@999>' : ch === 'line' ? '@user' : ''}
                      onChange={(e) => {
                        const cv = { ...(m.channelValues ?? {}) }
                        if (e.target.value) cv[ch] = e.target.value
                        else delete cv[ch]
                        updateMention(i, { ...m, channelValues: cv })
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          {draft.mentions.length === 0 && (
            <div className="hint">メンション未定義。「+ 追加」で追加するとチャネル別に解決されます。</div>
          )}
        </div>
      </section>
    </form>
  )
}
