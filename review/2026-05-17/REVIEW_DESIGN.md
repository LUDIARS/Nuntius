# 設計レビュー — Nuntius (2026-05-17)

## 1. 設計強度

| 評価 | 観点 | 所見 |
|------|------|------|
| A | 障害分離 | ジョブ queue (BullMQ) + worker で dispatcher 障害が REST に波及しない |
| B | 冪等性 | idempotency key + unique index、worker status check で重複防止。recurrence チェーン時 idempotencyKey 改変で軽微リスク |
| A | 入力バリデーション | routes/messages.ts:36-51 で channel/sendAt/recurrenceRule、media multipart で kind/mime/size |
| A | エラーハンドリング | worker dispatcher failure → リトライ、最大試行で failed |
| A | リトライ・タイムアウト | BullMQ exponential backoff (5回) + concurrency=10 |
| B | 状態管理 | scheduled_messages: pending/processing/delivered/failed/cancelled。topic_subscriptions active flag が削除時に使用されず |

### 軽微指摘
- recurrence チェーン時の idempotency 生成 (worker.ts:101) クロック skew リスク
- topic subscription cleanup 明示なし

### 総合評価: B

## 2. 設計思想一貫性: B

| 該当箇所 | 逸脱 | 推奨修正 |
|----------|------|---------|
| channels/webpush.ts:48-57 | VAPID 初期化 1 度、鍵ローテーション非対応 | ensureVapid() を lazy 化、各呼出で env 再読 |
| media/resolve.ts:38-41 | passthrough URL が SSRF ガードなしに dispatcher へ | assertSafeFetchUrl を全外部リソース取得に強制 |
| db/schema.ts / routes/media.ts | media_assets.id unique、 routes で projectKey check なし | GET /api/media/:id 時に projectKey scope 検証 |
| worker.ts:56-64 | resolveAttachmentsInPayload projectKey 受け取るが、dispatcher は payload.attachments 無条件使用 | dispatcher に projectKey を含める |

## 3. モジュール分割度・凝集度: A

| モジュール | 凝集度 | 所見 |
|-----------|--------|------|
| media/ (5 ファイル) | 機能的 | attachment 型 / limits / storage / resolve / url-guard |
| channels/ (11 dispatcher) | 機能的 | 各 channel 独立、formatters 共通、discord-shared.ts で共通化 |
| routes/ | 通信的 (API) | messages/templates/topics/inbox/credentials/media |
| queue/ | 時間的/機能的 | dispatch-queue / recurrence / pattern |
| auth/ | 機能的 | cernere-client / composite / routes / crypto |

SRP 違反・God Object: なし

### 総合評価: B

加重評価: **B**
