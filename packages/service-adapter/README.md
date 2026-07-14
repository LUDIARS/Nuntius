# @ludiars/nuntius-service-adapter

LUDIARS の各サービス (Actio / Imperativus 等) から Nuntius (通知基盤) を叩くための薄いクライアント。

## 何をするか

- Cernere の `project_credentials` grant で project token を取得 (内部 cache + 自動 refresh)
- その token で Nuntius の REST API を `Bearer` 認証で呼び出し
- 401 時は 1 回だけ自動再ログイン

## インストール

```bash
npm install @ludiars/nuntius-service-adapter
```

## 使い方

```ts
import { NuntiusClient } from "@ludiars/nuntius-service-adapter";

const nuntius = new NuntiusClient({
  nuntiusBaseUrl: process.env.NUNTIUS_URL!,         // 例: http://localhost:3100
  cernereBaseUrl: process.env.CERNERE_URL!,         // 例: http://localhost:8080
  projectId:     process.env.CERNERE_PROJECT_CLIENT_ID!,
  projectSecret: process.env.CERNERE_PROJECT_CLIENT_SECRET!,
});

// 即時通知
await nuntius.schedule({
  userId: "user-uuid",
  channel: "discord_bot",
  payload: { content: "Hello {{name}}", credentialName: "default" },
});

// 通知パターンを使用 (template id で本文 / mention 等を解決)
await nuntius.schedule({
  userId: "user-uuid",
  channel: "discord_bot",
  templateId: "tpl_xxx",
  payload: { values: { name: "Alice" } },
});

// topic にファンアウト
await nuntius.publish({ topic: "incident.opened", payload: { content: "🔥 ..." } });

// in-app inbox
const { items } = await nuntius.inbox("user-uuid", { unreadOnly: true });
```

## 環境変数

| 変数 | 用途 |
|------|------|
| `NUNTIUS_URL` | Nuntius backend URL |
| `CERNERE_URL` | Cernere backend URL (project login) |
| `CERNERE_PROJECT_CLIENT_ID` | 各サービスの Cernere project credentials |
| `CERNERE_PROJECT_CLIENT_SECRET` | 同 secret |

`CERNERE_PROJECT_*` は呼び出し側サービスごとに発行する (Actio 用 / Imperativus 用 がそれぞれ別の id/secret)。

## API

| メソッド | エンドポイント | 用途 |
|---------|--------------|------|
| `schedule(input)` | `POST /api/messages/schedule` | message を schedule |
| `cancelScheduled(id)` | `POST /api/messages/:id/cancel` | キャンセル |
| `publish(input)` | `POST /api/topics/:topic/publish` | topic に publish |
| `subscribe(input)` | `POST /api/topics/:topic/subscribe` | topic を subscribe |
| `inbox(userId, opts?)` | `GET /api/inbox?userId=...` | in-app 通知一覧 |
| `markInboxRead(id)` | `POST /api/inbox/:id/read` | 既読化 |
| `health()` | `GET /api/health` | 死活チェック (auth 不要) |
