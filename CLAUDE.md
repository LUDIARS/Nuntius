# Nuntius 開発ルール

LUDIARS 統合通知・メッセージング基盤。

## 認証

Cernere に従う (RULE.md 準拠):
- ユーザー認証: Cernere project WS 経由
- サービス間認証: Cernere project credentials (client_id/secret)

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
| `JWT_SECRET` | Nuntius 自身の token 署名用 |

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
| `list_my`  | 自分 (または指定ユーザー) の予約/inbox 一覧    | `{ userId?, limit?, includeInbox? }`                                    | project token 必須 |

> いずれも `ctx.projectKey` が必須。user_token 単体では `project context required` エラーが返る
> (ユーザー直接呼び出しを許可するコマンドは今後追加予定)。

## 移行ロードマップ

- **Phase 1**: 骨格実装 (queue/dispatcher/Slack/Discord/LINE)
- **Phase 2**: Schedula から `reminder` + `notification` 移管
- **Phase 3**: Imperativus 連携 (音声チャネル)
- **Phase 4**: Schedula 側のレガシー削除
