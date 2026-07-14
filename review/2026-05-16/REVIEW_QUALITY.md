# 品質保証レビュー — Nuntius

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Nuntius |
| 対象ブランチ / PR | main (feat(media): PR#14) |
| レビュー実施日 | 2026-05-16 |

---

## 1. テスト戦略・カバレッジ — 評価: B

| テスト種別 | 評価 | 説明 |
|-----------|------|------|
| 単体テスト | A | `tests/crypto.test.ts` (90 行)、`tests/formatters.test.ts` (134 行)、`tests/media.test.ts` (131 行)。純粋関数が充実 |
| 統合テスト | B | `tests/smoke.test.ts` (151 行) + `tests/ws-integration.test.ts` (287 行) |
| end-to-end | C | Docker compose + database は整っているが、実 Slack/Discord/LINE 連携テストが missing |
| パフォーマンステスト | D | latency / throughput ベンチマークなし。queue backlog、dispatcher latency (p99) 測定する負荷テストが欠落 |
| セキュリティテスト | A | SSRF ガード、暗号化、認認可フロー、input validation をテストカバー |

改善優先度:
1. vitest coverage report を CI に組み込み (カバレッジ 80% 以上を enforce)
2. external service mock による e2e test 追加
3. 負荷テスト SLO 定義

---

## 2. パフォーマンス・ベンチマーク — 評価: B

| 指標 | 目標値 | 現在値 | 評価 |
|------|--------|--------|------|
| API レスポンス | <100ms (p99) | 不明 | 測定推奨 |
| キュー処理 | <5s (pending → processing) | 不明 | 不明 |
| 配信レイテンシ | <30s | 不明 | 不明 |
| Webhook payload size | <1MB | design OK (attachments URL ref) | ✓ OK |
| DB connection pool | 5-10 connections | Drizzle / Postgres ORM デフォルト | ✓ OK |

---

## 3. ライセンス遵守 — 評価: A

| 項目 | 確認 |
|------|------|
| package.json | MIT ライセンス。すべての依存も MIT / ISC / Apache-2.0。GPL 系はなし |
| NOTICE / ATTRIBUTION | `LICENSE` ファイル MIT のみ。依存ライセンス一覧は `npm list --all` で確認可能 |
| CI integration | `license-checker` / `licensee` を CI に組み込むことを推奨 (not yet) |

---

## 4. ドキュメント完備性 — 評価: B

| ドキュメント | 評価 | 説明 |
|------------|------|------|
| README.md | B | セットアップ・API 概要は完備。 但し本番デプロイ (k8s / Docker registry)、 CI/CD パイプラインの説明が不足 |
| CLAUDE.md | B | 認証・DB・メディア・WebSocket ルール。 但し error handling / retry strategy / cleanup job 等の運用ドキュメントが missing |
| API ドキュメント | C | `GET /api/` redoc / Swagger が未実装。 endpoint 一覧は README に記載だが、 パラメータ・レスポンス schema が不明確 |
| チャネル実装ガイド | B | formatters / limits / url-guard が型と comment で documented |
| 運用ガイド | D | 本番 SLO / alert threshold / incident response がない。 scaling / backup strategy も undefined |

---

## 5. クロスプラットフォーム互換 — 評価: B

| プラットフォーム | 評価 | 所見 |
|----------------|------|------|
| Node.js v22+ | A | TypeScript / ESM で記述 |
| PostgreSQL 12+ | A | Drizzle migration + IF NOT EXISTS で互換性確保 |
| Redis 6+ | A | BullMQ v5 は Redis 6+ 必須 |
| Docker | A | Dockerfile + compose.yaml で本番・dev template ready |
| Windows / macOS / Linux | B | npm scripts で dependency install / build OK。 但し `bash scripts/ci-check.sh` は POSIX 依存 |
| Browser (frontend) | A | React 19 + Vite。 ES2020+ target |

---

## 総合評価

| # | レビュー観点 | 評価 | 重大指摘数 |
|---|------------|------|-----------|
| 1 | テスト戦略・カバレッジ | B | 0 |
| 2 | パフォーマンス・ベンチマーク | B | 0 |
| 3 | ライセンス遵守 | A | 0 |
| 4 | ドキュメント完備性 | B | 0 |
| 5 | クロスプラットフォーム互換 | B | 0 |
