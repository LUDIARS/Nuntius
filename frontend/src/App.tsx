import { useState } from 'react'
import { PatternsPage } from './pages/PatternsPage'
import { CredentialsPage } from './pages/CredentialsPage'
import { LoginPage } from './pages/LoginPage'
import { AuthProvider, useAuth } from './contexts/AuthContext'

type Tab = 'patterns' | 'credentials'

function Shell() {
  const { user, loading, logout } = useAuth()
  const [tab, setTab] = useState<Tab>('patterns')

  if (loading) {
    return <div className="empty-hint">読み込み中…</div>
  }

  if (!user) {
    return <LoginPage />
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>
          Nuntius <span className="subtitle">通知基盤</span>
        </h1>
        <nav className="app-nav">
          <button
            className={`nav-tab${tab === 'patterns' ? ' active' : ''}`}
            onClick={() => setTab('patterns')}
          >
            パターン
          </button>
          <button
            className={`nav-tab${tab === 'credentials' ? ' active' : ''}`}
            onClick={() => setTab('credentials')}
          >
            認証情報
          </button>
        </nav>
        <div className="token-bar">
          <span className="pill pill-ok">{user.role}</span>
          <span className="hint">{user.name || user.email}</span>
          <button className="btn-secondary" onClick={logout}>ログアウト</button>
        </div>
      </header>
      <main className="app-main">
        {tab === 'patterns' && <PatternsPage />}
        {tab === 'credentials' && <CredentialsPage />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
