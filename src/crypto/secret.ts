/**
 * JSONB シークレット暗号化ユーティリティ (AES-256-GCM)
 *
 * 鍵は `NUNTIUS_ENCRYPTION_KEY` 環境変数 (base64 32byte, Infisical 管理) から読み込む。
 *
 * 保存エンベロープ (JSONB):
 *   { v: 1, iv: <base64>, ct: <base64>, tag: <base64> }
 *
 * v は将来の鍵ローテーション / アルゴリズム変更用のバージョン。
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;
const VERSION = 1;

export interface EncryptedEnvelope {
  v: number;
  iv: string;
  ct: string;
  tag: string;
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.NUNTIUS_ENCRYPTION_KEY ?? "";
  if (!raw) {
    throw new Error(
      "NUNTIUS_ENCRYPTION_KEY not set (required for channel_credentials encryption)",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(
      `NUNTIUS_ENCRYPTION_KEY must be ${KEY_LEN} bytes (base64), got ${key.length}`,
    );
  }
  cachedKey = key;
  return key;
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.v === "number" &&
    typeof v.iv === "string" &&
    typeof v.ct === "string" &&
    typeof v.tag === "string"
  );
}

export function encryptJson(plain: unknown): EncryptedEnvelope {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const plaintext = Buffer.from(JSON.stringify(plain), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: VERSION,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptJson<T = unknown>(envelope: EncryptedEnvelope): T {
  if (envelope.v !== VERSION) {
    throw new Error(`Unsupported encryption version: ${envelope.v}`);
  }
  const key = getKey();
  const iv = Buffer.from(envelope.iv, "base64");
  const ct = Buffer.from(envelope.ct, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
