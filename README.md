# Nuntius

LUDIARS 統合通知・メッセージング基盤 (SQS / SNS 的)。

他サービス (Schedula / Imperativus / Curare / PM 等) からの通知要求を受け取り、複数チャネル (Web / Slack / Discord / LINE / Alexa / Email / SMS) に配信する。

## 設計

- **Queue (SQS的)**: 時間指定・優先度・リトライ付きメッセージ
- **Topic (SNS的)**: Pub/Sub トピックでプラットフォーム抽象化
- **Reminder**: Queue の時間指定配信の特化ユースケース
- **Channels**: Web / Slack / Discord / LINE / Alexa / Email / SMS / Webhook

## アーキテクチャ

```
[Schedula / Imperativus / Curare / PM ...]
       ↓ publish (Cernere project WS)
     [Nuntius Queue (Redis + PostgreSQL)]
       ↓ dispatch (worker)
[Web / Slack / Discord / LINE / Alexa / Email / SMS]
```

## 依存

- **Cernere**: 認証 (project WS で `nuntius` プロジェクトとして接続)
- **共有インフラ** (`../infra`): PostgreSQL (`nuntius` DB) + Redis (queue)
- **Imperativus**: 音声 (Alexa等) チャネルへのリレー

## 技術スタック

| 分類 | 技術 |
|------|------|
| バックエンド | Hono + Node.js + TypeScript |
| ORM | Drizzle ORM (PostgreSQL) |
| キュー | BullMQ (Redis) |
| 認証 | Cernere (`@ludiars/cernere-id-cache`) |
| 環境変数 | `@ludiars/cernere-env-cli` + Infisical |

## API 概要

### Queue (時間指定)
```
POST /api/messages/schedule    # スケジュール送信
POST /api/messages/recurring   # 繰り返し (cron-like)
DELETE /api/messages/:id       # キャンセル
```

### Topic (即時 Pub/Sub)
```
POST /api/topics/:topic/publish      # トピックに配信
POST /api/topics/:topic/subscribe    # ユーザー購読
DELETE /api/topics/:topic/subscribe  # 購読解除
```

### Project WS commands
```
{ module: "nuntius", action: "schedule",  payload: {...} }
{ module: "nuntius", action: "publish",   payload: {...} }
{ module: "nuntius", action: "list_my",   payload: {...} }
```

### Templates / 通知パターン
```
GET    /api/templates                  # 一覧 (?channel= でフィルタ)
GET    /api/templates/:id              # 取得
POST   /api/templates                  # 作成
PUT    /api/templates/:id              # 更新
DELETE /api/templates/:id              # 削除
POST   /api/templates/:id/render       # テスト用レンダリング
GET    /api/templates/mentions         # mention サジェスト (?channel=)
```

`{{var}}` でプレースホルダ、`{{@key}}` でメンションを埋め込み、Slack/Discord/LINE 等のチャネル別表記に自動解決される。

### Web inbox
```
GET    /api/inbox?userId=<id>          # ユーザーの未読/既読一覧
POST   /api/inbox/:id/read             # 既読化
DELETE /api/inbox/:id                  # 削除
```

## WebSocket (`/ws`)

REST と同じビジネスロジックを WS でも公開する。

```
GET /ws?token=<token>
```

- `token` は Cernere が発行した JWT (project_token / user_token どちらも可)
- `/api/auth/verify` でトークン種別を判定し、`projectKey` または `userId` を session に bind
- 30s ping / 40s pong タイムアウトで強制切断

#### プロトコル

```jsonc
{ "type": "connected", "session_id": "...", "kind": "project"|"user", "project_key"?, "user_id"? }
{ "type": "module_request",  "request_id": "req_1", "module": "nuntius", "action": "schedule", "payload": {...} }
{ "type": "module_response", "request_id": "req_1", "module": "nuntius", "action": "schedule", "payload": {...} }
{ "type": "error",           "request_id": "req_1", "code": "command_error", "message": "..." }
```

#### 対応コマンド

| action | 説明 | 備考 |
|--------|------|------|
| `nuntius.schedule`  | 時間指定メッセージを登録 | project token 必須 |
| `nuntius.cancel`    | 予約メッセージをキャンセル | project token 必須 |
| `nuntius.publish`   | トピックに即時配信 | project token 必須 |
| `nuntius.subscribe` | トピック購読を登録 | project token 必須 |
| `nuntius.list_my`   | 自分 (または指定ユーザー) の予約/inbox 一覧 | project token 必須 |

## Admin UI (frontend)

`frontend/` 以下に通知パターン管理用の React 19 + Vite 8 SPA が含まれる。

```bash
cd frontend
npm install
npm run dev          # http://localhost:5175 (backend 3100 を proxy)
```

### 認証 (Cernere Composite)

admin UI は Cernere Composite でログインし、Nuntius backend が発行する HS256 service_token を `nuntius_token` HttpOnly Cookie に保持する。Schedula と同じパターン。

| エンドポイント | 用途 |
|--------------|------|
| `POST /api/auth/cernere/login`     | email + password ログイン (project WS 経由 → Cernere) |
| `POST /api/auth/cernere/mfa-verify`| MFA コード検証 |
| `GET  /api/auth/login-url`         | popup モード用 Cernere URL |
| `POST /api/auth/exchange`          | authCode → service_token + Cookie 発行 |
| `POST /api/auth/logout`            | Cookie 削除 |
| `GET  /api/auth/me`                | 現在のユーザー情報 (Cookie 前提) |
| `GET  /api/auth/ws-token`          | WS 接続用に Cookie → URL token を返す |

admin ロールのセッションは `NUNTIUS_ADMIN_PROJECT_KEY` を `projectKey` として bind し、`/api/templates` 等の REST にアクセス可能となる。

## 環境変数

| 変数 | 用途 |
|------|------|
| `CERNERE_URL` | Cernere base URL |
| `CERNERE_PROJECT_CLIENT_ID` | Nuntius プロジェクト認証 |
| `CERNERE_PROJECT_CLIENT_SECRET` | 同上 |
| `DATABASE_URL` | PostgreSQL |
| `REDIS_URL` | Redis (queue 用) |
| `JWT_SECRET` | service_token 署名鍵 (admin UI Composite 認証) |
| `NUNTIUS_ADMIN_PROJECT_KEY` | admin UI ログイン時に bind する projectKey |
| `SMTP_URL` / `SMTP_FROM` | Email チャネル (nodemailer) |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | SMS チャネル (AWS SNS) |
| `ALEXA_CLIENT_ID` / `ALEXA_CLIENT_SECRET` | Alexa Proactive Events |

外部 SDK (nodemailer / aws-sdk / alexa) は optional dynamic import。環境変数未設定時は **dev モード** (ログのみで success) として動く。

## CI / テスト

ローカルと GitHub Actions で同じスクリプトを使う:

```bash
bash scripts/ci-check.sh
```

実行内容:

1. **Backend Build** — `npm run build` (tsc)
2. **Backend Tests** — `npm test` (vitest run)
   - smoke + recurrence + render + WS コマンド登録
   - WS handler integration test (実 `/ws` サーバに `ws` クライアントで接続、9 ケース)
3. **Frontend Lint** — `cd frontend && npm run lint` (errors=0、warnings 許容)
4. **Frontend Build** — `cd frontend && npm run build`

## ライセンス

MIT
