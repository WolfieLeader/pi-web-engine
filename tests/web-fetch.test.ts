import { describe, expect, it } from "vitest";
import { convertContent, fetchWebContent } from "../src/web-fetch.js";

const html = `<!doctype html>
<html>
  <head><title>Example article</title></head>
  <body>
    <nav>Navigation</nav>
    <article><h1>Hello</h1><p>This is the useful article body.</p></article>
    <script>secret()</script>
  </body>
</html>`;

const STRUCTURED_TEXT_ACCEPT_FALLBACK =
  "application/json;q=0.3,application/*+json;q=0.3,application/xml;q=0.2," +
  "application/*+xml;q=0.2,text/javascript;q=0.1,application/javascript;q=0.1," +
  "application/x-javascript;q=0.1";

const fetchOptions = {
  format: "markdown" as const,
  signal: undefined,
  timeoutSeconds: 30,
};

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
    expect(
      convertContent("plain", "text/plain; note=text/html", "markdown", "https://example.com"),
    ).toEqual({ content: "plain" });
  });
});

describe("web fetch Accept header", () => {
  it.each([
    ["markdown", "text/markdown,text/x-markdown;q=0.9,text/html;q=0.8,text/plain;q=0.7"],
    ["text", "text/plain,text/markdown;q=0.9,text/html;q=0.8"],
    ["html", "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5"],
  ] as const)(
    "preserves %s preference with structured-text fallbacks",
    async (format, preferred) => {
      let requestHeaders = new Headers();
      await fetchWebContent("https://example.com/resource", {
        ...fetchOptions,
        fetchImplementation(_input, init) {
          requestHeaders = new Headers(init?.headers);
          return Promise.resolve(textResponse("ok", "https://example.com/resource"));
        },
        format,
      });

      expect(requestHeaders.get("accept")).toBe(`${preferred},${STRUCTURED_TEXT_ACCEPT_FALLBACK}`);
      expect(requestHeaders.get("user-agent")).toBe(
        "pi-web-engine/0.1.1 (+https://github.com/WolfieLeader/pi-web-engine)",
      );
    },
  );
});

describe("web fetch structured response", () => {
  it("accepts a GitHub-style JSON response without changing it", async () => {
    const body = '{"tag_name":"v0.1.1","prerelease":false}';
    const url = "https://api.github.com/repos/example/project/releases/latest";
    const result = await fetchWebContent(url, {
      ...fetchOptions,
      fetchImplementation(_input, init) {
        expect(new Headers(init?.headers).get("accept")).toContain("application/json;q=0.3");
        return Promise.resolve(
          responseWithUrl(
            body,
            { headers: { "Content-Type": "application/json; charset=utf-8" } },
            url,
          ),
        );
      },
    });

    expect(resultText(result)).toBe(body);
    expect(result.details.contentType).toBe("application/json; charset=utf-8");
  });
});

describe("redirected web fetch", () => {
  it("shows a sanitized final URL in model-visible output", async () => {
    const finalUrl =
      "https://github.com/example/project/releases/tag/v0.1.1?view=notes&token=redirect-secret#section";
    const responses = [
      new Response(null, { headers: { Location: finalUrl }, status: 302 }),
      responseWithUrl(
        "release notes",
        {
          headers: {
            Authorization: "Bearer response-header-secret",
            "Content-Type": "text/plain",
          },
        },
        finalUrl,
      ),
    ];
    const result = await fetchWebContent("https://github.com/example/project/releases/latest", {
      ...fetchOptions,
      fetchImplementation: createSequentialFetch(responses),
    });

    const text = resultText(result);
    expect(text).toContain(
      "Final URL after redirects: https://github.com/example/project/releases/tag/v0.1.1?view=notes&token=REDACTED",
    );
    expect(text).toContain("release notes");
    expect(text).not.toContain("redirect-secret");
    expect(text).not.toContain("response-header-secret");
    expect(text).not.toContain("#section");
    expect(result.details.finalUrl).toContain("view=notes&token=REDACTED");
  });
});

describe("direct web fetch", () => {
  it("omits provenance when the final URL did not change", async () => {
    const result = await fetchWebContent("https://example.com/page", {
      ...fetchOptions,
      fetchImplementation: () => Promise.resolve(textResponse("page", "https://example.com/page")),
    });
    expect(resultText(result)).toBe("page");
  });
});

function textResponse(body: string, url: string): Response {
  return responseWithUrl(body, { headers: { "Content-Type": "text/plain" } }, url);
}

function responseWithUrl(body: BodyInit | null, init: ResponseInit, url: string): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function createSequentialFetch(responses: readonly Response[]): typeof fetch {
  let index = 0;
  return () => {
    const response = responses[index];
    index += 1;
    return response === undefined
      ? Promise.reject(new Error("Unexpected extra request"))
      : Promise.resolve(response);
  };
}

function resultText(result: Awaited<ReturnType<typeof fetchWebContent>>): string {
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("Expected text fetch output");
  return content.text;
}
