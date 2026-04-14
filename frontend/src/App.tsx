import { PatternsPage } from './pages/PatternsPage'
import { LoginPage } from './pages/LoginPage'
import { AuthProvider, useAuth } from './contexts/AuthContext'

function Shell() {
  const { user, loading, logout } = useAuth()

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
          Nuntius <span className="subtitle">通知パターン管理</span>
        </h1>
        <div className="token-bar">
          <span className="pill pill-ok">{user.role}</span>
          <span className="hint">{user.name || user.email}</span>
          <button className="btn-secondary" onClick={logout}>ログアウト</button>
        </div>
      </header>
      <main className="app-main">
        <PatternsPage />
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
