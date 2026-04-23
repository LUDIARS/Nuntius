# Nuntius 開発ルール

LUDIARS 統合通知・メッセージング基盤。

## 認証

Cernere に従う (RULE.md 準拠):
- ユーザー認証: Cernere project WS 経由
- サービス間認証: Cernere project credentials (client_id/secret)

### admin UI (frontend) — Cernere Composite

`frontend/` から Nuntius を触る運用者は Cernere Composite でログインする。
Schedula と同じパターン:

1. Frontend が `POST /api/auth/cernere/login { email, password }` を叩く
2. Nuntius backend が project WS 経由で Cernere の `auth.login` コマンドを呼び、
   `authCode` (or `mfaRequired`) を取得
3. MFA が必要なら `/api/auth/cernere/mfa-verify`、そうでなければ即
   `POST /api/auth/exchange { authCode }` で `accessToken` に交換
4. backend が自身の `service_token` (HS256 JWT, `iss=nuntius`) を発行し、
   `nuntius_token` Cookie (HttpOnly, SameSite=Lax) にセット
5. 以降の全 REST/WS は Cookie で認証

Popup モードも `/api/auth/login-url` で取得した URL を別ウィンドウで開く
フローをサポート。

#### admin 権限と projectKey

Cookie セッションは user_token と同等の扱いとなり、REST ルート
(`/api/templates`, `/api/messages` 等) は `projectKey` を要求する。
admin ロールのユーザーは **`NUNTIUS_ADMIN_PROJECT_KEY` 環境変数の値**を
`projectKey` として紐付け、既存ルートにアクセス可能とする。

| 環境変数 | 用途 |
|---------|------|
| `NUNTIUS_ADMIN_PROJECT_KEY` | admin UI ログイン時に bind する projectKey |
| `JWT_SECRET` | service_token (Cookie) の署名鍵 |

## アーキテクチャ原則

1. **配信は非同期ワーカー** — REST/WS 受信時は queue に投入のみ、配信は別 worker で処理
2. **配信失敗のリトライ** — 指数バックオフで最大 5 回
3. **Idempotency** — message_id で重複防止
4. **チャネルプラグイン** — 各チャネル (Slack/Discord/LINE/Alexa/Email/SMS) は独立した dispatcher

## DB

- PostgreSQL (`nuntius` DB、共有インフラ)
- Redis (BullMQ queue + キャッシュ)
- マイグレーション冪等性 (`IF NOT EXISTS`、DROP 禁止)

## 環境変数

`@ludiars/cernere-env-cli` + Infisical で管理。

| 変数 | 用途 |
|------|------|
| `CERNERE_URL` | Cernere base URL |
| `CERNERE_PROJECT_CLIENT_ID` | Nuntius プロジェクト認証 |
| `CERNERE_PROJECT_CLIENT_SECRET` | 同上 |
| `DATABASE_URL` | PostgreSQL |
| `REDIS_URL` | Redis (queue 用) |
| `JWT_SECRET` | Nuntius 自身の service_token 署名用 (admin UI Composite 認証) |
| `NUNTIUS_ADMIN_PROJECT_KEY` | admin UI ログイン時に bind する projectKey |
| `NUNTIUS_ENCRYPTION_KEY` | `topic_subscriptions.endpoint` の暗号化鍵 (AES-256-GCM、base64 エンコード 32 byte)。未設定時は平文保存 (dev のみ許容) |

## CI

`bash scripts/ci-check.sh` (実装後): TypeScript build + test + lint。

## WebSocket (`/ws`)

Nuntius は REST と同じビジネスロジックを WS 経由でも公開する。

### 接続

```
GET /ws?token=<token>
```

- `token` は Cernere が発行した JWT。以下のどちらも受け付ける:
  - **project_token** (`/api/auth/login` grant_type=project_credentials で取得) — 他サービスからの接続
  - **user_token** (Cernere ユーザーログイン後の accessToken) — エンドユーザー直接接続
- Cernere の `/api/auth/verify` でトークン種別を判定し、`projectKey` または `userId` を
  セッションにバインドする
- 30 秒間隔で `ping`/`pong`、40 秒無応答で強制切断 (RULE.md 準拠)

### プロトコル

```jsonc
// 接続成功時
{ "type": "connected", "session_id": "...", "kind": "project"|"user", "project_key"?: "...", "user_id"?: "..." }

// クライアント → Nuntius
{ "type": "module_request", "request_id": "req_1", "module": "nuntius", "action": "schedule", "payload": {...} }

// Nuntius → クライアント (成功)
{ "type": "module_response", "request_id": "req_1", "module": "nuntius", "action": "schedule", "payload": {...} }

// Nuntius → クライアント (エラー)
{ "type": "error", "request_id": "req_1", "code": "command_error", "message": "..." }
```

### 対応コマンド (`module: "nuntius"`)

| action     | 説明                                           | payload                                                                 | 備考 |
|------------|------------------------------------------------|-------------------------------------------------------------------------|------|
| `schedule` | 時間指定メッセージを登録 (REST `POST /api/messages/schedule` と同等) | `{ userId, channel, sendAt, payload, templateId?, recurrenceRule?, idempotencyKey?, ... }` | project token 必須 |
| `cancel`   | 予約メッセージをキャンセル                     | `{ id }`                                                                | project token 必須 |
| `publish`  | トピックに即時配信 (REST `POST /api/topics/:topic/publish` と同等) | `{ topic, channel?, payload, sendAt?, source? }`                        | project token 必須 |
| `subscribe`| トピック購読を登録                             | `{ topic, userId?, channel, endpoint? }`                                | project token 必須 (`userId` 省略時は session の userId) |
| `list_my`  | 自分 (または指定ユーザー) の予約/inbox 一覧    | `{ userId?, limit?, includeInbox? }`                                    | project token / user_token 両対応 |

> `schedule` / `cancel` / `publish` / `subscribe` は `ctx.projectKey` が必須で、
> user_token 単体で呼ぶと `project context required` エラーになる。
>
> `list_my` のみ user_token でも呼び出せる。その場合は projectKey 横断で
> `ctx.userId` 自身のデータのみを返し、`input.userId` で他ユーザーを指定すると
> `forbidden` エラーになる。project_token 経由なら従来どおり projectKey で
> テナント分離しつつ任意の userId を指定できる。

## 移行ロードマップ

- **Phase 1**: 骨格実装 (queue/dispatcher/Slack/Discord/LINE)
- **Phase 2**: Schedula から `reminder` + `notification` 移管
- **Phase 3**: Imperativus 連携 (音声チャネル)
- **Phase 4**: Schedula 側のレガシー削除
