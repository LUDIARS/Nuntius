import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Nuntius admin ログイン画面
 *
 * - 埋め込みログイン: Cernere に email/password を送る (同一 origin proxy 経由で CORS 回避)
 * - MFA が必要な場合は第二段階でコード入力
 * - デスクトップ向けに popup ログインも提供 (別ウィンドウで Cernere を開く)
 */
export function LoginPage() {
  const { login, mfaVerify, loginWithPopup } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // MFA state
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [mfaMethod, setMfaMethod] = useState('totp')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaMethods, setMfaMethods] = useState<string[]>(['totp'])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await login(email, password)
      if (r.mfaRequired && r.mfaToken) {
        setMfaToken(r.mfaToken)
        setMfaMethods(r.mfaMethods && r.mfaMethods.length > 0 ? r.mfaMethods : ['totp'])
        setMfaMethod(r.mfaMethods?.[0] ?? 'totp')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mfaToken) return
    setError('')
    setLoading(true)
    try {
      await mfaVerify(mfaToken, mfaMethod, mfaCode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handlePopup = async () => {
    setError('')
    setLoading(true)
    try {
      await loginWithPopup()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      if (msg !== 'Login popup was closed.') setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <h1>Nuntius</h1>
          <p className="subtitle">通知パターン管理 · Cernere 認証</p>
        </div>

        {error && <div className="error-box">{error}</div>}

        {mfaToken === null ? (
          <>
            <form onSubmit={handleLogin}>
              <div className="form-row">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="form-row">
                <label>パスワード</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <button type="submit" className="btn-primary login-btn" disabled={loading}>
                {loading ? '処理中…' : 'ログイン'}
              </button>
            </form>

            <div className="login-divider"><span>または</span></div>

            <button
              type="button"
              className="btn-secondary login-btn"
              onClick={handlePopup}
              disabled={loading}
            >
              Cernere ポップアップでログイン
            </button>
            <p className="hint" style={{ marginTop: '1rem', textAlign: 'center' }}>
              Cernere 認証基盤を使用しています
            </p>
          </>
        ) : (
          <form onSubmit={handleMfa}>
            <div className="form-row">
              <label>MFA メソッド</label>
              <select value={mfaMethod} onChange={(e) => setMfaMethod(e.target.value)}>
                {mfaMethods.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>MFA コード</label>
              <input
                type="text"
                inputMode="numeric"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                required
                autoFocus
              />
            </div>
            <button type="submit" className="btn-primary login-btn" disabled={loading}>
              {loading ? '検証中…' : '確認'}
            </button>
            <button
              type="button"
              className="btn-secondary login-btn"
              style={{ marginTop: '0.5rem' }}
              onClick={() => { setMfaToken(null); setMfaCode(''); setError('') }}
              disabled={loading}
            >
              戻る
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
