import { describe, expect, it } from "vitest";
import { normalizeDomains } from "../src/codex-search.js";
import { parseResponseStream } from "../src/codex-stream.js";

describe("normalizeDomains", () => {
  it("normalizes and deduplicates host filters", () => {
    expect(
      normalizeDomains(["Example.com", "https://example.com/path", "docs.example.com."]),
    ).toEqual(["example.com", "docs.example.com"]);
  });

  it("drops invalid filters", () => {
    expect(normalizeDomains(["", "://", "valid.example"])).toEqual(["valid.example"]);
  });
});

describe("parseResponseStream", () => {
  it("parses multiline SSE data events", async () => {
    const response = new Response(
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":\ndata: [{"type":"web_search_call"}]}}\n\ndata: [DONE]\n\n',
    );

    await expect(parseResponseStream(response)).resolves.toEqual({
      output: [{ type: "web_search_call" }],
    });
  });

  it("rejects oversized Codex responses", async () => {
    const response = new Response("x".repeat(4 * 1024 * 1024 + 1));
    await expect(parseResponseStream(response)).rejects.toThrow("Response too large");
  });
});
