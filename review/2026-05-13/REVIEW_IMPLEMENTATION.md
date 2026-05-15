# REVIEW_IMPLEMENTATION — Nuntius (2026-05-13)

評価: **B**

## 良い点

- `channels/webpush.ts:100-114` で 404 / 410 を検知して `revokedAt` を立て、 dead subscription を自動 prune する処理は web-push の RFC 通り。 `idx_push_user (userId, revokedAt)` (`schema.ts:252`) と組み合わさり、 worker クエリも効率的。
- `worker.ts:43-107` の BullMQ ハンドラは attempts インクリメント・繰り返しチェーンの idempotencyKey 拡張・成功時のみ next reschedule、 と通常パスが綺麗。
- `routes/push.ts:60-83` の renew は新規 INSERT の前に同 endpoint を探し、 既存があれば `revokedAt=null` + キー更新する。 端末再購読 (期限切れキー更新) のユースケースを拾えている。

## 不足・気になる点

1. **VAPID ラッチ問題** — `channels/webpush.ts:33-47` の `vapidConfigured` は 1 度しか評価されない。 `setVapidDetails` の前に kid を計算したり鍵差し替え (`SIGHUP` 相当) を扱う経路が無く、 鍵ローテーション = worker 再起動が前提。 production で実機 ローテはこれで耐えうるが、 設計と運用の暗黙契約は明文化が必要。
2. **直列ループ** — `channels/webpush.ts:92-115` は targets を `for ... await` する。 端末 5 個・1 つが timeout (web-push 既定 30s) すると後続が詰まる。 `Promise.allSettled` + p-limit 同時 5 程度が妥当。 BullMQ concurrency 10 (`worker.ts:144-148`) と組み合わさるとさらに直列段が増える。
3. **renew の tenant 検証漏れ** — `routes/push.ts:62-67` で `where (userId, endpoint)` のみ照合し、 既存行の `projectKey` を確認していない。 異プロジェクトに紐付いた行を更新してしまう経路がある (V-4 と対応)。
4. **エラーパスのコネクション残留** — `webpush.ts:101-104` は `await db.update(...)` を `for` 内で逐次に走らせる。 1 端末ごとに往復が増える。 まとめて `revokedAt` を CASE WHEN で更新する余地。
5. **`/vapid-public-key` のキャッシュ制御** — `routes/push.ts:35-41` は Cache-Control を付けず、 SW 側で取得タイミングが分散するとサーバ負荷の波が出る。 `max-age=300, public` で十分。
6. **payload サイズ無検証** — `channels/webpush.ts:80-88` で `JSON.stringify(...)` 後そのまま web-push に渡すが、 多くの provider は 4KB 上限 (FCM)。 大きい payload は 413 で reject されるが、 enqueue 時に弾く方が誠実。
7. **timestamp の updatedAt** — `routes/push.ts:73-81` / `141-146` の delete は `revokedAt + updatedAt` 双方を `new Date()` で更新する。 一方 schema の `updatedAt` は `defaultNow()` だけで `$onUpdate` ヘルパが無く、 別 routes 経由で update したとき更新漏れの危険。 共通 helper でラップしたい。
8. **dispatch 並列度の per-channel 制御なし** — BullMQ Worker concurrency=10 (`worker.ts:147`) は all-channel 共通。 web-push provider は per-origin rate limit が厳しい (FCM は projectId per second 上限) ため、 channel 別 queue or rate limit が欲しい。

## まとめ

中核ロジックは web-push エコシステムを正しく踏襲して B。 直列ループ・tenant チェック・payload size 検証を埋めると A 圏内。
