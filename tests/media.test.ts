/**
 * メディア添付ユーティリティの単体テスト。
 *
 * I/O を伴わない純粋関数 (attachment / limits / url-guard) の挙動を押さえる。
 * storage / resolve / routes は DB・S3 が要るためここでは対象外。
 */

import { describe, expect, test } from "vitest";
import {
  isMediaKind,
  parseAttachments,
  dispatchableAttachments,
  defaultMime,
} from "../src/media/attachment.js";
import { validateUpload, channelSupport, KIND_MAX_BYTES } from "../src/media/limits.js";
import { isSafeFetchUrl, assertSafeFetchUrl } from "../src/media/url-guard.js";

describe("isMediaKind", () => {
  test("accepts the 4 kinds", () => {
    expect(isMediaKind("image")).toBe(true);
    expect(isMediaKind("video")).toBe(true);
    expect(isMediaKind("audio")).toBe(true);
    expect(isMediaKind("file")).toBe(true);
  });
  test("rejects anything else", () => {
    expect(isMediaKind("gif")).toBe(false);
    expect(isMediaKind(123)).toBe(false);
    expect(isMediaKind(undefined)).toBe(false);
  });
});

describe("parseAttachments", () => {
  test("returns [] when attachments is absent or not an array", () => {
    expect(parseAttachments({})).toEqual([]);
    expect(parseAttachments({ attachments: "x" })).toEqual([]);
  });

  test("keeps a valid url attachment", () => {
    const out = parseAttachments({
      attachments: [{ kind: "image", url: "https://cdn.example.com/a.png" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://cdn.example.com/a.png");
    expect(out[0].mediaId).toBeUndefined();
  });

  test("keeps a valid mediaId attachment", () => {
    const out = parseAttachments({
      attachments: [{ kind: "file", mediaId: "abc-123" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].mediaId).toBe("abc-123");
  });

  test("drops exactly-one violations (0 or 2 sources) and bad kinds", () => {
    const out = parseAttachments({
      attachments: [
        { kind: "image" }, // 0 source
        { kind: "image", url: "https://x/y", mediaId: "z" }, // 2 sources
        { kind: "sticker", url: "https://x/y" }, // bad kind
        { kind: "video", url: "https://x/v.mp4" }, // ok
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("video");
  });
});

describe("dispatchableAttachments", () => {
  test("returns only attachments that already have a usable url", () => {
    const out = dispatchableAttachments({
      attachments: [
        { kind: "image", url: "https://x/a.png" },
        { kind: "file", mediaId: "still-unresolved" },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://x/a.png");
  });

  test("fills mimeType from defaultMime when missing", () => {
    const out = dispatchableAttachments({
      attachments: [{ kind: "audio", url: "https://x/a.mp3" }],
    });
    expect(out[0].mimeType).toBe(defaultMime("audio"));
  });
});

describe("validateUpload", () => {
  test("accepts a normal image", () => {
    expect(validateUpload("image", "image/png", 1024)).toBeNull();
  });
  test("rejects a mime that does not match the kind", () => {
    expect(validateUpload("image", "video/mp4", 1024)).toMatch(/not allowed/);
  });
  test("rejects oversize relative to the kind limit", () => {
    expect(validateUpload("image", "image/png", KIND_MAX_BYTES.image + 1)).toMatch(/exceeds/);
  });
});

describe("channelSupport", () => {
  test("email supports native file attachment", () => {
    expect(channelSupport("email", "file")).toBe("native");
  });
  test("line handles media via url", () => {
    expect(channelSupport("line", "image")).toBe("url");
  });
  test("alexa cannot carry media", () => {
    expect(channelSupport("alexa", "image")).toBe("none");
  });
});

describe("url-guard (SSRF)", () => {
  test("allows public https URLs", () => {
    expect(isSafeFetchUrl("https://cdn.example.com/a.png")).toBe(true);
  });
  test("blocks loopback / private / link-local", () => {
    expect(isSafeFetchUrl("http://localhost/x")).toBe(false);
    expect(isSafeFetchUrl("http://127.0.0.1/x")).toBe(false);
    expect(isSafeFetchUrl("http://10.0.0.1/x")).toBe(false);
    expect(isSafeFetchUrl("http://192.168.1.1/x")).toBe(false);
    expect(isSafeFetchUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
  });
  test("blocks non-http schemes", () => {
    expect(isSafeFetchUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeFetchUrl("ftp://example.com/x")).toBe(false);
  });
  test("assertSafeFetchUrl throws on blocked targets", () => {
    expect(() => assertSafeFetchUrl("http://127.0.0.1")).toThrow();
  });
});
