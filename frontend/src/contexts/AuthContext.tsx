import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { authApi, ApiError, type CurrentUser } from '../lib/api'

interface AuthContextType {
  user: CurrentUser | null
  loading: boolean
  /** email / password によるログイン。MFA が必要な場合は mfaRequired + mfaToken を返す */
  login: (email: string, password: string) => Promise<{ mfaRequired?: boolean; mfaToken?: string; mfaMethods?: string[] }>
  /** MFA コード確認 (login で mfaRequired=true が返った場合) */
  mfaVerify: (mfaToken: string, method: string, code: string) => Promise<void>
  /** Cernere popup でログイン (デスクトップ用) */
  loginWithPopup: () => Promise<void>
  /** Cookie を消してログアウト */
  logout: () => Promise<void>
  /** 認証エラー (401) を受けたときの強制ログアウト */
  markAuthError: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

async function completeAuthCode(authCode: string): Promise<CurrentUser> {
  const res = await authApi.exchange(authCode)
  return {
    id: res.user.id,
    name: res.user.displayName,
    email: res.user.email,
    role: res.user.role,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  // 初期化: Cookie で /me を叩いてセッション復元
  useEffect(() => {
    authApi.me()
      .then((me) => setUser(me))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password)
    if (res.mfaRequired) {
      return {
        mfaRequired: true,
        mfaToken: res.mfaToken,
        mfaMethods: res.mfaMethods,
      }
    }
    if (!res.authCode) throw new Error('Cernere did not return authCode')
    const u = await completeAuthCode(res.authCode)
    setUser(u)
    return {}
  }, [])

  const mfaVerify = useCallback(async (mfaToken: string, method: string, code: string) => {
    const res = await authApi.mfaVerify(mfaToken, method, code)
    if (!res.authCode) throw new Error('MFA verify did not return authCode')
    const u = await completeAuthCode(res.authCode)
    setUser(u)
  }, [])

  const loginWithPopup = useCallback(async () => {
    const origin = window.location.origin
    const { url } = await authApi.loginUrl(origin)
    if (!url) throw new Error('Cernere Composite is not configured on server')

    const width = 480
    const height = 640
    const left = Math.round(window.screenX + (window.innerWidth - width) / 2)
    const top = Math.round(window.screenY + (window.innerHeight - height) / 2)
    const popup = window.open(
      url,
      'cernere-login',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`,
    )
    if (!popup) throw new Error('Popup blocked. Please allow popups.')

    const authCode = await new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        window.removeEventListener('message', onMessage)
        clearInterval(pollTimer)
      }
      const onMessage = (evt: MessageEvent) => {
        const data = evt.data as { type?: string; authCode?: string; error?: string } | null
        if (!data || typeof data !== 'object') return
        if (data.type === 'cernere:auth' && data.authCode) {
          cleanup()
          popup.close()
          resolve(data.authCode)
        } else if (data.type === 'cernere:auth_error') {
          cleanup()
          popup.close()
          reject(new Error(data.error ?? 'Authentication failed'))
        }
      }
      const pollTimer = setInterval(() => {
        if (popup.closed) {
          cleanup()
          reject(new Error('Login popup was closed.'))
        }
      }, 500)
      window.addEventListener('message', onMessage)
    })

    const u = await completeAuthCode(authCode)
    setUser(u)
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // ignore network errors; still clear local state
    }
    setUser(null)
  }, [])

  const markAuthError = useCallback(() => {
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, loading, login, mfaVerify, loginWithPopup, logout, markAuthError }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

// eslint-disable-next-line react-refresh/only-export-components
export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403)
}
