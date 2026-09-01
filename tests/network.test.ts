import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  assertPublicHttpUrl,
  createGuardedLookup,
  fetchPublicUrl,
  readBoundedText,
} from "../src/network.js";

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

describe("fetchPublicUrl redirects", () => {
  it("rejects redirects to private addresses before the next request", async () => {
    let requests = 0;
    await expect(
      fetchPublicUrl("https://example.com/start", {}, () => {
        requests += 1;
        return Promise.resolve(
          new Response(null, {
            headers: { location: "http://127.0.0.1/private" },
            status: 302,
          }),
        );
      }),
    ).rejects.toThrow("Blocked internal or reserved address");
    expect(requests).toBe(1);
  });

  it("rejects URL credentials in redirects before the next request", async () => {
    let requests = 0;
    await expect(
      fetchPublicUrl("https://example.com/start", {}, () => {
        requests += 1;
        return Promise.resolve(
          new Response(null, {
            headers: { location: "https://user:password@example.com/private" },
            status: 302,
          }),
        );
      }),
    ).rejects.toThrow("URLs containing credentials are not allowed");
    expect(requests).toBe(1);
  });
});

describe("fetchPublicUrl cross-origin redirects", () => {
  it("strips credentials from cross-origin redirects", async () => {
    const seenHeaders: Headers[] = [];
    const responses = [
      new Response(null, {
        headers: { location: "https://www.example.com/final" },
        status: 302,
      }),
      new Response("ok"),
    ];
    const response = await fetchPublicUrl(
      "https://example.com/start",
      {
        headers: {
          Authorization: "Bearer secret",
          Cookie: "session=secret",
          "X-Request-ID": "request-id",
        },
      },
      createSequentialFetch(responses, seenHeaders),
    );

    const redirectedHeaders = seenHeaders[1];
    expect(redirectedHeaders?.get("authorization")).toBeNull();
    expect(redirectedHeaders?.get("cookie")).toBeNull();
    expect(redirectedHeaders?.get("x-request-id")).toBe("request-id");
    await expect(response.text()).resolves.toBe("ok");
    expect(seenHeaders).toHaveLength(2);
  });
});

function createSequentialFetch(responses: readonly Response[], seenHeaders: Headers[]) {
  let index = 0;
  return (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    seenHeaders.push(new Headers(init?.headers));
    const response = responses[index];
    index += 1;
    return response === undefined
      ? Promise.reject(new Error("Unexpected extra request"))
      : Promise.resolve(response);
  };
}

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
