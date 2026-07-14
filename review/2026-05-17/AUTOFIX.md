# AUTOFIX.md

## 概要
- 修正ファイル数: 0
- 変更行数: +0 / -0
- カテゴリ別件数: lint=1 / typo=0 / unused_import=0 / dead_code=0 / gitignore=0 / toc=1
- 関連 PR: なし

## 修正対象なし (本日は自動修正 PR 作成見送り)

## フラグしたが手作業に回した指摘

- **lint**: media/storage.ts:57 — replace 正規表現を `replace(/[^A-Za-z0-9_.\/-]/g, "")` に拡張 (octal encoding 対策)
- **toc**: README.md に目次テーブル追加

### 設計レベル変更 (手作業必須)

- media/resolve.ts:38-41 passthrough URL に SSRF ガード追加 — REVIEW_VULNERABILITY.md High
- channels/webpush.ts:92-115 Promise.allSettled で並列化 — REVIEW_MISSING_FEATURES.md §1
- media TTL cleanup job 実装 — REVIEW_MISSING_FEATURES.md §2
- credential rotation endpoint — REVIEW_MISSING_FEATURES.md §2
- npm audit CI 統合 — REVIEW_MISSING_FEATURES.md §2
- NUNTIUS_ENCRYPTION_KEY 配線 (credentials 平文保存対策) — REVIEW_IMPLEMENTATION.md
- Webhook signature verification (HMAC-SHA256) — REVIEW_MISSING_FEATURES.md §2
- Dispatcher integration test + Media e2e — REVIEW_QUALITY.md §1

## 関連
- レビュー全文: REVIEW.md / REVIEW_*.md
- 修正 PR diff: なし
