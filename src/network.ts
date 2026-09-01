import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type TcpNetConnectOpts } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const MAX_NETWORK_ORIGINS = 32;

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type IpFamily = 4 | 6;
type LookupAddress = Readonly<{ address: string; family: number }>;
type SocketLookup = NonNullable<TcpNetConnectOpts["lookup"]>;
interface ParsedHttpUrl {
  readonly hostname: string;
  readonly url: URL;
}
export type HostLookup = (hostname: string) => Promise<readonly LookupAddress[]>;

const publicNetworkAgent = new Agent({
  connect: { lookup: createGuardedLookup() },
  maxOrigins: MAX_NETWORK_ORIGINS,
});

export async function assertPublicHttpUrl(
  input: string | URL,
  lookup: HostLookup = defaultLookup,
): Promise<URL> {
  const { hostname, url } = parsePublicHttpUrl(input);
  if (isIP(hostname) !== 0) return url;

  const addresses = await resolveHost(hostname, lookup);
  for (const { address } of addresses) assertPublicIp(address, hostname);
  return url;
}

export async function fetchPublicUrl(
  input: string,
  init: RequestInit,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  let url = parsePublicHttpUrl(input).url;
  let request = init;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const secureRequest = {
      ...request,
      dispatcher: publicNetworkAgent,
      redirect: "manual" as const,
    };
    const response = await fetchImplementation(url, secureRequest);
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (location === null) return response;
    if (redirects === MAX_REDIRECTS) {
      await cancelResponseBody(response);
      throw new Error(`Too many redirects fetching ${input}`);
    }

    const previousOrigin = url.origin;
    try {
      url = parsePublicHttpUrl(new URL(location, url)).url;
    } finally {
      await cancelResponseBody(response);
    }
    if (url.origin !== previousOrigin) request = removeSensitiveHeaders(request);
    const method = (request.method ?? "GET").toUpperCase();
    if (
      (response.status === 303 && method !== "HEAD") ||
      ((response.status === 301 || response.status === 302) && method === "POST")
    ) {
      const { body: _body, ...withoutBody } = request;
      request = { ...withoutBody, method: "GET" };
    }
  }

  throw new Error(`Too many redirects fetching ${input}`);
}

export async function readBoundedText(
  response: Response,
  maximumBytes = MAX_RESPONSE_BYTES,
  encoding = "utf-8",
): Promise<string> {
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        const error = new Error(`Response too large (exceeds ${maximumBytes} bytes)`);
        await reader.cancel(error).catch(() => null);
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder(encoding).decode(body);
}

export function createGuardedLookup(lookup: HostLookup = defaultLookup): SocketLookup {
  return (hostname, options, callback) => {
    void performGuardedLookup(hostname, options, callback, lookup);
  };
}

async function performGuardedLookup(
  hostname: string,
  options: Parameters<SocketLookup>[1],
  callback: Parameters<SocketLookup>[2],
  lookup: HostLookup,
): Promise<void> {
  try {
    const addresses = await resolveHost(hostname, lookup);
    const validated = addresses.map(({ address }) => ({
      address,
      family: assertPublicIp(address, hostname),
    }));
    const requestedFamily = normalizeFamily(options.family);
    const matching =
      requestedFamily === undefined
        ? validated
        : validated.filter(({ family }) => family === requestedFamily);
    if (matching.length === 0) {
      callback(new Error(`Failed to resolve ${hostname}: no matching public addresses`), "");
      return;
    }
    if (options.all === true) {
      callback(null, matching);
      return;
    }
    const [first] = matching;
    if (first === undefined) {
      callback(new Error(`Failed to resolve ${hostname}: no public addresses`), "");
      return;
    }
    callback(null, first.address, first.family);
  } catch (error) {
    callback(toError(error), "");
  }
}

function parsePublicHttpUrl(input: string | URL): ParsedHttpUrl {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use HTTP or HTTPS");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("URLs containing credentials are not allowed");
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname.length === 0) throw new Error("URL must include a hostname");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`Blocked internal hostname: ${hostname}`);
  }
  if (isIP(hostname) !== 0) assertPublicIp(hostname, hostname);
  return { hostname, url };
}

async function resolveHost(
  hostname: string,
  lookup: HostLookup,
): Promise<readonly LookupAddress[]> {
  let addresses: readonly LookupAddress[];
  try {
    addresses = await lookup(hostname);
  } catch (error) {
    throw new Error(`Failed to resolve ${hostname}: ${errorMessage(error)}`, { cause: error });
  }
  if (addresses.length === 0) throw new Error(`Failed to resolve ${hostname}: no addresses`);
  return addresses;
}

function defaultLookup(hostname: string): Promise<readonly LookupAddress[]> {
  return dnsLookup(hostname, { all: true, order: "verbatim" });
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replaceAll(/^\[|\]$/gu, "")
    .replace(/\.$/u, "");
}

function assertPublicIp(address: string, hostname: string): IpFamily {
  const normalized = normalizeHostname(address);
  if (isIP(normalized) === 0) {
    throw new Error(`Resolved non-IP address for ${hostname}: ${address}`);
  }

  const parsed = ipaddr.parse(normalized);
  const isIpv4Compatible =
    parsed.kind() === "ipv6" &&
    parsed
      .toByteArray()
      .slice(0, 12)
      .every((byte) => byte === 0);
  if (parsed.range() !== "unicast" || isIpv4Compatible) {
    throw new Error(`Blocked internal or reserved address for ${hostname}: ${normalized}`);
  }
  return parsed.kind() === "ipv4" ? 4 : 6;
}

function normalizeFamily(family: number | "IPv4" | "IPv6" | undefined): IpFamily | undefined {
  let normalized: IpFamily | undefined;
  if (family === 4 || family === "IPv4") normalized = 4;
  if (family === 6 || family === "IPv6") normalized = 6;
  return normalized;
}

function removeSensitiveHeaders(request: RequestInit): RequestInit {
  if (request.headers === undefined) return request;
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("proxy-authorization");
  return { ...request, headers };
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body === null) return;
  await response.body.cancel().catch(() => null);
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
