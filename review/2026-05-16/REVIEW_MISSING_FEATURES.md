# 不足機能評価 — Nuntius

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Nuntius |
| 対象ブランチ / PR | main (feat(media): PR#14) |
| レビュー実施日 | 2026-05-16 |

---

## 機能改善案

| # | タイトル | 優先度 | 実装難易度 | ROI | 説明 |
|---|---------|--------|----------|-----|------|
| 1 | メディア DELETE の論理削除オプション | 高 | 中 | 高 | 現在は `DELETE /api/media/:id` で物理削除。監査・コンプライアンス要件のある環境では論理削除 (deleted_at flag) が必要 |
| 2 | トピック購読の endpoint 有効性定期バリデーション | 高 | 中 | 高 | topicSubscriptions.endpoint が無効になった場合 (dead Webhook / Slack workspace 削除等)、 蓄積したままになる |
| 3 | チャネル別の recurrence rule 制限マニュアル | 中 | 低 | 中 | cron-parser で任意の recurrence を許可しているが、 SMS / Email は秒単位実行は不可。 routing validation 必要 |
| 4 | パフォーマンス SLO dashboard | 中 | 中 | 中 | queue backlog depth、 dispatcher latency (p50/p99)、 delivery success rate を可視化する admin UI |

---

## 不足機能

| # | タイトル | 優先度 | 説明 | 対応案 |
|---|---------|--------|------|--------|
| 1 | VAPID キーローテーション | 高 | 現在 VAPID 鍵は環境変数から一度読み込んで固定 | Admin API `POST /api/admin/vapid-rollover` を追加。既存鍵での通知は古い鍵で復号可能にする段階的切り替え |
| 2 | メディア TTL 監視 / 削除ツール | 中 | `media_assets.expires_at` で自動削除設計は OK だが、 削除前の通知・監査ログが missing | `GET /api/admin/media-expiry-report` endpoint + frontend notification component |

---

## 推奨実装順序

1. **VAPID キーローテーション** (セキュリティ重大)
2. **endpoint バリデーション cleanup job** (data integrity)
3. **チャネル別 recurrence rule 検証** (ユーザエラー防止)
4. **論理削除オプション** (運用便利)
5. **SLO dashboard** (可視性向上)

---

## 総合評価

| 観点 | 評価 | 説明 |
|------|------|------|
| 機能改善案 | 3 件 | 実装難易度は低〜中。3 ヶ月以内での完成が現実的 |
| 不足機能 | 2 件 (1 critical) | VAPID rotation は必須。TTL 監視は optional だが UX 向上 |
