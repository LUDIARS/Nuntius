/**
 * Cernere Composite — ユーザー認証フロー (Nuntius admin UI 用)
 *
 * Cernere のポップアップ / 埋め込みログインで得た auth_code を
 * Cernere の /api/auth/exchange で accessToken / user 情報に交換し、
 * Nuntius 自身の service_token (HttpOnly Cookie) を発行する。
 *
 * 実装は Schedula の composite.ts と同一パターン。
 */

interface CernereUser {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

interface ExchangeResult {
  serviceToken: string;
  user: CernereUser;
}

const TOKEN_EXPIRES_IN_SECONDS = 3600; // 1 時間

let cernereUrl = "";
let jwtSecret = "";
let initialized = false;

/** Composite を初期化する (起動時に 1 回呼ぶ) */
export function initComposite(): void {
  cernereUrl = process.env.CERNERE_URL ?? "";
  jwtSecret = process.env.JWT_SECRET ?? "";

  if (!cernereUrl || !jwtSecret) {
    console.warn("[composite] Cernere Composite 設定が不完全です。埋め込みログインは無効化されます。");
    console.warn(`[composite]   CERNERE_URL: ${cernereUrl ? "設定済み" : "未設定"}`);
    console.warn(`[composite]   JWT_SECRET : ${jwtSecret ? "設定済み" : "未設定"}`);
    initialized = true;
    return;
  }

  console.log("[composite] Cernere Composite 初期化完了");
  initialized = true;
}

/** Cernere Composite ログイン URL を返す (デスクトップ popup モード用) */
export function getLoginUrl(origin: string): string | null {
  if (!cernereUrl) return null;
  return `${cernereUrl}/composite/login?origin=${encodeURIComponent(origin)}`;
}

/** auth_code を Cernere で交換し、service_token を発行する */
export async function exchangeAuthCode(authCode: string): Promise<ExchangeResult> {
  if (!cernereUrl) throw new Error("Cernere Composite is not configured");

  const res = await fetch(`${cernereUrl}/api/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: authCode }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cernere exchange failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    user: CernereUser;
  };

  const serviceToken = await issueServiceToken(data.user);
  return { serviceToken, user: data.user };
}

/** Composite が有効か */
export function isCompositeEnabled(): boolean {
  if (!initialized) initComposite();
  return !!cernereUrl && !!jwtSecret;
}

/** service_token (HS256 JWT) を発行する */
async function issueServiceToken(user: CernereUser): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    name: user.displayName,
    email: user.email,
    role: user.role,
    iat: now,
    exp: now + TOKEN_EXPIRES_IN_SECONDS,
    iss: "nuntius",
  };

  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const headerB64 = enc(header);
  const payloadB64 = enc(payload);
  const data = `${headerB64}.${payloadB64}`;

  const crypto = await import("node:crypto");
  const signature = crypto
    .createHmac("sha256", jwtSecret)
    .update(data)
    .digest("base64url");

  return `${data}.${signature}`;
}

export interface ServiceTokenPayload {
  sub: string;
  name: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
  iss: string;
}

/** service_token を検証し payload を返す (無効なら null) */
export async function verifyServiceToken(
  token: string,
): Promise<ServiceTokenPayload | null> {
  if (!jwtSecret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sig] = parts;
  const crypto = await import("node:crypto");
  const expected = crypto
    .createHmac("sha256", jwtSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  if (expected !== sig) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as ServiceTokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.iss !== "nuntius") return null;
    return payload;
  } catch {
    return null;
  }
}
