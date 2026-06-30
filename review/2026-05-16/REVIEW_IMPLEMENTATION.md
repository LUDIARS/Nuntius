# 実装評価 — Nuntius

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Nuntius |
| 対象ブランチ / PR | main (feat(media): PR#14) |
| レビュー実施日 | 2026-05-16 |
| 対象コミット | 72f3bb4 … 9e170ad |

---

## 1. コード品質 — 評価: B (重大指摘 1)

| 項目 | 評価 | 所見 |
|------|------|------|
| 型安全性 | A | TypeScript strict mode。Drizzle ORM の schema 型推論 |
| 関数設計 | A | Pure functions 優先 (formatters / attachment parser / url-guard) |
| エラーハンドリング | A | try-catch + typed error return (`{ success, error, ... }`) |
| DRY 原則 | B | 良好だが、`src/routes/{messages, topics, templates, media, push}` で projectKey / userId 取得が重複。共通 middleware へ抽出可能 |
| 命名・可読性 | A | 明確な名前 (`parseAttachments`, `isSafeFetchUrl`, `channelSupport`)。日本語コメント完備 |
| テスト可能性 | A | Pure functions が separable。mocking 不要な設計 |

改善案:
- `src/middleware/` に `requireProjectKey()` / `requireUserId()` middleware を追加し、 route ハンドラで呼び出し
- `src/lib/http-helpers.ts` で `projectKeyOrError()` 等を共通化

---

## 2. データスキーマ — 評価: A

| テーブル | 評価 |
|----------|------|
| `scheduled_messages` | ✓ 冪等性・tenant 分離・状態管理が完備。`idx_scheduled_status_sendat` で worker 効率化 |
| `topic_subscriptions` | ✓ tenant 分離。endpoint 暗号化。`unique_subscription` で重複登録排除 |
| `message_templates` | ✓ 多言語対応。flexible JSONB |
| `delivery_logs` | ✓ 監査ログ。tenant 分離 |
| `push_subscriptions` | ✓ endpoint 生保存 OK (PushManager 仕様)。revoked_at で soft delete |
| `media_assets` | ✓ TTL 管理。tenant 分離 |

強み:
- projectKey で全テーブル tenant 分離
- 暗号化フィールド (endpoint / channel_credentials) が type で safe
- idempotency_key / unique_subscription で重複排除
- TTL (expires_at) で個人データ自動削除

---

## 3. SRE — 評価: B (重大指摘 1)

| 項目 | 評価 | 所見 |
|------|------|------|
| ヘルスチェック | A | `GET /api/health` (認証不要) で API readiness 確認 |
| ロギング | A | `src/audit/logger.ts` で structured log。delivery_logs テーブル + projectKey で監査可能 |
| コネクション管理 | A | PostgreSQL / Redis connection pool 設定 |
| タイムアウト | A | WS 30s ping / 40s pong timeout |
| モニタリング指標 | B | queue length、 delivery_logs の failed count、 S3 get latency 等の metric 定義が不在。Prometheus export 推奨 |
| レプリケーション / failover | B | shared infra (PostgreSQL / Redis) は運用側に任せ。Nuntius 本体は stateless で水平スケール可能 |
| 環境変数管理 | A | `env-cli.config.ts` + Infisical。 rotate 戦略は存在 |
| デプロイ | B | Docker Compose で local/dev 環境提供。本番 Kubernetes manifest が不明 |

改善指摘:
- Prometheus metrics export endpoint (`GET /metrics`) を追加
- BullMQ queue lock ttl と worker timeout の説明を CLAUDE.md に追記
- 本番デプロイ (k8s + helm) の minimal example を `deploy/` に追加

---

## 総合評価

| # | レビュー観点 | 評価 | 重大指摘数 |
|---|------------|------|-----------|
| 1 | コード品質 | B | 1 |
| 2 | データスキーマ | A | 0 |
| 3 | SRE | B | 1 |
