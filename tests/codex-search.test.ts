import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  createCodexHeaders,
  createSearchRequestBody,
  normalizeDomains,
  redactSensitiveText,
} from "../src/codex-request.js";
import {
  assertOfficialCodexModel,
  formatSearchResult,
  requestCodexSearch,
} from "../src/codex-search.js";

describe("normalizeDomains", () => {
  it("normalizes and deduplicates host filters", () => {
    expect(
      normalizeDomains(["Example.com", "https://example.com/path", "docs.example.com."]),
    ).toEqual(["example.com", "docs.example.com"]);
  });

  it("normalizes internationalized domains", () => {
    expect(normalizeDomains(["bücher.example"])).toEqual(["xn--bcher-kva.example"]);
  });

  it("drops invalid or unsafe filters", () => {
    expect(
      normalizeDomains([
        "",
        "://",
        "localhost",
        "127.0.0.1",
        "foo_bar.example",
        "-.example.com",
        "https://user:pass@example.com",
        "https://example.com:8443",
        "valid.example",
      ]),
    ).toEqual(["valid.example"]);
  });
});

describe("official Codex model validation", () => {
  it.each(["gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.5", "gpt-5.6-luna"])(
    "accepts official provider model %s without a model-name allowlist",
    (modelId) => {
      expect(() => {
        assertOfficialCodexModel(createCodexModel(modelId));
      }).not.toThrow();
    },
  );

  it("rejects a non-official endpoint", () => {
    const model = createCodexModel("gpt-5.5");
    model.baseUrl = "https://example.com/backend-api";
    expect(() => {
      assertOfficialCodexModel(model);
    }).toThrow("official ChatGPT endpoint");
  });
});

describe("Codex standalone search request body", () => {
  it("matches the official Codex alpha search contract", () => {
    expect(
      createSearchRequestBody("session-id", "gpt-5.6-luna", "latest news", ["openai.com"]),
    ).toEqual({
      commands: {
        response_length: "long",
        search_query: [{ q: "latest news" }],
      },
      id: "session-id",
      input: "latest news",
      max_output_tokens: 12_000,
      model: "gpt-5.6-luna",
      settings: {
        allowed_callers: ["direct"],
        external_web_access: true,
        filters: { allowed_domains: ["openai.com"] },
      },
    });
  });
});

describe("Codex standalone search transport", () => {
  it("posts to the official endpoint and preserves opaque result fields", async () => {
    const payload = await runSearchRequest((input, init) => {
      expect(input).toBe("https://chatgpt.com/backend-api/codex/alpha/search");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(
        JSON.stringify(
          createSearchRequestBody("session-id", "gpt-5.4", "official Codex tests", []),
        ),
      );
      return Promise.resolve(
        Response.json({
          encrypted_output: "ciphertext",
          output: "search result",
          results: [
            {
              future_field: { preserved: true },
              ref_id: "turn0search0",
              type: "text_result",
              url: "https://example.com/result",
            },
          ],
        }),
      );
    });

    expect(payload.output).toBe("search result");
    expect(payload.results).toEqual([
      {
        future_field: { preserved: true },
        ref_id: "turn0search0",
        type: "text_result",
        url: "https://example.com/result",
      },
    ]);
  });

  it("accepts older responses without structured results", async () => {
    const payload = await runSearchRequest(() =>
      Promise.resolve(Response.json({ encrypted_output: null, output: "search result" })),
    );
    expect(payload.results).toBeUndefined();
  });
});

describe("Codex standalone search response validation", () => {
  it("preserves supported empty structured results", async () => {
    const payload = await runSearchRequest(() =>
      Promise.resolve(
        Response.json({ encrypted_output: null, output: "search result", results: [] }),
      ),
    );
    expect(payload.results).toEqual([]);
  });

  it("rejects malformed and oversized responses", async () => {
    await expect(
      runSearchRequest(() =>
        Promise.resolve(Response.json({ encrypted_output: null, output: "result", results: {} })),
      ),
    ).rejects.toThrow("Parse");
    await expect(
      runSearchRequest(() => Promise.resolve(new Response("x".repeat(4 * 1024 * 1024 + 1)))),
    ).rejects.toThrow("Response too large");
  });

  it("redacts reflected credentials in provider errors", async () => {
    await expect(
      runSearchRequest(() => Promise.resolve(new Response("rejected test-token", { status: 401 }))),
    ).rejects.toThrow("rejected [redacted]");
  });
});

describe("Codex standalone search authentication", () => {
  it("builds the required ChatGPT authentication headers", () => {
    const token = createToken("account-123");
    const headers = createCodexHeaders(undefined, undefined, token);

    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("chatgpt-account-id")).toBe("account-123");
    expect(headers.get("originator")).toBe("pi");
    expect(headers.get("user-agent")).toContain("pi-web-engine");
    expect(headers.get("accept")).toBe("application/json");
  });

  it("rejects a token without a ChatGPT account ID", () => {
    expect(() => createCodexHeaders(undefined, undefined, "not-a-jwt")).toThrow(
      "OAuth token has no ChatGPT account ID",
    );
  });

  it("redacts a token before an error is truncated", () => {
    const token = "secret-token".repeat(100);
    const redacted = redactSensitiveText(`provider reflected ${token}`, token).slice(0, 500);
    expect(redacted).toBe("provider reflected [redacted]");
  });
});

describe("Codex standalone search results", () => {
  it("renders structured result references and deduplicated sources", () => {
    const result = formatSearchResult("gpt-5.6-luna", "query", "Evidence [turn0search0]", [
      {
        ref_id: "turn0search0",
        title: "Example\nResult",
        type: "text_result",
        url: "https://example.com/result?utm_source=openai",
      },
      {
        ref_id: "duplicate",
        title: "Duplicate",
        url: "https://example.com/result",
      },
    ]);

    const content = searchResultText(result);
    expect(content).toContain("Evidence [turn0search0]");
    expect(content).toContain("`turn0search0` [Example Result](<https://example.com/result>)");
    expect(result.details.sources).toHaveLength(1);
  });
});

function createCodexModel(id: string): Model<"openai-codex-responses"> {
  return {
    api: "openai-codex-responses",
    baseUrl: "https://chatgpt.com/backend-api",
    contextWindow: 128_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 128_000,
    name: id,
    provider: "openai-codex",
    reasoning: true,
  };
}

function runSearchRequest(fetchImplementation: typeof fetch) {
  return requestCodexSearch(
    "session-id",
    "gpt-5.4",
    "official Codex tests",
    undefined,
    new Headers(),
    "test-token",
    new AbortController().signal,
    fetchImplementation,
  );
}

function searchResultText(result: ReturnType<typeof formatSearchResult>): string {
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("Expected text search output");
  return content.text;
}

function createToken(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}
