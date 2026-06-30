# 品質保証レビュー — Nuntius (2026-05-17)

## 1. テスト戦略・カバレッジ

| 評価 | 観点 | 所見 |
|------|------|------|
| C | unit | 18 新規 (media: parseAttachments / validateUpload / url-guard + 既存 60)、dispatcher 11 channel の単体テストなし |
| C | integration | 完全欠落、storage + worker の full path 未検証 |
| D | E2E | なし。Nuntius 全体 (REST → queue → worker → dispatcher) 検証一度もなし |
| C | エッジケース | smoke.test.ts が daily/every:15m/every:2h 検証、sendAt 過去/timezone/leap/DST 未カバー |
| A | CI 自動実行 | GitHub Actions で `npm test`、scripts/ci-check.sh で build + test + lint |

### 推奨改善
1. Dispatcher integration test (Mock storage + fake channel)
2. Media e2e test (multipart upload → storage → resolve → dispatch)
3. Boundary: sendAt < now, timezone edge cases

## 2. ライセンス遵守

| 依存 | ライセンス | 互換性 |
|------|-----------|--------|
| Hono | MIT | OK |
| BullMQ | MIT | OK |
| Drizzle | Apache 2.0 | OK |
| postgres | MIT | OK |
| @aws-sdk/* | Apache 2.0 | OK |
| web-push | MIT | OK |
| nodemailer | MIT | OK |

- [x] LICENSE (MIT) repo root
- [x] permissive licenses
- [ ] THIRD_PARTY_LICENSES / NOTICE: 未確認

推奨: `npm install license-checker` + THIRD_PARTY_LICENSES 自動生成

## 3. ドキュメント完備性

| 評価 | 観点 | 所見 |
|------|------|------|
| A | README | セットアップ 100 行、admin UI 説明、チャネル一覧なし |
| A | DESIGN / アーキ | CLAUDE.md 150 行 (認証/アーキ/DB/env/CI/WS protocol)、図なし |
| B | API リファレンス | CLAUDE.md WS コマンド表、REST routes コメントのみ、OpenAPI なし |
| A | inline コメント | モジュール先頭 3-10 行、resolve.ts/url-guard.ts/storage.ts 明確 |
| B | CONTRIBUTING / ランブック | なし |

### 推奨
1. OpenAPI 3.0 で API spec
2. Architecture diagram (Mermaid)
3. CONTRIBUTING.md (dev環境 + test + debug)

## 総合評価

| # | 観点 | 評価 |
|---|------|------|
| 1 | テスト戦略 | C |
| 2 | ライセンス | A |
| 3 | ドキュメント | B |

**加重評価: B**
