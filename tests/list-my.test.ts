/**
 * `nuntius.list_my` コマンドのユニットテスト
 *
 * project_token / user_token 双方から呼び出せることと、
 * user_token では他ユーザー指定が弾かれることを検証する。DB は vi.mock で差し替える。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const scheduledRows = [
  {
    id: "msg-1",
    channel: "slack" as const,
    sendAt: new Date("2026-05-01T00:00:00Z"),
    status: "pending",
    source: "schedula",
  },
];
const inboxRows = [
  {
    id: "inb-1",
    title: "hi",
    body: "body",
    readAt: null,
    createdAt: new Date("2026-04-20T00:00:00Z"),
  },
];

const lastWhere = { scheduled: undefined as unknown, inbox: undefined as unknown };

function makeQuery(rows: unknown[], target: "scheduled" | "inbox") {
  return {
    from() { return this; },
    where(cond: unknown) {
      lastWhere[target] = cond;
      return this;
    },
    orderBy() { return this; },
    async limit() { return rows; },
  };
}

vi.mock("../src/db/connection.js", () => {
  return {
    db: {
      select: (_cols?: unknown) => {
        // 呼び出し順で scheduled → inbox を区別する
        if (!lastWhere.scheduled) {
          return makeQuery(scheduledRows, "scheduled");
        }
        return makeQuery(inboxRows, "inbox");
      },
    },
    schema: {
      scheduledMessages: {
        id: { _col: "sm.id" },
        channel: { _col: "sm.channel" },
        sendAt: { _col: "sm.send_at" },
        status: { _col: "sm.status" },
        source: { _col: "sm.source" },
        userId: { _col: "sm.user_id" },
        projectKey: { _col: "sm.project_key" },
      },
      webNotifications: {
        id: { _col: "wn.id" },
        title: { _col: "wn.title" },
        body: { _col: "wn.body" },
        readAt: { _col: "wn.read_at" },
        createdAt: { _col: "wn.created_at" },
        userId: { _col: "wn.user_id" },
        projectKey: { _col: "wn.project_key" },
      },
    },
  };
});

// drizzle-orm の eq/and は実際のロジックではなく「呼ばれたかどうか」だけ確認したい。
// 実装そのものを使っても副作用はないのでデフォルト import のまま利用する。

import { listMyMessages } from "../src/ws/commands.js";

beforeEach(() => {
  lastWhere.scheduled = undefined;
  lastWhere.inbox = undefined;
});

describe("listMyMessages", () => {
  it("project_token 経由: 任意の userId を指定できる", async () => {
    const out = await listMyMessages(
      { projectKey: "demo-proj", userId: null },
      { userId: "other-user" },
    );
    expect(out.scheduled).toHaveLength(1);
    expect(out.scheduled[0].id).toBe("msg-1");
    expect(out.inbox).toHaveLength(1);
    // projectKey 分離 WHERE が使われたことを確認 (and() が呼ばれる → object が入る)
    expect(lastWhere.scheduled).toBeTruthy();
  });

  it("user_token 経由: 自分の userId なら参照できる", async () => {
    const out = await listMyMessages(
      { projectKey: null, userId: "u-123" },
      {},
    );
    expect(out.scheduled).toHaveLength(1);
    expect(out.inbox).toHaveLength(1);
  });

  it("user_token 経由: 他ユーザー指定は forbidden になる", async () => {
    await expect(
      listMyMessages(
        { projectKey: null, userId: "u-123" },
        { userId: "someone-else" },
      ),
    ).rejects.toThrow(/forbidden/);
  });

  it("認証情報が一切無い場合はエラー", async () => {
    await expect(
      listMyMessages({ projectKey: null, userId: null }, {}),
    ).rejects.toThrow(/authentication required/);
  });

  it("includeInbox=false の場合 inbox は空で scheduled のみ取得", async () => {
    const out = await listMyMessages(
      { projectKey: null, userId: "u-123" },
      { includeInbox: false },
    );
    expect(out.scheduled).toHaveLength(1);
    expect(out.inbox).toEqual([]);
  });
});
