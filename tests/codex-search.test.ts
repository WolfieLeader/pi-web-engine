import { describe, expect, it } from "vitest";
import { normalizeDomains } from "../src/codex-search.js";

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
