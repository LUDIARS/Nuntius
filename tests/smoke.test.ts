/**
 * スモークテスト - import が成功し、エラーなく初期化できること
 */

import { describe, it, expect } from "vitest";
import { supportedChannels, getDispatcher } from "../src/channels/index.js";
import { renderTemplate } from "../src/routes/templates.js";
import { computeNextSendAt, isValidRecurrenceRule } from "../src/queue/recurrence.js";

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
