# AUTOFIX — Nuntius (2026-05-13)

`autofix_count = 0` (本レビューはソースコード修正を行わない / 列挙のみ)。

下記は「安全範囲で機械的に修正可能」と判断した候補。 採否はメンテナの判断に委ねる。

## 候補一覧

1. **schema コメント修正** — `src/db/schema.ts:225-256` の「暗号化: NUNTIUS_ENCRYPTION_KEY が設定されていれば endpoint / keys を AES-GCM で暗号化する」を「**現状は平文。 #TODO で暗号化予定**」に書き直す (または逆方向で暗号化を実装)。 影響範囲: コメントのみ。
2. **Cache-Control 付与** — `src/routes/push.ts:35-41` の `/vapid-public-key` レスポンスに `Cache-Control: public, max-age=300` を追加。 1 行追加で済む。
3. **`CORS_ORIGIN` の production guard** — `src/app.ts:63-66` で `process.env.NODE_ENV === "production" && (process.env.CORS_ORIGIN ?? "*") === "*"` のとき起動を fatal にする 4 行ガード。
4. **`webpush.ts` の VAPID_SUBJECT 検証** — `src/channels/webpush.ts:36-46` で subject が `^(mailto:|https?:\/\/)` にマッチしない場合に warn + 強制無効化。 lint レベルの安全変更。
5. **重複 subscription クエリのヘルパ化** — `src/routes/push.ts:60-83` / `src/routes/notify.ts:152-160` / `src/channels/webpush.ts:65-73` を `db/queries/push-subscriptions.ts` (新規) の `findActiveByUser(projectKey, userId)` に集約。 機械的にリファクタ可能。
6. **`as never` 削除** — `src/middleware/auth.ts` の `Hono<{ Variables: { ... } }>` 化。 ファイル単位の型注釈変更で済む。
7. **`updatedAt` 自動更新** — Drizzle 0.30+ なら `$onUpdate(() => new Date())`、 さもなくば共通 helper。 push / notification_preferences / scheduled_messages の `updatedAt` 列を 1 度にラップ。
8. **webpush payload size guard** — `src/channels/webpush.ts:80-88` で `notifPayload.length > 4 * 1024` のとき early return + delivery_logs に `payload_too_large` 記録。
9. **endpoint URL validation (allowlist)** — `src/routes/push.ts:50-58` で `new URL(body.endpoint).host` を allowlist (env で許可リスト渡し) と照合。 ただしこれは vulnerability 修正にあたるため、 メンテナ確認後 PR が安全。
10. **テスト追加** — `tests/webpush.test.ts` を新設し、 (a) `vapidConfigured` の boolean ラッチ (b) 410 で `revokedAt` が立つ (c) endpoint allowlist 拒否、 を mock で検証。 既存ファイル無改変。

## 採否注意

- 9 (allowlist) は「不正 publisher を弾く」効果と引き換えに既存 production の subscription が拒否される可能性 (provider 一覧の完備が必要) があるため、 PR 段でメンテナ確認が必須。
- 1 (schema コメント) は「暗号化されている」と誤認している運用者がいた場合に運用判断が変わるため、 単体 PR としてレビュー必須。

`autofix_count: 0` (本セッションではコード変更を行わない)。
