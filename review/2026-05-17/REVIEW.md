# Nuntius コードレビュー (2026-05-17)

対象: LUDIARS/Nuntius (統合通知・メッセージング基盤、Hono + BullMQ + PostgreSQL + Drizzle)。
前回レビュー: 2026-05-13 (VAPID・WebPush セキュリティ重視)。
本期間コミット: 1 件 (72f3bb4, feat(media): 全チャネルへの画像/動画/ファイル添付対応)。

## 総合評価

| 軸 | 評価 | 重大指摘数 |
|----|------|----------|
| Design | B | 0 |
| Vulnerability | B | 1 |
| Implementation | B | 0 |
| Missing Features | C | 1 |
| Quality | B | 0 |

加重スコア: **3.10 / 4.00** (重み: Vuln 0.30, Impl 0.25, Missing 0.20, Design 0.15, Quality 0.10)

## 主要所見 (本期間)

メディア添付機能の実装は概ね堅牢で、SSRF ガード・パストラバーサル対策・idempotency 完備。

1. **SSRF ガード強度 (High)**: `media/resolve.ts` の passthrough URL が `resolveAttachmentsInPayload` 経由で dispatcher へ流れる際、SSRF ガード未配線。worker 側で 外部 URL の `url` フィールド検証を依存。
2. **テストカバレッジ限定**: 新規 18 ケースは純粋関数 (parseAttachments / validateUpload / url-guard) に限定。integration test 無し。
3. **設計の一貫性 (B)**: media_assets.projectKey scope 適切だが、worker が projectKey 検証、dispatcher が再検証しない。

## 前回指摘の進捗

- ✓ VAPID 鍵未設定時の graceful fallback 継続
- △ Web Push subscription endpoint 暗号化 未配線 (継続)
- ✓ メディア SSRF ガード新規実装 (url-guard.ts) — ただし passthrough URL の事前検証は不足
