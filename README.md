# Nuntius

LUDIARS 統合通知・メッセージング基盤 (SQS / SNS 的) — **バックエンドサービス**。

他サービス (Schedula / Imperativus / Curare / PM 等) からの通知要求を REST / WS で受け取り、
複数チャネル (Web / Slack / Discord / LINE / Alexa / Email / SMS) に配信する。

`frontend/` は運用者向けの通知パターン管理 admin UI であり、Nuntius 本体 (バックエンド) の
補助ツール。サービス間連携は常に API 経由で行い、admin UI は通知テンプレート管理のみに使用する。

## セットアップ

### 前提条件

- **Node.js** v22 以上
- **Docker / Docker Compose**
- **Cernere** が起動済で、Nuntius 用のプロジェクトが登録済であること
  (`client_id` / `client_secret` を発行済)
- **Infisical** アカウント (`@ludiars/cernere-env-cli` で環境変数を管理)
- 共有インフラ (`../infra`) の PostgreSQL + Redis (スタンドアロン起動も可)

### 1. クローン & 依存インストール

```bash
git clone https://github.com/LUDIARS/Nuntius.git
cd Nuntius
npm install
cd frontend && npm install && cd ..
```

### 2. Cernere にプロジェクト登録

Cernere の管理画面 (または API) で Nuntius をプロジェクトとして登録し、
以下を取得する:

- `client_id` → `CERNERE_PROJECT_CLIENT_ID`
- `client_secret` → `CERNERE_PROJECT_CLIENT_SECRET`
- `project_key` → `NUNTIUS_ADMIN_PROJECT_KEY` (admin UI 用)

`project_key` は admin UI セッションを REST ルートの `projectKey` として
bind するために使用する (詳細は「admin UI と projectKey」を参照)。

### 3. 環境変数の初期化

`@ludiars/cernere-env-cli` + Infisical で管理する。

```bash
# 初回: Infisical 認証
npm run env:setup

# env-cli.config.ts のデフォルト値を Infisical に登録 (未存在のみ)
npm run env:initialize

# 接続テスト
npm run env:test
```

Infisical ダッシュボードで以下の値を編集する:

| キー | 用途 |
|------|------|
| `CERNERE_URL` | Cernere の base URL |
| `CERNERE_PROJECT_CLIENT_ID` | 手順 2 で取得 |
| `CERNERE_PROJECT_CLIENT_SECRET` | 手順 2 で取得 |
| `NUNTIUS_ADMIN_PROJECT_KEY` | 手順 2 で取得 (admin UI bind 用) |
| `JWT_SECRET` | service_token 署名鍵 (ランダムな強力な値に変更) |
| `DATABASE_URL` | PostgreSQL 接続文字列 |
| `REDIS_URL` | Redis 接続 URL |

optional (チャネル別):

| キー | 用途 |
|------|------|
| `SMTP_URL` / `SMTP_FROM` | Email チャネル (nodemailer) |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | SMS (AWS SNS) |
| `ALEXA_CLIENT_ID` / `ALEXA_CLIENT_SECRET` | Alexa Proactive Events |
| `SLACK_DEFAULT_WEBHOOK_URL` / `DISCORD_DEFAULT_WEBHOOK_URL` / `LINE_CHANNEL_ACCESS_TOKEN` | 各チャネルのデフォルト送信先 |

未設定のチャネルは **dev モード** (ログ出力のみで success) にフォールバックする。

### 4. データベース初期化

PostgreSQL に対して Drizzle のマイグレーションを流す:

```bash
# 共有インフラ利用の場合
cd ../infra && docker compose up -d && cd -

# スキーマ同期 (DDL を直接反映)
npm run db:push

# or マイグレーションファイル経由
npm run db:generate
npm run db:migrate
```

### 5. 開発サーバー起動

#### 共有インフラを使う場合

```bash
npm run dev          # API (3100) + worker をホットリロードで同時起動
```

```bash
cd frontend
npm run dev          # admin UI (5175) → backend 3100 を proxy
```

#### スタンドアロン (DB + Redis 込み)

```bash
npm run env:up:standalone
```

### 6. 動作確認

```bash
# ヘルスチェック (認証不要)
curl http://localhost:3100/api/health

# admin UI
open http://localhost:5175
```

admin UI が表示されたら email + password でログインするか、
"Cernere でログイン" ボタンで popup 認証を使用する。
ログイン成功後、`nuntius_token` Cookie が発行され、以降の
`/api/templates` 等にアクセス可能となる。

### admin UI と projectKey

Nuntius の REST ルートはすべて `projectKey` を必須とする。
admin UI (Composite) ログイン時、Nuntius backend は
`service_token` の中で role=admin のユーザーに対して
`NUNTIUS_ADMIN_PROJECT_KEY` を `projectKey` として紐付ける。

これにより、admin ロールのユーザーは WS トークン (project_token) を
発行せずに REST ルートにアクセスできる。一般ユーザーの user_token
だけでは `project context required` エラーとなる。

### CI / テスト

```bash
bash scripts/ci-check.sh
```

4 段を順に実行する:

1. **Backend Build** — `npm run build` (tsc)
2. **Backend Tests** — `npm test` (vitest)
3. **Frontend Lint** — `cd frontend && npm run lint`
4. **Frontend Build** — `cd frontend && npm run build`

GitHub Actions とローカル pre-push hook が同じスクリプトを呼ぶ。

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
