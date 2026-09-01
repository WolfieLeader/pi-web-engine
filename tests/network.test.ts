import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, createGuardedLookup, readBoundedText } from "../src/network.js";

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
    "http://[::ffff:127.0.0.1]/admin",
    "http://[::ffff:7f00:1]/admin",
    "http://[::127.0.0.1]/admin",
    "http://[ff02::1]/admin",
    "http://[fec0::1]/admin",
    "http://[64:ff9b::7f00:1]/admin",
    "http://[2002:7f00:1::]/admin",
    "http://192.0.2.1/",
  ])("blocks internal target %s", async (url) => {
    await expect(assertPublicHttpUrl(url, publicLookup)).rejects.toThrow(/Blocked internal/u);
  });
});

describe("hostname validation", () => {
  it("blocks a hostname resolving to a private address", async () => {
    await expect(
      assertPublicHttpUrl("https://example.test", () =>
        Promise.resolve([{ address: "192.168.1.2", family: 4 }]),
      ),
    ).rejects.toThrow("Blocked internal or reserved address");
  });

  it("accepts a globally routable IPv6 literal", async () => {
    await expect(assertPublicHttpUrl("https://[2606:4700:4700::1111]/")).resolves.toMatchObject({
      hostname: "[2606:4700:4700::1111]",
    });
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

describe("createGuardedLookup", () => {
  it("rejects a private address during the socket lookup", async () => {
    const guardedLookup = promisify(
      createGuardedLookup(() => Promise.resolve([{ address: "127.0.0.1", family: 4 }])),
    );
    await expect(guardedLookup("rebind.example", { all: true })).rejects.toThrow(
      "Blocked internal or reserved address",
    );
  });

  it("returns public addresses to the socket connector", async () => {
    const guardedLookup = promisify(createGuardedLookup(publicLookup));
    await expect(guardedLookup("example.com", { all: true })).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
  });
});

describe("readBoundedText", () => {
  it("reads text under the configured limit", async () => {
    await expect(readBoundedText(new Response("hello"), 5)).resolves.toBe("hello");
  });

  it("decodes the declared legacy text encoding", async () => {
    const response = new Response(Uint8Array.of(0x63, 0x61, 0x66, 0xe9));
    await expect(readBoundedText(response, 4, "windows-1252")).resolves.toBe("café");
  });

  it("rejects text over the configured limit and cancels the stream", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello!"));
      },
    });
    await expect(readBoundedText(new Response(stream), 5)).rejects.toThrow("Response too large");
    expect(canceled).toBe(true);
  });
});
