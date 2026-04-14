/**
 * スモークテスト - import が成功し、エラーなく初期化できること
 */

import { describe, it, expect } from "vitest";
import { supportedChannels, getDispatcher } from "../src/channels/index.js";
import { renderTemplate } from "../src/routes/templates.js";

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
