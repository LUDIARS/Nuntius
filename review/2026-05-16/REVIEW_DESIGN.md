# 設計レビュー — Nuntius

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Nuntius |
| 対象ブランチ / PR | main (feat(media): PR#14) |
| レビュー実施日 | 2026-05-16 |
| 対象コミット | 72f3bb4 … 9e170ad |

---

## 1. 設計強度 — 評価: A

**障害分離 - A**: Queue・Dispatcher・Channel の役割分離が明確。REST/WS 受信時は queue に投入のみで、 dispatching は worker で非同期実行。外部チャネル障害が API 本体に波及しない。

**冪等性 - A**: `scheduled_messages.idempotencyKey` ユニーク制約で重複送信を防止 (`src/db/schema.ts:90`)。配信ログ (`delivery_logs`) で重複検知可能。

**入力バリデーション - A**: `parseAttachments()` で exactly-one (url XOR mediaId) を強制 (`src/media/attachment.ts:52-79`)。kind の枚挙チェック。MIME 型の前方一致バリデーション (`media/limits.ts:38-56`)。URL は SSRF ガード済み。

**エラーハンドリング - A**: dispatcher は try-catch で各チャネルの例外を個別捕捉し、`DispatchResult` 統一形式で返却 (`src/channels/webpush.ts:100-134`)。

**リトライ・タイムアウト設計 - A**: 配信失敗は最大 5 回まで指数バックオフ。WebPush は 60s TTL + 40s ping-pong timeout 確定。

**状態管理の明確性 - A**: `MessageStatus` enum (pending / processing / delivered / failed / cancelled) が `scheduled_messages.status` に対応。状態遷移が worker → dispatcher で単一方向。

---

## 2. 設計思想の一貫性 — 評価: A

| 該当箇所 | 逸脱内容 | 結論 |
|----------|---------|------|
| 全体 | - | ✓ REST ↔ WS 同等機能 (`/api/messages/schedule` + `module_request nuntius.schedule` 同等実装) |
| 全体 | - | ✓ project / user token の区別 |
| `src/media/limits.ts` | - | ✓ チャネル別制約の一元管理 (`CHANNEL_MEDIA_SUPPORT` で native/url/none を定義) |
| `src/auth/composite.ts` | - | ✓ Cernere 認証フロー (Schedula パターン) |

---

## 3. モジュール分割度 — 評価: A

| モジュール | 凝集度 | 評価 |
|-----------|--------|------|
| `src/channels/*` | 機能的 | ✓ 各チャネルが単一の送信責務。`dispatch(message): Promise<DispatchResult>` 統一インターフェース |
| `src/media/{attachment, limits, url-guard, storage}` | 機能的 | ✓ メディア層が完全に分離 |
| `src/queue/{dispatch-queue, pattern-resolver, recurrence}` | 機能的 | ✓ キュー管理、テンプレート解決、recurrence ロジックが分割 |
| `src/routes/{messages, topics, templates, credentials, media, push}` | 機能的 | ✓ REST エンドポイントが domain 別に整理 |
| `src/auth/{composite, cernere-client, crypto, routes}` | 機能的 | ✓ 認証フロー・暗号化が独立 |
| `src/ws/{handler, dispatcher, session, commands, register-commands}` | 機能的 | ✓ WS 接続管理・コマンド dispatcher・セッション が分離 |
| `tests/*` | 機能的 | ✓ 単体テストが純粋関数テスト、WS integration が別 |
| `frontend/` | 機能的 | ✓ React Vite SPA |

---

## 総合評価

| # | レビュー観点 | 評価 | 重大指摘数 |
|---|------------|------|-----------|
| 1 | 設計強度 | A | 0 |
| 2 | 設計思想の一貫性 | A | 0 |
| 3 | モジュール分割度 | A | 0 |
