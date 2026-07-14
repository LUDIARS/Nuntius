/**
 * SSRF ガード
 *
 * Nuntius 側が「外部 URL を取得しに行く」経路 (native アップロード時の
 * バイナリ取得など) で、 内部 IP / メタデータエンドポイント / file: スキーム
 * 等への到達を防ぐ。
 *
 * 注意: DNS rebinding の完全な防御にはならない (解決済み IP で接続し直す
 * 必要がある)。 ここでは「明らかに内部宛て」を弾く一次防御として実装する。
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

/** プライベート / リンクローカル / ループバックの IPv4 か。 */
function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 127) return true;                      // 127.0.0.0/8 loopback
  if (a === 0) return true;                        // 0.0.0.0/8
  if (a === 169 && b === 254) return true;         // 169.254.0.0/16 link-local (AWS/GCP metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/** IPv6 のループバック / リンクローカル / ユニークローカルか。 */
function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:")) return true;          // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local fc00::/7
  if (h.startsWith("::ffff:")) {
    // IPv4-mapped
    return isPrivateIpv4(h.slice(7));
  }
  return false;
}

/**
 * 取得して良い URL かを検証する。 不可なら例外を投げる。
 * - http / https のみ許可
 * - 内部 IP / localhost / メタデータ EP を拒否
 */
export function assertSafeFetchUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw.slice(0, 80)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`unsupported URL scheme: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`blocked host: ${host}`);
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new Error(`blocked private address: ${host}`);
  }
  return u;
}

/** 例外を投げず boolean で返す版。 */
export function isSafeFetchUrl(raw: string): boolean {
  try {
    assertSafeFetchUrl(raw);
    return true;
  } catch {
    return false;
  }
}
