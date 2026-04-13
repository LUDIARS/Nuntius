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

## ライセンス

MIT
