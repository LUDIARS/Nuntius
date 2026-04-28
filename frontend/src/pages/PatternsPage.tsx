import { useState, useEffect, useCallback, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  CHANNELS, CHANNEL_LABELS,
  patternsApi, credentialsApi, discordApi,
  type Pattern, type PatternDraft, type TemplateVariable, type TemplateMention,
  type ChannelType, type DiscordMentionEntry,
  type ChannelCredentialRow, type DiscordGuildSummary, type DiscordChannelSummary,
} from '../lib/api'
import { useAuth, isAuthError } from '../contexts/AuthContext'

const EMPTY_DRAFT: PatternDraft = {
  name: '',
  description: '',
  channel: 'all',
  locale: 'ja',
  subject: '',
  body: '',
  variables: [],
  mentions: [],
  channelConfig: {},
}

export function PatternsPage() {
  const { markAuthError } = useAuth()
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PatternDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({})
  const [previewChannel, setPreviewChannel] = useState<ChannelType | ''>('')
  const [preview, setPreview] = useState<{ subject: string | null; body: string } | null>(null)
  // モバイル: list をオーバレイで開閉
  const [listOpen, setListOpen] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; httpStatus?: number; rendered: { subject: string | null; body: string } } | null>(null)

  const handleApiError = useCallback((err: unknown) => {
    if (isAuthError(err)) {
      markAuthError()
    }
    setError(err instanceof Error ? err.message : String(err))
  }, [markAuthError])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await patternsApi.list()
      setPatterns(r.templates)
    } catch (err) {
      handleApiError(err)
    } finally {
      setLoading(false)
    }
  }, [handleApiError])

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
      const p = await patternsApi.get(id)
      setDraft({
        name: p.name,
        description: p.description ?? '',
        channel: p.channel,
        locale: p.locale,
        subject: p.subject ?? '',
        body: p.body,
        variables: p.variables ?? [],
        mentions: p.mentions ?? [],
        channelConfig: p.channelConfig ?? {},
      })
      setPreviewChannel(p.channel === 'all' ? '' : p.channel)
      setPreviewValues({})
    } catch (err) {
      handleApiError(err)
    }
  }, [handleApiError])

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
        await patternsApi.update(selectedId, draft)
      } else {
        const r = await patternsApi.create(draft)
        setSelectedId(r.id)
      }
      await refresh()
    } catch (err) {
      handleApiError(err)
    } finally {
      setSaving(false)
    }
  }, [draft, selectedId, refresh, handleApiError])

  // ── 削除 ─────────────────────────────────────────
  const removeDraft = useCallback(async () => {
    if (!selectedId) return
    if (!confirm('このパターンを削除しますか？')) return
    try {
      await patternsApi.remove(selectedId)
      setSelectedId(null)
      setDraft(null)
      await refresh()
    } catch (err) {
      handleApiError(err)
    }
  }, [selectedId, refresh, handleApiError])

  // ── プレビュー ────────────────────────────────────
  const runPreview = useCallback(async () => {
    if (!selectedId) {
      setError('プレビューには保存済みパターンが必要です')
      return
    }
    try {
      const r = await patternsApi.render(selectedId, {
        values: previewValues,
        channel: previewChannel || undefined,
      })
      setPreview(r)
      setTestResult(null)
    } catch (err) {
      handleApiError(err)
    }
  }, [selectedId, previewValues, previewChannel, handleApiError])

  // ── テスト送信 ────────────────────────────────────
  const runTestSend = useCallback(async () => {
    if (!selectedId) {
      setError('テスト送信には保存済みパターンが必要です')
      return
    }
    setSendingTest(true); setError(null)
    try {
      const r = await patternsApi.testSend(selectedId, previewValues)
      setTestResult(r)
      setPreview(null)
    } catch (err) {
      handleApiError(err)
    } finally {
      setSendingTest(false)
    }
  }, [selectedId, previewValues, handleApiError])

  // (旧) mention サジェスト useEffect は廃止 — Discord は body @ picker で完結

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
    // mention key は role:NAME / user:NAME のように `:` を含むのでクラスに追加
    const re = /\{\{@([\w.:-]+)\}\}/g
    for (const src of [draft.subject ?? '', draft.body]) {
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) set.add(m[1])
    }
    return Array.from(set)
  }, [draft])

  const handleSelect = (id: string | null) => {
    selectPattern(id)
    setListOpen(false)  // モバイル: 選択後オーバレイ閉じる
  }

  return (
    <div className={`patterns-layout${listOpen ? ' list-open' : ''}`}>
      {/* モバイル: list オーバレイ用 backdrop */}
      {listOpen && <div className="list-backdrop" onClick={() => setListOpen(false)} />}

      <aside className="pattern-list">
        <div className="pattern-list-head">
          <strong>パターン ({patterns.length})</strong>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <button className="btn-primary" onClick={() => handleSelect(null)}>+ 新規</button>
            <button className="btn-secondary list-close" onClick={() => setListOpen(false)} title="閉じる">×</button>
          </div>
        </div>
        {loading && <div className="hint">読み込み中…</div>}
        <ul>
          {patterns.map((p) => (
            <li
              key={p.id}
              className={selectedId === p.id ? 'selected' : ''}
              onClick={() => handleSelect(p.id)}
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

      <section className="pattern-main">
        <div className="main-toolbar">
          <button className="btn-secondary list-toggle" onClick={() => setListOpen(true)} title="パターン一覧">
            ☰ パターン
          </button>
          <button className="btn-primary new-shortcut" onClick={() => handleSelect(null)}>+ 新規パターン</button>
        </div>

        {error && <div className="error-box">{error}</div>}

        {draft === null ? (
          <div className="dashboard-empty">
            <div className="dashboard-hint">
              <h2>通知パターン管理</h2>
              <p className="hint">パターンを選択するか、新規作成してください。</p>
              <button className="btn-primary big-cta" onClick={() => handleSelect(null)}>+ 新規パターンを作成</button>
            </div>
          </div>
        ) : (
          <>
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

      {/* テスト送信パネル: editor の下に縦並びで配置 */}
      <section className="pattern-preview">
        <h3>テスト</h3>
        <p className="hint">
          プレースホルダに値を入れて「テスト送信」を押すと、設定済みの送信先に実際の通知を送ります。
        </p>

        {extractedVars.length === 0 ? (
          <div className="hint">本文/件名にプレースホルダ <code>{'{{var}}'}</code> がありません。そのまま送信できます。</div>
        ) : (
          <div className="form-row">
            <label>プレースホルダ</label>
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

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button onClick={runTestSend} disabled={!selectedId || sendingTest} className="btn-primary">
            {sendingTest ? '送信中…' : 'テスト送信'}
          </button>
          <button onClick={runPreview} disabled={!selectedId} className="btn-secondary">
            描画プレビューだけ実行
          </button>
        </div>

        {testResult && (
          <div className={`preview-output ${testResult.success ? '' : 'error-box'}`} style={{ marginTop: '0.75rem' }}>
            <strong>{testResult.success ? '✓ 送信成功' : '✗ 送信失敗'}</strong>
            {testResult.error && <div>error: {testResult.error}</div>}
            {testResult.httpStatus && <div>HTTP {testResult.httpStatus}</div>}
            {testResult.rendered && (
              <>
                {testResult.rendered.subject !== null && <><small>subject</small><pre>{testResult.rendered.subject}</pre></>}
                <small>body</small><pre>{testResult.rendered.body}</pre>
              </>
            )}
          </div>
        )}

        {preview && !testResult && (
          <div className="preview-output">
            {preview.subject !== null && <div><small>subject</small><pre>{preview.subject}</pre></div>}
            <div><small>body</small><pre>{preview.body}</pre></div>
          </div>
        )}
      </section>
          </>
        )}
      </section>
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
  // Discord mention 自動取得 (server 選択時)
  const cfg = (draft.channelConfig ?? {}) as Record<string, string | undefined>
  const isBot = draft.channel === 'discord_bot'
  const credentialName = cfg.credentialName ?? 'default'
  const serverId = cfg.serverId
  const [discordMentions, setDiscordMentions] = useState<DiscordMentionEntry[]>([])

  // Discord 共通の built-in mention (@everyone / @here)。Discord (Webhook/BOT) ともに有効。
  const DISCORD_BUILTIN_MENTIONS: DiscordMentionEntry[] = useMemo(() => [
    { key: 'everyone', label: '@everyone (全員に通知)', value: '@everyone', type: 'role' },
    { key: 'here',     label: '@here (オンラインに通知)', value: '@here', type: 'role' },
  ], [])

  useEffect(() => {
    const isDiscord = draft.channel === 'discord' || draft.channel === 'discord_bot'
    if (!isDiscord) { setDiscordMentions([]); return }
    // BOT で server 選択済みなら API からも取得して結合
    if (isBot && serverId) {
      discordApi.fetchMentions({ channel: 'discord_bot', credentialName, serverId })
        .then((r) => setDiscordMentions([...DISCORD_BUILTIN_MENTIONS, ...r.entries]))
        .catch(() => setDiscordMentions([...DISCORD_BUILTIN_MENTIONS]))
    } else {
      // Webhook / server 未選択 BOT は built-in だけ
      setDiscordMentions([...DISCORD_BUILTIN_MENTIONS])
    }
  }, [draft.channel, isBot, credentialName, serverId, DISCORD_BUILTIN_MENTIONS])

  // body の `@` picker
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [picker, setPicker] = useState<{ query: string; caret: number } | null>(null)
  const [pickerIndex, setPickerIndex] = useState(0)

  const checkPicker = () => {
    const ta = bodyRef.current
    if (!ta) return
    const caret = ta.selectionStart ?? 0
    const before = draft.body.slice(0, caret)
    // 直前の token に `@` があるか (空白/改行 直後の @)
    const m = /(?:^|[\s\n])@([\w.:-]*)$/.exec(before) ?? /^@([\w.:-]*)$/.exec(before)
    if (m) setPicker({ query: m[1], caret })
    else setPicker(null)
  }

  const insertMention = (entry: DiscordMentionEntry) => {
    const ta = bodyRef.current
    if (!ta || !picker) return
    const before = draft.body.slice(0, picker.caret)
    const after = draft.body.slice(picker.caret)
    const replaced = before.replace(/@([\w.:-]*)$/, `{{@${entry.key}}}`)
    const newBody = replaced + after
    // mentions に未登録なら追加 (channelValues に discord_bot/discord 両方記載)
    const exists = draft.mentions.find((mm) => mm.key === entry.key)
    const newMentions = exists ? draft.mentions : [
      ...draft.mentions,
      { key: entry.key, label: entry.label, channelValues: { discord: entry.value, discord_bot: entry.value } },
    ]
    onChange({ ...draft, body: newBody, mentions: newMentions })
    setPicker(null)
    queueMicrotask(() => {
      const pos = replaced.length
      ta.focus(); ta.setSelectionRange(pos, pos)
    })
  }

  const filteredMentions = picker
    ? discordMentions.filter((m) => {
        const q = picker.query.toLowerCase()
        if (!q) return true
        return m.key.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)
      }).slice(0, 12)
    : []

  // フィルタ結果が変わったら highlight をリセット
  useEffect(() => { setPickerIndex(0) }, [picker?.query, filteredMentions.length])

  // textarea の keydown ハンドラ — picker open 時は ↑↓/Enter/Esc を picker に転送
  const onBodyKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!picker || filteredMentions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setPickerIndex((i) => (i + 1) % filteredMentions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setPickerIndex((i) => (i - 1 + filteredMentions.length) % filteredMentions.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const sel = filteredMentions[pickerIndex] ?? filteredMentions[0]
      if (sel) insertMention(sel)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setPicker(null)
    }
  }

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

      <CredentialPicker draft={draft} onChange={onChange} />

      <div className="form-row">
        <label>件名 (任意、メール等で利用)</label>
        <input
          type="text"
          value={draft.subject ?? ''}
          placeholder="例: {{name}} さんへのお知らせ"
          onChange={(e) => onChange({ ...draft, subject: e.target.value })}
        />
      </div>

      <div className="form-row" style={{ position: 'relative' }}>
        <label>本文 <span className="required">*</span></label>
        <textarea
          ref={bodyRef}
          value={draft.body}
          rows={8}
          placeholder="例: {{name}} さん、@alice さんから返信がありました: {{summary}}"
          onChange={(e) => { onChange({ ...draft, body: e.target.value }); setTimeout(checkPicker, 0) }}
          onClick={checkPicker}
          onKeyUp={(e) => {
            // picker open 時の ↑↓/Enter/Esc/Tab は keyDown で処理済 — keyUp ではトリガしない
            if (picker && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab')) return
            checkPicker()
          }}
          onKeyDown={onBodyKeyDown}
          onBlur={() => setTimeout(() => setPicker(null), 150)}
          required
        />
        {picker && filteredMentions.length > 0 && (
          <div className="mention-picker">
            {filteredMentions.map((m, idx) => (
              <button
                type="button"
                key={`${m.type}:${m.key}`}
                className={`mention-picker-item${idx === pickerIndex ? ' active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); insertMention(m) }}
                onMouseEnter={() => setPickerIndex(idx)}
              >
                <span className={`pill pill-${m.type === 'role' ? 'warn' : 'muted'}`}>{m.type}</span>
                <span style={{ flex: 1, marginLeft: '0.4rem' }}>{m.label}</span>
                <code style={{ fontSize: '0.7rem', color: 'var(--fg-muted)' }}>{m.key}</code>
              </button>
            ))}
          </div>
        )}
        <div className="hint">
          プレースホルダ: <code>{'{{var_name}}'}</code> / メンション: <code>@</code> 入力でサジェスト
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

      {/* メンション候補 UI は廃止 — body の `@` picker で自動管理。
          draft.mentions は内部で保持され続ける (送信時に解決される) */}
    </form>
  )
}

// ── 認証情報選択 + 連鎖プルダウン (Discord BOT) ──────

function CredentialPicker({ draft, onChange }: {
  draft: PatternDraft
  onChange: (d: PatternDraft) => void
}) {
  const [creds, setCreds] = useState<ChannelCredentialRow[]>([])
  const [guilds, setGuilds] = useState<DiscordGuildSummary[]>([])
  const [channels, setChannels] = useState<DiscordChannelSummary[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'guilds' | 'channels' | null>(null)
  const cfg = (draft.channelConfig ?? {}) as Record<string, string | undefined>

  // 複数フィールドを 1 アクションでまとめて更新する (連続 setField の closure race を防ぐ)
  const setFields = (updates: Record<string, string | undefined>) => {
    const next: Record<string, unknown> = { ...cfg }
    for (const [k, v] of Object.entries(updates)) {
      if (v === '' || v === undefined) delete next[k]
      else next[k] = v
    }
    onChange({ ...draft, channelConfig: next })
  }
  const setField = (key: string, value: string | undefined) => setFields({ [key]: value })

  // 全 credentials 取得 (有効分のみ)
  useEffect(() => {
    credentialsApi.list()
      .then((r) => setCreds(r.credentials.filter((c) => c.enabled)))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
  }, [])

  // 現在選択中の credential を { channel, name } で表現 (channel は draft.channel と同期)
  const selectedKey = `${draft.channel}::${cfg.credentialName ?? ''}`

  const onSelectCredential = (key: string) => {
    if (!key) {
      onChange({ ...draft, channel: 'all', channelConfig: {} })
      return
    }
    const [ch, name] = key.split('::')
    onChange({
      ...draft,
      channel: ch as ChannelType | 'all',
      channelConfig: { credentialName: name },
    })
    setGuilds([]); setChannels([])
  }

  const isBot = draft.channel === 'discord_bot'

  // BOT credential 選択時、サーバ一覧を fetch
  useEffect(() => {
    setLoadError(null)
    if (!isBot || !cfg.credentialName) { setGuilds([]); return }
    setBusy('guilds')
    discordApi.fetchGuilds({ channel: 'discord_bot', credentialName: cfg.credentialName })
      .then((r) => setGuilds(r.guilds))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null))
  }, [isBot, cfg.credentialName])

  // サーバ選択時、チャンネル一覧を fetch
  useEffect(() => {
    if (!isBot || !cfg.credentialName || !cfg.serverId) { setChannels([]); return }
    setBusy('channels')
    discordApi.fetchChannels({
      channel: 'discord_bot',
      credentialName: cfg.credentialName,
      serverId: cfg.serverId,
    })
      .then((r) => setChannels(r.channels))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null))
  }, [isBot, cfg.credentialName, cfg.serverId])

  return (
    <section className="sub-section">
      <div className="sub-section-head"><h3>送信先</h3></div>

      <div className="form-row">
        <label>認証情報</label>
        <select value={selectedKey === 'all::' ? '' : selectedKey} onChange={(e) => onSelectCredential(e.target.value)}>
          <option value="">— 選択してください —</option>
          {creds.map((c) => (
            <option key={`${c.channel}::${c.name}`} value={`${c.channel}::${c.name}`}>
              {CHANNEL_LABELS[c.channel]} / {c.name}
            </option>
          ))}
        </select>
        {creds.length === 0 && <small className="hint">認証情報が登録されていません — 「認証情報」タブで作成してください</small>}
      </div>

      {loadError && <div className="error-box" style={{ marginTop: '0.4rem' }}>{loadError}</div>}

      {isBot && cfg.credentialName && (
        <>
          <div className="form-row">
            <label>サーバ {busy === 'guilds' && <small className="hint">取得中…</small>}</label>
            <select
              value={cfg.serverId ?? ''}
              onChange={(e) => setFields({ serverId: e.target.value || undefined, channelId: undefined })}
              disabled={guilds.length === 0}
            >
              <option value="">— 選択 —</option>
              {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {!busy && cfg.credentialName && guilds.length === 0 && !loadError && (
              <small className="hint">BOT 招待先のサーバが見つかりません — token を確認するか、BOT を Discord サーバに招待してください</small>
            )}
          </div>

          <div className="form-row">
            <label>チャンネル {busy === 'channels' && <small className="hint">取得中…</small>}</label>
            <select
              value={cfg.channelId ?? ''}
              onChange={(e) => setField('channelId', e.target.value || undefined)}
              disabled={!cfg.serverId || channels.length === 0}
            >
              <option value="">— 選択 —</option>
              {channels.map((ch) => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}
            </select>
          </div>
        </>
      )}

      {/* Email など他チャネルの細かい設定は credential 選択後に出す */}
      {draft.channel === 'email' && cfg.credentialName && (
        <>
          <div className="form-row">
            <label>From (override)</label>
            <input value={cfg.from ?? ''} onChange={(e) => setField('from', e.target.value)} placeholder="noreply@example.com" />
          </div>
          <div className="form-row">
            <label>Reply-To</label>
            <input value={cfg.replyTo ?? ''} onChange={(e) => setField('replyTo', e.target.value)} placeholder="support@example.com" />
          </div>
        </>
      )}
    </section>
  )
}
