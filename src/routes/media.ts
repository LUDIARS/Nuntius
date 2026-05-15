/**
 * /api/media — メディア実体のアップロード / 管理 + /media/:id 公開配信
 *
 * POST   /api/media       — multipart アップロード (project token 必須)
 *                           field: file (必須), kind (必須), userId?, ttlSec?
 *                           → { mediaId, url, kind, mimeType, size, expiresAt }
 * GET    /api/media/:id   — メタ情報取得 (project スコープ)
 * DELETE /api/media/:id   — 削除 (storage 実体 + 行、 project スコープ)
 *
 * GET    /media/:id       — 公開配信 (認証不要)。 LINE / Slack / Discord 等の
 *                           プラットフォームが originalContentUrl として取得する。
 *                           s3 backend は署名 URL に 302、 local backend は直接配信。
 *                           id は推測困難な UUID。
 */

import { Hono } from "hono";
import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/connection.js";
import { getProjectKey, getUserId } from "../middleware/auth.js";
import { isMediaKind, defaultMime } from "../media/attachment.js";
import { validateUpload } from "../media/limits.js";
import { getMediaStorage, mediaPublicUrl } from "../media/storage.js";

export const mediaRoutes = new Hono();
export const mediaPublicRoutes = new Hono();

const SIGNED_URL_TTL_SEC = 600; // s3 backend の GET /media/:id リダイレクト用

function defaultTtlSec(): number {
  const raw = Number(process.env.NUNTIUS_MEDIA_DEFAULT_TTL_SEC ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

// ─── POST /api/media ─────────────────────────────────────────────────────────

mediaRoutes.post("/", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const storage = getMediaStorage();
  if (!storage) {
    return c.json(
      { error: "media hosting disabled (set NUNTIUS_MEDIA_BACKEND=s3|local)" },
      503,
    );
  }

  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch {
    return c.json({ error: "multipart/form-data body required" }, 400);
  }

  const file = form.file;
  if (!(file instanceof File)) {
    return c.json({ error: "'file' field (multipart) is required" }, 400);
  }
  const kind = form.kind;
  if (!isMediaKind(kind)) {
    return c.json({ error: "'kind' must be one of image|video|audio|file" }, 400);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mimeType = (file.type || "").trim() || defaultMime(kind);
  const fileName = file.name || undefined;

  const validationError = validateUpload(kind, mimeType, buf.length);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const sha256 = createHash("sha256").update(buf).digest("hex");

  // 重複排除: 同一 project で同一 sha256 の未期限切れ資産があれば再利用
  const dup = await db
    .select()
    .from(schema.mediaAssets)
    .where(
      and(
        eq(schema.mediaAssets.projectKey, projectKey),
        eq(schema.mediaAssets.sha256, sha256),
      ),
    )
    .limit(1);
  const existing = dup[0];
  if (existing && (!existing.expiresAt || existing.expiresAt.getTime() > Date.now())) {
    return c.json({
      mediaId: existing.id,
      url: mediaPublicUrl(existing.id),
      kind: existing.kind,
      mimeType: existing.mimeType,
      size: existing.size,
      expiresAt: existing.expiresAt?.toISOString() ?? null,
      deduplicated: true,
    });
  }

  const id = randomUUID();
  const storageKey = `media/${projectKey}/${id}`;
  await storage.put(storageKey, buf, mimeType);

  const ttlBody = Number(form.ttlSec ?? "");
  const ttlSec = Number.isFinite(ttlBody) && ttlBody > 0 ? ttlBody : defaultTtlSec();
  const expiresAt = ttlSec > 0 ? new Date(Date.now() + ttlSec * 1000) : null;
  const uploaderUserId =
    (typeof form.userId === "string" && form.userId) || getUserId(c) || null;

  await db.insert(schema.mediaAssets).values({
    id,
    projectKey,
    userId: uploaderUserId,
    kind,
    mimeType,
    fileName: fileName ?? null,
    size: buf.length,
    storageBackend: storage.backend,
    storageKey,
    sha256,
    expiresAt,
  });

  return c.json(
    {
      mediaId: id,
      url: mediaPublicUrl(id),
      kind,
      mimeType,
      size: buf.length,
      fileName: fileName ?? null,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
    201,
  );
});

// ─── GET /api/media/:id (メタ取得) ───────────────────────────────────────────

mediaRoutes.get("/:id", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const id = c.req.param("id");
  const rows = await db
    .select()
    .from(schema.mediaAssets)
    .where(
      and(eq(schema.mediaAssets.id, id), eq(schema.mediaAssets.projectKey, projectKey)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "media not found" }, 404);

  return c.json({
    mediaId: row.id,
    url: mediaPublicUrl(row.id),
    kind: row.kind,
    mimeType: row.mimeType,
    fileName: row.fileName,
    size: row.size,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
});

// ─── DELETE /api/media/:id ───────────────────────────────────────────────────

mediaRoutes.delete("/:id", async (c) => {
  const projectKey = getProjectKey(c);
  if (!projectKey) return c.json({ error: "Project token required" }, 401);

  const id = c.req.param("id");
  const rows = await db
    .select()
    .from(schema.mediaAssets)
    .where(
      and(eq(schema.mediaAssets.id, id), eq(schema.mediaAssets.projectKey, projectKey)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "media not found" }, 404);

  const storage = getMediaStorage();
  if (storage && storage.backend === row.storageBackend) {
    await storage.delete(row.storageKey).catch((err) => {
      console.warn(`[media] storage delete failed (id=${id}):`, err);
    });
  }
  await db.delete(schema.mediaAssets).where(eq(schema.mediaAssets.id, id));
  return c.json({ id, deleted: true });
});

// ─── GET /media/:id (公開配信、 認証不要) ────────────────────────────────────

mediaPublicRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const rows = await db
    .select()
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "media not found" }, 404);
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return c.json({ error: "media expired" }, 410);
  }

  const storage = getMediaStorage();
  if (!storage || storage.backend !== row.storageBackend) {
    return c.json({ error: "media storage unavailable" }, 503);
  }

  // s3: 署名 URL に 302。 local: 実体を直接配信。
  const signed = await storage.getSignedUrl(row.storageKey, SIGNED_URL_TTL_SEC);
  if (signed) {
    return c.redirect(signed, 302);
  }
  const buf = await storage.getBuffer(row.storageKey);
  // Buffer(ArrayBufferLike) → Uint8Array<ArrayBuffer> に変換して Hono の Data 型に合わせる
  return c.newResponse(new Uint8Array(buf), 200, {
    "Content-Type": row.mimeType,
    "Content-Length": String(row.size),
    "Cache-Control": "private, max-age=600",
    ...(row.fileName
      ? { "Content-Disposition": `inline; filename="${row.fileName.replace(/"/g, "")}"` }
      : {}),
  });
});
