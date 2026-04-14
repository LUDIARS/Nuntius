import { useState, useEffect, useCallback } from 'react'
import { PatternsPage } from './pages/PatternsPage'
import { getProjectToken, setProjectToken, clearProjectToken, pingHealth } from './lib/api'

type Status = 'unknown' | 'ok' | 'auth_error' | 'network_error'

function TokenBar({ token, onChange, onLogout, status }: {
  token: string | null
  onChange: (t: string) => void
  onLogout: () => void
  status: Status
}) {
  const [draft, setDraft] = useState('')
  const statusLabel = {
    unknown: '未検証',
    ok: '接続 OK',
    auth_error: '認証エラー',
    network_error: '接続エラー',
  }[status]
  const statusClass = {
    unknown: 'pill pill-muted',
    ok: 'pill pill-ok',
    auth_error: 'pill pill-err',
    network_error: 'pill pill-warn',
  }[status]

  if (token) {
    return (
      <div className="token-bar">
        <span className={statusClass}>{statusLabel}</span>
        <code className="token-hint">token: ****{token.slice(-6)}</code>
        <button onClick={onLogout} className="btn-secondary">トークン変更</button>
      </div>
    )
  }

  return (
    <div className="token-bar">
      <input
        type="password"
        placeholder="Cernere project_token (Bearer)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ flex: 1, minWidth: 320 }}
      />
      <button onClick={() => draft && onChange(draft)} className="btn-primary">保存</button>
      <span className="hint">grant_type=project_credentials で取得した JWT を入力</span>
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState<string | null>(getProjectToken())
  const [status, setStatus] = useState<Status>('unknown')

  const refreshStatus = useCallback(async () => {
    if (!token) {
      setStatus('unknown')
      return
    }
    const r = await pingHealth(token)
    setStatus(r)
  }, [token])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  const handleTokenChange = (t: string) => {
    setProjectToken(t)
    setToken(t)
  }

  const handleLogout = () => {
    clearProjectToken()
    setToken(null)
    setStatus('unknown')
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Nuntius <span className="subtitle">通知パターン管理</span></h1>
        <TokenBar token={token} onChange={handleTokenChange} onLogout={handleLogout} status={status} />
      </header>
      <main className="app-main">
        {token ? (
          <PatternsPage token={token} onAuthError={() => setStatus('auth_error')} />
        ) : (
          <div className="empty-hint">
            <p>開始するには、Cernere で発行した <code>project_token</code> を上のバーに入力してください。</p>
            <pre className="code-block">{`curl -X POST $CERNERE_URL/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"grant_type":"project_credentials","client_id":"...","client_secret":"..."}'`}</pre>
          </div>
        )}
      </main>
    </div>
  )
}
