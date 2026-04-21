/**
 * フィールド暗号化 (AES-256-GCM)
 *
 * Slack Incoming Webhook URL 等、チャネル認証情報を内包する値を DB に保存する前に
 * アプリ層で暗号化する。鍵は環境変数 `NUNTIUS_ENCRYPTION_KEY` (base64 エンコードされた 32 byte)。
 *
 *   保存形式: `enc:v1:<iv_b64url>:<ct_b64url>:<tag_b64url>`
 *
 * 復号時に `enc:v1:` prefix が無い値は平文として扱い、そのまま返す
 * (既存データ互換のため)。鍵が未設定なら暗号化をスキップし、起動時に warning を出す。
 */

import crypto from "node:crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

let cachedKey: Buffer | null | undefined = undefined;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.NUNTIUS_ENCRYPTION_KEY ?? "";
  if (!raw) {
    console.warn(
      "[crypto] NUNTIUS_ENCRYPTION_KEY 未設定: topic_subscriptions.endpoint は平文保存されます。"
      + " 本番環境では 32 byte の鍵 (base64) を必ず設定してください。",
    );
    cachedKey = null;
    return null;
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("[crypto] NUNTIUS_ENCRYPTION_KEY は base64 エンコード必須");
  }
  if (key.length !== KEY_LEN) {
    throw new Error(
      `[crypto] NUNTIUS_ENCRYPTION_KEY は 32 byte (base64 デコード後) 必須。実際: ${key.length} byte`,
    );
  }
  cachedKey = key;
  return key;
}

/** テスト等で鍵キャッシュをリセット */
export function _resetKeyCache(): void {
  cachedKey = undefined;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * 平文を暗号化。鍵が未設定なら平文のまま返す (dev 時のみ許容)。
 * 既に暗号化されている値はそのまま返す。
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  if (isEncrypted(plaintext)) return plaintext;

  const key = loadKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${ct.toString("base64url")}:${tag.toString("base64url")}`;
}

/**
 * 暗号化された値を復号。prefix が無ければ平文として透過で返す (既存データ互換)。
 * 鍵未設定 / 形式不正 / 改竄検知時は null を返す。
 */
export function decryptField(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!isEncrypted(stored)) return stored;

  const key = loadKey();
  if (!key) {
    console.error("[crypto] 暗号化データを発見しましたが NUNTIUS_ENCRYPTION_KEY 未設定のため復号できません");
    return null;
  }

  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], "base64url");
    const ct = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch (err) {
    console.error("[crypto] 復号失敗:", err);
    return null;
  }
}
