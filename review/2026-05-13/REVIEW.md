# Nuntius コードレビュー (2026-05-13)

対象: LUDIARS/Nuntius (Web Push を含む統合通知基盤、Hono + BullMQ + Drizzle)。
本レビューでは Web Push 中継経路 (VAPID 鍵管理 / 不正 publisher 防止 / subscription endpoint 信頼境界) を主観点に、AIFormat の 5 テンプレに沿って評価した。

## 総合評価

| 軸 | 評価 |
|----|------|
| Design       | B |
| Vulnerability| C |
| Implementation | B |
| Missing Features | C |
| Quality | B |

加重スコア: **2.55 / 4.00** (重み: Vuln 0.30, Impl 0.25, Missing 0.20, Design 0.15, Quality 0.10、A=4 B=3 C=2 D=1)。

## 主要所見 (要約)

- VAPID 秘密鍵は Infisical で外出し設計だが、 `webpush.ts:34-47` のロード処理がプロセス起動時に 1 度だけ判定し、`vapidConfigured=false` でラッチするため、 鍵ローテーション時に worker 再起動が必須 (運用注意 / 設計B)。
- `db/schema.ts:225-256` のコメントが `endpoint / p256dh / auth` を「encrypted」と称するが、 `routes/push.ts:86-95` と `channels/webpush.ts:94-98` は素のまま insert / read している。 `crypto/secret.ts` の AES-GCM ユーティリティが push subscription に対しては未配線で、 個人データ非保管原則と仕様コメントから乖離 (脆弱性Cの主因)。
- `POST /api/push/subscriptions` (`routes/push.ts:44-97`) は projectKey 認証のみで body の `endpoint` URL を完全信頼する。 自由文字列 URL を後段の `webpush.sendNotification` (`channels/webpush.ts:94-98`) が叩くため、 悪意ある publisher が `endpoint = http://internal:8080/...` を登録すると SSRF を誘発しうる (脆弱性: 高)。 schemeホスト allowlist (FCM / APNs / Mozilla autopush) 必須。
- `routes/push.ts:34-41` の `/vapid-public-key` は認証不要だが、 同エンドポイントは `process.env.VAPID_PUBLIC_KEY` をそのまま返すだけで keyId 表示や rotate 情報が無く、 公開鍵更新時にクライアントの古い購読を invalidate する経路が無い (Missing C)。
- 配信ループ (`webpush.ts:92-115`) は 1 ユーザの全端末を直列 `await` で叩く。 端末数が多い tenant では p99 が膨らむ + 1 端末ハング時に全体ブロック。 `Promise.allSettled` + 同時実行上限が妥当 (Quality / Impl)。
- `routes/push.ts:60-83` の renew 経路は `existing.projectKey` を検証せず、 別 project でも同一 (userId, endpoint) があると上書きする可能性がある (unique index は `(userId, endpoint)` のみ、`projectKey` を含まない: `schema.ts:254`)。 tenant 越境のリスク (脆弱性: 中)。

## ファイル一覧

- REVIEW.md (このファイル)
- REVIEW_DESIGN.md
- REVIEW_VULNERABILITY.md
- REVIEW_IMPLEMENTATION.md
- REVIEW_MISSING_FEATURES.md
- REVIEW_QUALITY.md
- AUTOFIX.md (列挙のみ、autofix_count=0)
- latest.json
