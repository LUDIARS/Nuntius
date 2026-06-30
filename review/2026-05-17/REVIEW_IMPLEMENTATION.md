# 実装品質レビュー — Nuntius (2026-05-17)

## 品質指標

| 項目 | 所見 |
|------|------|
| コード行数 | 6,466 行 (src/**/*.ts) |
| テストカバレッジ | 78 passed (60 + 18 新規)。media は pure function のみ |
| 型安全性 | TS strict、Drizzle + Hono で型 sync |
| エラーハンドリング | try-catch routes、worker failed callback で status=failed |
| パフォーマンス | BullMQ concurrency=10、media S3 署名 URL/local FS |

## 検出項目

| 箇所 | 指摘 | 評価 |
|------|------|------|
| media/storage.ts:56-62 | local backend path sanitize の `.{2,}` remove は octal encoding 対策なし | Minor |
| channels/webpush.ts:92-115 | 1 user の全端末を直列 await、並列化 (allSettled) 推奨 | Minor |
| routes/messages.ts:54-64 | idempotency unique は (projectKey, idempotencyKey) のみ | By Design |
| worker.ts:56-64 | resolveAttachmentsInPayload は payload のみ返却、dispatcher が projectKey 失う | Minor |
| routes/credentials.ts:40-60 | channel credentials 暗号化未設定時平文 | Medium (NUNTIUS_ENCRYPTION_KEY 未配線) |

## 総合評価

| # | 観点 | 評価 |
|---|------|------|
| 1 | コード安全性 | A |
| 2 | 複雑度・可読性 | A |
| 3 | テスト戦略 | C |

**加重評価: B**

主な指摘: integration test 不在で full path (user request → queue → worker → dispatcher) 検証なし。
