# REVIEW_DESIGN — Nuntius (2026-05-13)

評価: **B**

## 良い点

- 設計が「受信 (REST/WS) → BullMQ enqueue → worker → channel dispatcher」と段階分離されており、Web Push は他 channel と同じ `ChannelDispatcher` 抽象に乗っている (`channels/webpush.ts:49-125`)。これにより複数チャネル fan-out (`routes/notify.ts:99-108`) が一様化されている。
- `notification_preferences` (`db/schema.ts:263-285`) を独立テーブルとして持ち、`/api/notify/user` (`routes/notify.ts:60-141`) が channel-agnostic に preference 順で fallback する設計は、 個人データ保管禁止 (Cernere 単一情報源) と整合 (channel endpoint だけが Nuntius 側保管)。
- VAPID 鍵を環境変数 + Infisical (`README.md:43-77` / `CLAUDE.md` env table) に外出ししており、 鍵を repo に置かない原則は守られている。

## 設計上の懸念

1. **VAPID 鍵ローテーションの経路欠如** — `webpush.ts:33-47` で `vapidConfigured` を boolean ラッチし、 1 度真と判定すると `webpush.setVapidDetails` を再実行しない。 Infisical で鍵を差し替えても worker プロセス再起動まで反映されない。 push 系は v1/v2 並走で 24h オーバーラップ運用が望ましく、 schema に `keyId` を埋める拡張余地が無い (`scheduled_messages.payload` に rawJSON で書く道しか無い)。
2. **subscription endpoint の信頼境界が「来た URL を信じる」** — `routes/push.ts:21-32` の `SubscribeBody` は `endpoint: string` を任意で受ける。 仕様上は FCM/APNs/Mozilla autopush の限られた origin に向くべきだが、 値域制約が無い。 PWA フロントエンドのみが叩く前提でも、 ブラウザ拡張から悪意のある endpoint を登録すれば中継サーバが内部ネットワークへ HTTP リクエストを発射する経路となる。 設計時点で allowlist が無いのは要見直し。
3. **publisher 識別の粒度** — `projectAuth` (`middleware/auth.ts:24-69`) で projectKey と userId は分離されているが、 「publisher が他人の subscription に publish できるか」 のチェックは `webpushDispatcher` 側に存在せず、 `scheduledMessages.userId == pushSubscriptions.userId` の AND だけが暗黙の境界。 schema の unique index `(userId, endpoint)` も projectKey を含まない (`db/schema.ts:251-255`) ため、 同一 user が 2 project で同一端末を購読すると追跡が困難。 unique を `(projectKey, userId, endpoint)` に再設計したい。
4. **/vapid-public-key の認証不要は妥当だが** (`routes/push.ts:35-41`) keyId / supportedAlgorithms / rotatedAt を持たない素の base64 を返すだけで、 クライアント側のキャッシュ/古い購読の自動 unsubscribe フックが組めない。 PWA WebPush 統合パターン (memory) でも「VAPID 鍵は永続化必須」と述べられており、 ローテーション設計を明文化すべき。
5. **admin 自動 bind の影響範囲** — `middleware/auth.ts:58-63` は admin role を `NUNTIUS_ADMIN_PROJECT_KEY` に問答無用で bind する。 push subscription の renew / delete に admin が触る場合の access log は `admin_access_logs` 設計 (`schema.ts:292-317`) に項目があるが、 push routes (`routes/push.ts`) では実際の書き込みが行われていない (audit 配線漏れ)。

## 結論

WebPush 中継としての層分け / preference 解決 / 個人データの projectKey 隔離は基本に忠実で B。 鍵ローテーション・endpoint allowlist・tenant 境界の 3 点を埋めれば A に届く。
