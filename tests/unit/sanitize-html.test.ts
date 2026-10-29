// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  htmlToPlainText,
  plainTextToHtml,
  sanitizeHtml,
  sanitizeLinkUrl,
} from "../../src/shared/sanitize-html";

describe("rich snippet HTML sanitizer", () => {
  it("keeps allowed formatting and safe links while removing active content", () => {
    const safe = sanitizeHtml(
      '<p onclick="steal()"><strong>Welcome</strong> <a href="javascript:alert(1)" target="_blank">unsafe</a> <a href="https://example.com" onclick="steal()">site</a><img src="https://tracker.test/pixel"><script>alert(1)</script></p>',
      document,
    );

    expect(safe).toBe(
      '<p><strong>Welcome</strong> <a>unsafe</a> <a href="https://example.com/" rel="noopener noreferrer">site</a></p>',
    );
    expect(safe).not.toMatch(/onclick|javascript:|script|img|target=/i);
  });

  it("converts rich blocks and line breaks to plain text", () => {
    expect(
      htmlToPlainText(
        "<p>First <em>line</em></p><p>Second<br>third</p>",
        document,
      ),
    ).toBe("First line\nSecond\nthird");
  });

  it("escapes plain text when switching a snippet to rich format", () => {
    expect(plainTextToHtml("<hello> & goodbye\nnext", document)).toBe(
      "&lt;hello&gt; &amp; goodbye<br>next",
    );
  });

  it("only accepts absolute links using supported protocols", () => {
    expect(sanitizeLinkUrl("mailto:team@example.com")).toBe(
      "mailto:team@example.com",
    );
    expect(sanitizeLinkUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeLinkUrl("//example.com/path")).toBeUndefined();
  });
});
