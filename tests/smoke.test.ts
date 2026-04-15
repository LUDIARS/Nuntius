/**
 * スモークテスト - import が成功し、エラーなく初期化できること
 */

import { describe, it, expect } from "vitest";
import { supportedChannels, getDispatcher } from "../src/channels/index.js";
import { renderTemplate, renderPattern } from "../src/routes/templates.js";
import { computeNextSendAt, isValidRecurrenceRule } from "../src/queue/recurrence.js";
import { registerNuntiusCommands } from "../src/ws/register-commands.js";
import { listCommands } from "../src/ws/dispatcher.js";

describe("Nuntius smoke", () => {
  it("supportedChannels に全チャネルが含まれる", () => {
    const channels = supportedChannels();
    expect(channels).toContain("slack");
    expect(channels).toContain("discord");
    expect(channels).toContain("line");
    expect(channels).toContain("webhook");
    expect(channels).toContain("email");
    expect(channels).toContain("voice");
    expect(channels).toContain("alexa");
    expect(channels).toContain("sms");
    expect(channels).toContain("web");
  });

  it("各チャネルに dispatcher が紐付いている", () => {
    for (const ch of supportedChannels()) {
      const d = getDispatcher(ch);
      expect(d).not.toBeNull();
      expect(d?.channel).toBe(ch);
    }
  });
});

describe("renderTemplate", () => {
  it("プレースホルダを置換する", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" }))
      .toBe("Hello World!");
  });

  it("値が無い場合は空文字に置換", () => {
    expect(renderTemplate("X={{x}}, Y={{y}}", { x: "1" }))
      .toBe("X=1, Y=");
  });

  it("数値も文字列化される", () => {
    expect(renderTemplate("count: {{n}}", { n: 42 }))
      .toBe("count: 42");
  });
});

describe("renderPattern (通知パターン)", () => {
  const basePattern = {
    subject: "Hello {{name}}",
    body: "Hi {{name}}, ping {{@alice}} please",
    mentions: [
      {
        key: "alice",
        label: "Alice",
        channelValues: { slack: "<@U123>", discord: "<@999>" },
      },
    ],
  };

  it("values を差し込み、channel に合わせて mention を解決する (slack)", () => {
    const r = renderPattern(basePattern, { values: { name: "Bob" }, channel: "slack" });
    expect(r.subject).toBe("Hello Bob");
    expect(r.body).toBe("Hi Bob, ping <@U123> please");
  });

  it("別チャネルでは別の mention 値を使う (discord)", () => {
    const r = renderPattern(basePattern, { values: { name: "Bob" }, channel: "discord" });
    expect(r.body).toBe("Hi Bob, ping <@999> please");
  });

  it("channel 未対応の mention は label にフォールバック", () => {
    const r = renderPattern(basePattern, { values: { name: "Bob" }, channel: "line" });
    expect(r.body).toBe("Hi Bob, ping Alice please");
  });

  it("extraMentions は pattern の mentions を上書きできる", () => {
    const r = renderPattern(basePattern, {
      values: { name: "Bob" },
      channel: "slack",
      extraMentions: [{ key: "alice", label: "A", channelValues: { slack: "<@OVERRIDE>" } }],
    });
    expect(r.body).toBe("Hi Bob, ping <@OVERRIDE> please");
  });

  it("未知の mention key は空文字に置換", () => {
    const r = renderPattern(
      { subject: null, body: "ping {{@unknown}} end", mentions: [] },
      { values: {} },
    );
    expect(r.body).toBe("ping  end");
  });
});

describe("recurrence", () => {
  it("cron 式 (daily) を解釈して未来時刻を返す", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const next = computeNextSendAt("0 12 * * *", base);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(base.getTime());
  });

  it("エイリアス daily を受け付ける", () => {
    const base = new Date("2026-01-01T12:30:00Z");
    const next = computeNextSendAt("daily", base);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(base.getTime());
  });

  it("every:15m で 15 分後を返す", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const next = computeNextSendAt("every:15m", base);
    expect(next).not.toBeNull();
    expect(next!.getTime() - base.getTime()).toBe(15 * 60_000);
  });

  it("every:2h で 2 時間後を返す", () => {
    const base = new Date("2026-01-01T00:00:00Z");
    const next = computeNextSendAt("every:2h", base);
    expect(next).not.toBeNull();
    expect(next!.getTime() - base.getTime()).toBe(2 * 60 * 60_000);
  });

  it("無効なルールは null を返す", () => {
    expect(computeNextSendAt("not-a-cron")).toBeNull();
    expect(isValidRecurrenceRule("xyz")).toBe(false);
    expect(isValidRecurrenceRule("daily")).toBe(true);
    expect(isValidRecurrenceRule("0 0 * * *")).toBe(true);
    expect(isValidRecurrenceRule("every:5m")).toBe(true);
  });
});

describe("WS コマンド登録", () => {
  it("registerNuntiusCommands で nuntius.* が全て登録される", () => {
    registerNuntiusCommands();
    const commands = listCommands().filter((c) => c.module === "nuntius");
    const actions = commands.map((c) => c.action).sort();
    expect(actions).toEqual(["cancel", "list_my", "publish", "schedule", "subscribe"]);
  });

  it("二度呼んでも重複登録されない (idempotent)", () => {
    registerNuntiusCommands();
    registerNuntiusCommands();
    const count = listCommands().filter((c) => c.module === "nuntius").length;
    expect(count).toBe(5);
  });
});
