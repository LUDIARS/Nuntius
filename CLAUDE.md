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

## 移行ロードマップ

- **Phase 1**: 骨格実装 (queue/dispatcher/Slack/Discord/LINE)
- **Phase 2**: Schedula から `reminder` + `notification` 移管
- **Phase 3**: Imperativus 連携 (音声チャネル)
- **Phase 4**: Schedula 側のレガシー削除
