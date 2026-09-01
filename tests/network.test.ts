import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, readBoundedText } from "../src/network.js";

const publicLookup = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }] as const);

describe("assertPublicHttpUrl", () => {
  it("accepts a public HTTPS URL", async () => {
    await expect(
      assertPublicHttpUrl("https://example.com/docs", publicLookup),
    ).resolves.toMatchObject({
      hostname: "example.com",
      protocol: "https:",
    });
  });

  it.each([
    "http://localhost/admin",
    "http://127.0.0.1/admin",
    "http://10.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/admin",
  ])("blocks internal target %s", async (url) => {
    await expect(assertPublicHttpUrl(url, publicLookup)).rejects.toThrow(/Blocked internal/u);
  });

  it("blocks a hostname resolving to a private address", async () => {
    await expect(
      assertPublicHttpUrl("https://example.test", () =>
        Promise.resolve([{ address: "192.168.1.2", family: 4 }]),
      ),
    ).rejects.toThrow("Blocked internal address");
  });

  it("rejects non-HTTP schemes and URL credentials", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd", publicLookup)).rejects.toThrow(
      "URL must use HTTP or HTTPS",
    );
    await expect(
      assertPublicHttpUrl("https://user:pass@example.com", publicLookup),
    ).rejects.toThrow("URLs containing credentials");
  });
});

describe("readBoundedText", () => {
  it("reads text under the configured limit", async () => {
    await expect(readBoundedText(new Response("hello"), 5)).resolves.toBe("hello");
  });

  it("rejects text over the configured limit", async () => {
    await expect(readBoundedText(new Response("hello!"), 5)).rejects.toThrow("Response too large");
  });
});
