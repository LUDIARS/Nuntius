/**
 * フィールド暗号化 (AES-256-GCM) のユニットテスト
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  encryptField,
  decryptField,
  isEncrypted,
  _resetKeyCache,
} from "../src/auth/crypto.js";

const TEST_KEY = crypto.randomBytes(32).toString("base64");

describe("crypto (AES-256-GCM field encryption)", () => {
  beforeEach(() => {
    process.env.NUNTIUS_ENCRYPTION_KEY = TEST_KEY;
    _resetKeyCache();
  });

  afterEach(() => {
    delete process.env.NUNTIUS_ENCRYPTION_KEY;
    _resetKeyCache();
  });

  it("暗号化 → 復号で元の値が戻る", () => {
    const plain = "https://hooks.slack.com/services/T000/B000/XXXXXXXX";
    const ct = encryptField(plain);
    expect(ct).not.toBe(plain);
    expect(isEncrypted(ct)).toBe(true);
    expect(decryptField(ct)).toBe(plain);
  });

  it("同じ平文でも IV が違うため毎回異なる暗号文になる", () => {
    const plain = "secret-webhook-url";
    const a = encryptField(plain);
    const b = encryptField(plain);
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe(plain);
    expect(decryptField(b)).toBe(plain);
  });

  it("平文の値 (prefix なし) はそのまま透過で復号される (既存データ互換)", () => {
    const legacy = "legacy-plaintext-endpoint";
    expect(isEncrypted(legacy)).toBe(false);
    expect(decryptField(legacy)).toBe(legacy);
  });

  it("既に暗号化された値は encryptField で二重暗号化されない", () => {
    const plain = "abc";
    const once = encryptField(plain)!;
    const twice = encryptField(once);
    expect(twice).toBe(once);
  });

  it("null / undefined / 空文字は null を返す", () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(encryptField("")).toBeNull();
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
    expect(decryptField("")).toBeNull();
  });

  it("改竄された暗号文は復号失敗 (null) になる", () => {
    const plain = "sensitive-data";
    const ct = encryptField(plain)!;
    // tag (最後のセグメント) を破壊
    const parts = ct.split(":");
    parts[parts.length - 1] = Buffer.from("tampered").toString("base64url");
    const tampered = parts.join(":");
    expect(decryptField(tampered)).toBeNull();
  });

  it("鍵未設定でも平文を返す (dev fallback)、暗号化もスキップ", () => {
    delete process.env.NUNTIUS_ENCRYPTION_KEY;
    _resetKeyCache();
    const plain = "no-key-here";
    // 未設定なら encrypt もスキップして平文のまま
    expect(encryptField(plain)).toBe(plain);
    expect(decryptField(plain)).toBe(plain);
  });

  it("鍵長が 32 byte でない場合は例外", () => {
    process.env.NUNTIUS_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    _resetKeyCache();
    expect(() => encryptField("x")).toThrow(/32 byte/);
  });
});
