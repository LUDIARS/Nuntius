# REVIEW_QUALITY — Nuntius (2026-05-13)

評価: **B**

## 良い点

- TypeScript strict + Drizzle の型推論で push routes (`routes/push.ts`) / channels (`channels/webpush.ts`) ともランタイムキャストはほぼ無く、 `as` は payload の `Record<string, unknown>` 取り出し時のみ。
- CI スクリプト (`scripts/ci-check.sh`、`README.md:142-153`) で backend build / test / frontend lint / build を一括化、 GitHub Actions と pre-push hook で同じパスを通す方針が明示。
- ログタグ `[webpush] / [worker] / [http-error]` (例: `webpush.ts:40`, `worker.ts:99`, `app.ts:58-60`) が一貫し grep しやすい。
- crypto ヘルパ (`crypto/secret.ts`) が AES-GCM + envelope (`{v, iv, ct, tag}`) で正しく書かれており、 配線さえ通せば V-2 を解消できる土台がある。

## 改善点

1. **schema コメントと実装の不一致** — `db/schema.ts:225-256` の「暗号化される」記載が偽広告状態。 コードベースは正、 ドキュメントは負を生む。 まずどちらかに揃える decision が必要。
2. **`as never` パターンの常用** — `middleware/auth.ts:34-63` で `c.set("projectKey" as never, ...)` を多用。 Hono の `Variables` 型を `Hono<{ Variables: { projectKey?: string; ... } }>` で宣言すれば回避可能で、 ヘルパ (`getProjectKey` 等) の型安全性も上がる。
3. **ENV 検証の遅延** — `webpush.ts:33-47` のような lazy 検証は良いが、 `process.env.VAPID_SUBJECT ?? "mailto:admin@example.com"` のフォールバックが production で意図に反する送信元を発露させ得る。 起動時に必須/任意を `env-cli.config.ts` で declare し、 production 起動時に欠落をエラーにしたい。
4. **テスト不足** — `tests/` (smoke / formatters / ws-integration / crypto / service-adapter) に push 専用テストが見当たらず、 endpoint allowlist や 410-revoke の挙動が unit でカバーされていない。 `web-push` を mock した dispatcher テストを追加すべき。
5. **コメント言語** — 日本語コメントが主だが、 一部 (`webpush.ts:109`) では半角/全角混在の punctuation。 lint には引っかからないが review 時のノイズ。
6. **DRY** — `routes/push.ts:101-126` の subscription select / `notify.ts:152-160` の subscription select / `webpush.ts:65-73` の subscription select で同じ 3 条件 (userId, projectKey, revokedAt is null) を 3 箇所に重複。 `db/queries/push.ts` (or repository) に集約する余地。
7. **エラーレスポンスの統一** — `routes/push.ts` は `{ error: string }`、 `notify.ts` は `{ error, triedChannels? }`、 worker は console.warn のみ。 admin UI が機械的に解釈する error code (e.g. `code: "no_subscription"`) を共通化したい。
8. **VAPID_SUBJECT のフォーマット検証なし** — `webpush.ts:38` は `mailto:` か `https://` 必須だが、 不正値時の挙動が web-push lib 任せ。 起動時に regex 検証すべき。

## まとめ

CI / 型 / ログの基礎が整っており B。 schema-doc 一致と env 検証強化、 重複クエリ集約で A。
