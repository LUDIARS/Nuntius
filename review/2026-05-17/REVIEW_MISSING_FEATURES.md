# 不足機能評価 — Nuntius (2026-05-17)

## 1. 機能改善提案

| 対象機能 | 改善提案 | 期待効果 | 優先度 |
|---------|---------|---------|--------|
| WebPush 配信 | Promise.allSettled で並列化 (current: 直列 await) | p99 latency O(n*p99) → O(p99) | High |
| Media URL resolve | passthrough url に SSRF ガード追加 (isSafeFetchUrl) | SSRF 脆弱性 High → Low | High |
| Delivery logs | エラーメッセージ truncate ポリシー明示 | 診断時の情報保全 | Medium |
| Template rendering | テンプレート preview endpoint | admin UI でレンダリングテスト | Medium |
| Admin UI | media asset list / delete UI | media lifecycle 可視化 | Medium |

## 2. 不足機能の提案

| 提案機能 | 必要性 | 優先度 | 想定影響範囲 |
|---------|--------|--------|------------|
| 依存 CVE scan (npm audit) | CI 未統合 | High | CI/CD pipeline |
| Media cleanup (TTL 実装) | media_assets.expiresAt あり、cleanup job 無し | High | Worker / Cron |
| Credential rotation | refresh / rotate endpoint なし | High | Routes |
| Email header customization | sender / bcc / reply-to | Medium | Email dispatcher |
| DeliveryLog query filter | status / channel / date range 絞り込み無し | Medium | Routes |
| Webhook signature verification | HMAC-SHA256 | High | Security |

## 総合評価

| # | 観点 | 指摘数 | 優先度別 |
|---|------|--------|---------|
| 1 | 機能改善 | 5 | High: 2 / Medium: 3 |
| 2 | 不足機能 | 6 | High: 4 / Medium: 2 |

**加重評価: C**
