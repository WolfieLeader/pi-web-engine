import { describe, expect, it } from "vitest";
import { convertContent } from "../src/web-fetch.js";

const html = `<!doctype html>
<html>
  <head><title>Example article</title></head>
  <body>
    <nav>Navigation</nav>
    <article><h1>Hello</h1><p>This is the useful article body.</p></article>
    <script>secret()</script>
  </body>
</html>`;

describe("convertContent", () => {
  it("extracts readable markdown from HTML", () => {
    const result = convertContent(
      html,
      "text/html; charset=utf-8",
      "markdown",
      "https://example.com",
    );
    expect(result.title).toBe("Example article");
    expect(result.content).toContain("# Hello");
    expect(result.content).toContain("useful article body");
    expect(result.content).not.toContain("secret()");
  });

  it("removes non-content elements from text output", () => {
    const result = convertContent(html, "text/html", "text", "https://example.com");
    expect(result.content).toContain("Hello");
    expect(result.content).not.toContain("secret()");
  });

  it("does not transform non-HTML content", () => {
    expect(
      convertContent('{"ok":true}', "application/json", "markdown", "https://example.com"),
    ).toEqual({ content: '{"ok":true}' });
  });
});
