/**
 * メディア実体のストレージ層
 *
 * バックエンドは環境変数 `NUNTIUS_MEDIA_BACKEND` で切り替える:
 *   - "s3"    … LUDIARS 共有 MinIO / AWS S3 (本番既定)
 *   - "local" … ローカル FS (dev / 小規模)。 GET /media/:id で配信
 *   - "off"   … ホストアップロード無効。 URL passthrough のみ受け付ける
 *
 * storageKey は呼び出し側 (routes/media.ts) が決める。 本モジュールは
 * put / getBuffer / getSignedUrl / delete のみを提供する。
 */

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";

export type MediaBackend = "s3" | "local" | "off";

export interface MediaStorage {
  readonly backend: MediaBackend;
  put(storageKey: string, buf: Buffer, mimeType: string): Promise<void>;
  getBuffer(storageKey: string): Promise<Buffer>;
  /** 署名付き URL を返す。 local バックエンドなど対応しない場合は null。 */
  getSignedUrl(storageKey: string, ttlSec: number): Promise<string | null>;
  delete(storageKey: string): Promise<void>;
}

// ─── env ─────────────────────────────────────────────────────────────────────

export function mediaBackend(): MediaBackend {
  const v = (process.env.NUNTIUS_MEDIA_BACKEND ?? "off").toLowerCase();
  return v === "s3" || v === "local" ? v : "off";
}

/** GET /media/:id を組み立てるための公開ベース URL (末尾スラッシュ無し)。 */
export function mediaPublicBaseUrl(): string {
  return (process.env.NUNTIUS_MEDIA_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}

/** mediaId から安定した公開 URL を作る。 */
export function mediaPublicUrl(mediaId: string): string {
  const base = mediaPublicBaseUrl();
  return base ? `${base}/media/${mediaId}` : `/media/${mediaId}`;
}

// ─── Local backend ───────────────────────────────────────────────────────────

class LocalStorage implements MediaStorage {
  readonly backend = "local" as const;
  private readonly root: string;

  constructor() {
    this.root = resolvePath(process.env.NUNTIUS_MEDIA_LOCAL_DIR ?? "./data/media");
  }

  /** storageKey から FS パスを作る。 `..` などの脱出を防ぐ。 */
  private pathFor(storageKey: string): string {
    const safe = storageKey.replace(/\\/g, "/").replace(/\.{2,}/g, "");
    const full = resolvePath(join(this.root, safe));
    if (!full.startsWith(this.root)) {
      throw new Error("invalid storageKey (path traversal)");
    }
    return full;
  }

  async put(storageKey: string, buf: Buffer): Promise<void> {
    const p = this.pathFor(storageKey);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, buf);
  }

  async getBuffer(storageKey: string): Promise<Buffer> {
    return readFile(this.pathFor(storageKey));
  }

  async getSignedUrl(): Promise<string | null> {
    return null; // local は署名 URL を持たない。 GET /media/:id が直接配信する
  }

  async delete(storageKey: string): Promise<void> {
    await unlink(this.pathFor(storageKey)).catch(() => undefined);
  }
}

// ─── S3 / MinIO backend ──────────────────────────────────────────────────────

interface S3Deps {
  client: import("@aws-sdk/client-s3").S3Client;
  PutObjectCommand: typeof import("@aws-sdk/client-s3").PutObjectCommand;
  GetObjectCommand: typeof import("@aws-sdk/client-s3").GetObjectCommand;
  DeleteObjectCommand: typeof import("@aws-sdk/client-s3").DeleteObjectCommand;
  getSignedUrl: typeof import("@aws-sdk/s3-request-presigner").getSignedUrl;
}

class S3Storage implements MediaStorage {
  readonly backend = "s3" as const;
  private readonly bucket: string;
  private depsPromise: Promise<S3Deps> | null = null;

  constructor() {
    this.bucket = process.env.NUNTIUS_MEDIA_S3_BUCKET ?? "";
    if (!this.bucket) {
      throw new Error("NUNTIUS_MEDIA_S3_BUCKET is required when NUNTIUS_MEDIA_BACKEND=s3");
    }
  }

  private deps(): Promise<S3Deps> {
    if (!this.depsPromise) {
      this.depsPromise = (async () => {
        const s3 = await import("@aws-sdk/client-s3");
        const presigner = await import("@aws-sdk/s3-request-presigner");
        const endpoint = process.env.NUNTIUS_MEDIA_S3_ENDPOINT || undefined;
        const region = process.env.NUNTIUS_MEDIA_S3_REGION || "us-east-1";
        const accessKeyId = process.env.NUNTIUS_MEDIA_S3_ACCESS_KEY ?? "";
        const secretAccessKey = process.env.NUNTIUS_MEDIA_S3_SECRET_KEY ?? "";
        // MinIO は path-style 必須。 endpoint 指定時は基本 path-style にする。
        const forcePathStyle =
          (process.env.NUNTIUS_MEDIA_S3_FORCE_PATH_STYLE ?? (endpoint ? "true" : "false")) === "true";
        const client = new s3.S3Client({
          region,
          endpoint,
          forcePathStyle,
          credentials:
            accessKeyId && secretAccessKey
              ? { accessKeyId, secretAccessKey }
              : undefined,
        });
        return {
          client,
          PutObjectCommand: s3.PutObjectCommand,
          GetObjectCommand: s3.GetObjectCommand,
          DeleteObjectCommand: s3.DeleteObjectCommand,
          getSignedUrl: presigner.getSignedUrl,
        };
      })();
    }
    return this.depsPromise;
  }

  async put(storageKey: string, buf: Buffer, mimeType: string): Promise<void> {
    const d = await this.deps();
    await d.client.send(
      new d.PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: buf,
        ContentType: mimeType,
      }),
    );
  }

  async getBuffer(storageKey: string): Promise<Buffer> {
    const d = await this.deps();
    const res = await d.client.send(
      new d.GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
    const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) {
      throw new Error("S3 GetObject returned no body");
    }
    return Buffer.from(await body.transformToByteArray());
  }

  async getSignedUrl(storageKey: string, ttlSec: number): Promise<string | null> {
    const d = await this.deps();
    return d.getSignedUrl(
      d.client,
      new d.GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
      { expiresIn: ttlSec },
    );
  }

  async delete(storageKey: string): Promise<void> {
    const d = await this.deps();
    await d.client.send(
      new d.DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
  }
}

// ─── factory ─────────────────────────────────────────────────────────────────

let cached: MediaStorage | null = null;

/**
 * 設定されたバックエンドの MediaStorage を返す。
 * `off` のときは null (= ホストアップロード無効)。
 */
export function getMediaStorage(): MediaStorage | null {
  if (cached) return cached;
  const backend = mediaBackend();
  if (backend === "off") return null;
  cached = backend === "s3" ? new S3Storage() : new LocalStorage();
  return cached;
}

/** テスト用: キャッシュをクリア。 */
export function _resetMediaStorageCache(): void {
  cached = null;
}
