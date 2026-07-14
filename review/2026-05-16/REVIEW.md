# AI Code Review Format — Nuntius

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Nuntius |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-05-16 |
| 対象コミット範囲 | 72f3bb4 (2026-05-14) … 最新 (2 commits: feat(media) + docs) |

---

## 総合評価

| # | レビュー観点 | 評価 | 重大指摘数 | ドキュメント |
|---|------------|------|-----------|------------|
| 1 | 設計強度 | A | 0 | REVIEW_DESIGN.md |
| 2 | 設計思想の一貫性 | A | 0 | REVIEW_DESIGN.md |
| 3 | モジュール分割度 | A | 0 | REVIEW_DESIGN.md |
| 4 | コード品質 | B | 1 | REVIEW_IMPLEMENTATION.md |
| 5 | コードレベル脆弱性 | A | 0 | REVIEW_VULNERABILITY.md |
| 6 | Web脆弱性 (SSRF/SQLi/XSS) | A | 0 | REVIEW_VULNERABILITY.md |
| 7 | ゼロトラスト | A | 0 | REVIEW_VULNERABILITY.md |
| 8 | セキュリティ強度 | B | 1 | REVIEW_VULNERABILITY.md |
| 9 | データスキーマ | A | 0 | REVIEW_IMPLEMENTATION.md |
| 10 | テスト戦略・カバレッジ | B | 0 | REVIEW_QUALITY.md |
| 11 | パフォーマンス・ベンチマーク | B | 0 | REVIEW_QUALITY.md |
| 12 | ライセンス遵守 | A | 0 | REVIEW_QUALITY.md |
| 13 | ドキュメント完備性 | B | 0 | REVIEW_QUALITY.md |
| 14 | 機能改善 | - | 3 | REVIEW_MISSING_FEATURES.md |
| 15 | 不足機能 | - | 2 | REVIEW_MISSING_FEATURES.md |
| 16 | クロスプラットフォーム互換 | B | 0 | REVIEW_QUALITY.md |
| 17 | SRE | B | 1 | REVIEW_IMPLEMENTATION.md |

---

## 総合サマリ

Nuntius は **LUDIARS 統合通知・メッセージング基盤** (SQS/SNS 的)。Phase 1～2 骨格 + Phase 3 前置き (Imperativus リレー) を実装。本レビュー対象コミット (72f3bb4) では **全チャネルへのメディア添付対応 (PR#14)** を完成させた。

**強みポイント:**
- **セキュリティ設計が堅牢**: VAPID 鍵管理、SSRF ガード (`url-guard.ts`)、AES-256-GCM 暗号化、endpoint 暗号化・テナント分離が完備
- **チャネル拡張性が高い**: 媒体別フォーマッタ (`channels/formatters/`)、チャネル別制約定義 (`media/limits.ts`)、ネイティブ ↔ URL degradation を一元管理
- **テスト・型安全が徹底**: 859 行のテスト (smoke + WS integration 287 行)、TypeScript strict、Drizzle ORM の型安全性、`exactly-one` バリデーション
- **設計思想が一貫**: REST ↔ WS 同機能、worker 非同期化、Cernere 認証の透過性、project/user token 区別

**改善指摘:**
- **VAPID 鍵ローテーションが未実装** (`webpush.ts:37`): 環境変数からの一度読み込みで固定
- **個人データ保持ポリシーの明確化が不足**: `media_assets.expires_at` で TTL ワイプ設計は OK だが、admin UI に監視・削除ツールがない
- **パフォーマンス・スケーリング計測が不在**: BullMQ queue の backlog 監視、S3 署名 URL の生成レイテンシ、WebPush 複数端末同時配信のベンチマークが未確認
- **トピック購読の endpoint 長期保持**: 暗号化済みだが、有効性確認 (バリデーション) が実装されておらず、無効な endpoint が蓄積する可能性

**重み付けスコア: A (88% / 100)** — 16 観点中 A 9 / B 7、機能 2 観点除外。GO 判定。
