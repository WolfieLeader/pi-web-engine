import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type LookupAddress = Readonly<{ address: string; family: number }>;
export type HostLookup = (hostname: string) => Promise<readonly LookupAddress[]>;

export async function assertPublicHttpUrl(
  input: string | URL,
  lookup: HostLookup = defaultLookup,
): Promise<URL> {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) throw new Error("URL must include a hostname");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`Blocked internal hostname: ${hostname}`);
  }

  if (isIP(hostname)) {
    assertPublicIp(hostname, hostname);
    return url;
  }

  let addresses: readonly LookupAddress[];
  try {
    addresses = await lookup(hostname);
  } catch (error) {
    throw new Error(`Failed to resolve ${hostname}: ${errorMessage(error)}`, { cause: error });
  }
  if (addresses.length === 0) throw new Error(`Failed to resolve ${hostname}: no addresses`);
  for (const { address } of addresses) assertPublicIp(address, hostname);
  return url;
}

export async function fetchPublicUrl(
  input: string,
  init: RequestInit,
  lookup?: HostLookup,
): Promise<Response> {
  let url = await assertPublicHttpUrl(input, lookup);
  let request = init;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(url, { ...request, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects === MAX_REDIRECTS) throw new Error(`Too many redirects fetching ${input}`);

    url = await assertPublicHttpUrl(new URL(location, url), lookup);
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && request.method === "POST")
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
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        throw new Error(`Response too large (exceeds ${maximumBytes} bytes)`);
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
  return new TextDecoder().decode(body);
}

async function defaultLookup(hostname: string): Promise<readonly LookupAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function assertPublicIp(address: string, hostname: string): void {
  const normalized = normalizeHostname(address);
  const version = isIP(normalized);
  if (version === 4 && isBlockedIpv4(normalized)) {
    throw new Error(`Blocked internal address for ${hostname}: ${normalized}`);
  }
  if (version === 6 && isBlockedIpv6(normalized)) {
    throw new Error(`Blocked internal address for ${hostname}: ${normalized}`);
  }
  if (version === 0) throw new Error(`Resolved non-IP address for ${hostname}: ${address}`);
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [first = -1, second = -1] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/u.test(normalized)) return true;

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1];
  return mapped ? isBlockedIpv4(mapped) : false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
