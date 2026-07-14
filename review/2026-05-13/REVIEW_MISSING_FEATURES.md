# REVIEW_MISSING_FEATURES — Nuntius (2026-05-13)

評価: **C**

push relay として本番運用するには下記の機能が欠けている。

## M-1 (High) VAPID 鍵ローテーション運用

- 状態: 環境変数 1 セット (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`) のみ。 keyId / nextKey / overlapWindow の概念が schema にも env にも無い。
- 必要: (a) 新旧 2 鍵並走 (env を `_NEXT` 接尾辞で持つ) (b) `/api/push/vapid-public-key` が両方返す + activeKid を示す (c) クライアント (SW) が kid を保存し、 変わったら `pushManager.subscribe({applicationServerKey: nextKey})` で再購読
- 関連: `routes/push.ts:35-41`、`channels/webpush.ts:33-47`

## M-2 (High) Endpoint allowlist / SSRF guard

- 状態: 未実装。 任意 URL が登録可能 (REVIEW_VULNERABILITY V-1 参照)
- 必要: 登録時に provider 一覧と TLS 強制をチェック、 既存 row も startup migration で sweep
- 関連: `routes/push.ts:44-97`

## M-3 (Medium) Subscription の暗号化 / 仕様整合

- 状態: schema コメントは暗号化を謳うが、 実装は平文。 `crypto/secret.ts` は channel_credentials 用のみ。
- 必要: encryption 配線 + 既存 row に対するバックフィル migration (`encryptJson` で書き直し)
- 関連: `db/schema.ts:225-256`, `routes/push.ts:74-95`, `channels/webpush.ts:94-98`

## M-4 (Medium) Per-channel rate limit / 並列上限

- 状態: BullMQ concurrency 10 のみ (`worker.ts:144-148`)
- 必要: channel 別 queue or rate limiter (FCM/APNs/Autopush の per-project 上限を尊重)、 worker.ts に shard 機構

## M-5 (Medium) Push subscription の TTL / 健全性チェック

- 状態: `revokedAt` は 404/410 で立つが、 `lastDeliveredAt` から N 日経過した端末を能動的に prune する経路が無い (`channels/webpush.ts:100-103`)。
- 必要: 定期 job で「最終配信から 90 日 + 未開封」を archive する pattern

## M-6 (Low) Topic 購読 / fanout の Web Push 対応

- 状態: `topic_subscriptions` (`db/schema.ts:96-117`) に endpoint カラムがあるが、 `webpush` channel での fanout を route 化していない (現状は `/api/notify/user` 1 ユーザ単位のみ)。
- 必要: `POST /api/topics/:topic/publish` が channel=webpush の購読者を `pushSubscriptions` 経由で配るパス、 もしくは topic 購読時に push subscription を自動紐付け。

## M-7 (Low) Webhook 経由の delivery 結果コールバック

- 状態: delivery_logs (`schema.ts:168-193`) には書くが、 publisher (外部サービス) への完了通知 webhook が無い。
- 必要: publisher 登録時に completionWebhook URL を取り、 配信成功/失敗で POST。 BullMQ 完了 hook (`worker.ts:150-160`) を流用可能。

## M-8 (Low) admin UI から push subscription を一覧/失効する操作画面

- 状態: backend API (`routes/push.ts:99-148`) は揃っているが、 frontend (`frontend/src/pages/*.tsx`) には push 専用ページが無い (CredentialsPage / PatternsPage / PreferencesPage のみ。 `git ls-files` より)。
- 必要: admin が問題ユーザの端末を即時 revoke できる UI

## 総評

push relay の MVP は満たすが、 鍵ローテと SSRF guard 不在で production-ready とは言いがたく **C**。
