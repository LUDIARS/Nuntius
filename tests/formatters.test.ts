/**
 * チャネル別フォーマッタの単体テスト。
 *
 * tests/ は vitest 実行を想定。各 formatter の代表的な markdown 変換と
 * 空入力・既存値保護の挙動を押さえる。
 */

import { describe, expect, test } from "vitest";
import { applyChannelFormat } from "../src/channels/formatters/index.js";
import { markdownToSlackMrkdwn } from "../src/channels/formatters/slack.js";
import { formatForSlack }   from "../src/channels/formatters/slack.js";
import { formatForDiscord, neutralizeMassMentions, truncateForDiscord } from "../src/channels/formatters/discord.js";
import { formatForLine, truncateForLine } from "../src/channels/formatters/line.js";
import { formatForSms, truncateForSms, smsLengthLimit } from "../src/channels/formatters/sms.js";
import { formatForEmail, htmlToPlainText, markdownToMinimalHtml } from "../src/channels/formatters/email.js";

describe("slack mrkdwn", () => {
  test("converts bold **x** to *x*", () => {
    expect(markdownToSlackMrkdwn("**hello** world")).toBe("*hello* world");
  });
  test("converts italic *x* to _x_ without breaking bold", () => {
    expect(markdownToSlackMrkdwn("**bold** and *italic*")).toBe("*bold* and _italic_");
  });
  test("escapes < > & and converts links", () => {
    expect(markdownToSlackMrkdwn("[Docs](https://example.com/?a=1&b=2) <not-a-tag>"))
      .toBe("<https://example.com/?a=1&amp;b=2|Docs> &lt;not-a-tag&gt;");
  });
  test("preserves text if already set in payload", () => {
    const out = formatForSlack({ body: "**bold**", text: "already-there" });
    expect(out.text).toBe("already-there");
  });
  test("fills text from body when empty", () => {
    const out = formatForSlack({ body: "**bold**" });
    expect(out.text).toBe("*bold*");
  });
});

describe("discord", () => {
  test("neutralizes @everyone / @here", () => {
    const out = neutralizeMassMentions("hi @everyone and @here");
    expect(out).not.toContain("@everyone");
    expect(out).not.toContain("@here");
  });
  test("truncates >2000 chars", () => {
    const long = "x".repeat(2100);
    const out  = truncateForDiscord(long);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out.endsWith("…")).toBe(true);
  });
  test("allows explicit @everyone when allowMassMentions=true", () => {
    const out = formatForDiscord({ body: "@everyone", allowMassMentions: true });
    expect(out.content).toContain("@everyone");
  });
  test("fills content + text from body", () => {
    const out = formatForDiscord({ body: "hello **world**" });
    expect(out.content).toBe("hello **world**");
  });
});

describe("line", () => {
  test("strips markdown", () => {
    const out = formatForLine({ body: "**bold** [link](https://x) ~~strike~~" });
    expect(out.text).toBe("bold link (https://x) strike");
  });
  test("truncates at 5000 chars", () => {
    const long = "x".repeat(5100);
    expect(truncateForLine(long).length).toBeLessThanOrEqual(5000);
  });
});

describe("sms", () => {
  test("gsm-7 ascii limit is 160", () => {
    expect(smsLengthLimit("hello world")).toBe(160);
  });
  test("non-ascii triggers ucs-2 limit 70", () => {
    expect(smsLengthLimit("こんにちは")).toBe(70);
  });
  test("truncates long gsm-7 text", () => {
    const long = "a".repeat(200);
    const out  = truncateForSms(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("…")).toBe(true);
  });
  test("strips markdown from body", () => {
    const out = formatForSms({ body: "**emergency** check app" });
    expect(out.text).toBe("emergency check app");
  });
  test("respects explicit maxLength override", () => {
    const out = truncateForSms("12345678901234567890", 10);
    expect(out.length).toBe(10);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("email", () => {
  test("generates text from html when text missing", () => {
    const out = formatForEmail({ html: "<p>Hello</p><br><p>world</p>" });
    expect(out.text).toBe("Hello\n\nworld");
  });
  test("generates html from text when html missing", () => {
    const out = formatForEmail({ text: "line 1\nline 2\n\npara 2" });
    expect(out.html).toContain("<p>");
    expect(out.html).toContain("line 1<br>line 2");
  });
  test("generates both from body", () => {
    const out = formatForEmail({ body: "**bold** [link](https://x)" });
    expect(out.text).toBe("bold link (https://x)");
    expect(out.html).toContain("<a href=\"https://x\">link</a>");
  });
  test("preserves both when already set", () => {
    const out = formatForEmail({ text: "t", html: "<p>h</p>" });
    expect(out.text).toBe("t");
    expect(out.html).toBe("<p>h</p>");
  });
  test("htmlToPlainText drops tags", () => {
    expect(htmlToPlainText("<b>hi</b>&amp;bye")).toBe("hi&bye");
  });
  test("markdownToMinimalHtml wraps paragraphs", () => {
    const h = markdownToMinimalHtml("p1\n\np2");
    expect(h).toMatch(/^<p>p1<\/p>/);
    expect(h).toContain("<p>p2</p>");
  });
});

describe("applyChannelFormat dispatch", () => {
  test("slack channel returns mrkdwn", () => {
    const out = applyChannelFormat("slack", { body: "**hi**" });
    expect(out.text).toBe("*hi*");
  });
  test("unsupported channel passes through", () => {
    const payload = { foo: "bar" };
    expect(applyChannelFormat("webhook", payload)).toBe(payload);
  });
});
