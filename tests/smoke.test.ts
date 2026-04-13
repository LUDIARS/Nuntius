/**
 * スモークテスト - import が成功し、エラーなく初期化できること
 */

import { describe, it, expect } from "vitest";
import { supportedChannels, getDispatcher } from "../src/channels/index.js";

describe("Nuntius smoke", () => {
  it("supportedChannels に Slack/Discord/LINE/Webhook が含まれる", () => {
    const channels = supportedChannels();
    expect(channels).toContain("slack");
    expect(channels).toContain("discord");
    expect(channels).toContain("line");
    expect(channels).toContain("webhook");
  });

  it("各チャネルに dispatcher が紐付いている", () => {
    for (const ch of supportedChannels()) {
      const d = getDispatcher(ch);
      expect(d).not.toBeNull();
      expect(d?.channel).toBe(ch);
    }
  });

  it("未サポートチャネルは null を返す", () => {
    expect(getDispatcher("voice")).toBeNull();
  });
});
