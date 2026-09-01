import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import type { ProviderHeaders } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import { jwtPayloadSchema } from "./codex-schemas.js";

const MAX_ALLOWED_DOMAINS = 100;
const MAX_SEARCH_OUTPUT_TOKENS = 12_000;

interface StandaloneSearchSettings {
  readonly allowed_callers: readonly ["direct"];
  readonly external_web_access: true;
  filters?: { readonly allowed_domains: readonly string[] };
}

export function normalizeDomains(domains: readonly string[] | undefined): string[] {
  if (domains === undefined) return [];
  const normalized = new Set<string>();
  for (const input of domains) {
    const hostname = normalizeDomain(input);
    if (hostname !== undefined) normalized.add(hostname);
  }
  return [...normalized].slice(0, MAX_ALLOWED_DOMAINS);
}

export function createSearchRequestBody(
  id: string,
  model: string,
  query: string,
  domains: readonly string[] | undefined,
) {
  const allowedDomains = normalizeDomains(domains);
  const settings: StandaloneSearchSettings = {
    allowed_callers: ["direct"],
    external_web_access: true,
  };
  if (allowedDomains.length > 0) settings.filters = { allowed_domains: allowedDomains };
  return {
    commands: {
      response_length: "long",
      search_query: [{ q: query }],
    },
    id,
    input: query,
    max_output_tokens: MAX_SEARCH_OUTPUT_TOKENS,
    model,
    settings,
  };
}

export function createCodexHeaders(
  modelHeaders: ProviderHeaders | undefined,
  authHeaders: ProviderHeaders | undefined,
  apiKey: string,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(modelHeaders ?? {})) {
    if (value !== null) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(authHeaders ?? {})) {
    if (value !== null) headers.set(name, value);
  }
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  if (!headers.has("chatgpt-account-id")) {
    const accountId = extractAccountId(apiKey);
    if (accountId === undefined) {
      throw new Error("Codex authentication failed: OAuth token has no ChatGPT account ID");
    }
    headers.set("chatgpt-account-id", accountId);
  }
  if (!headers.has("originator")) headers.set("originator", "pi");
  if (!headers.has("user-agent")) {
    headers.set("user-agent", "pi-web-engine (+https://github.com/WolfieLeader/pi-web-engine)");
  }
  return headers;
}

export function redactSensitiveText(message: string, token: string): string {
  return message.replaceAll(token, "[redacted]");
}

function normalizeDomain(input: string): string | undefined {
  const candidate = input.trim();
  if (candidate.length === 0) return undefined;
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username.length > 0 || url.password.length > 0 || url.port.length > 0) return undefined;
    const hostname = domainToASCII(url.hostname.toLowerCase().replace(/\.$/u, ""));
    if (hostname.length === 0 || hostname.length > 253 || isIP(hostname) !== 0) return undefined;
    const labels = hostname.split(".");
    if (labels.length < 2) return undefined;
    if (
      labels.some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          label.startsWith("-") ||
          label.endsWith("-") ||
          !/^[a-z0-9-]+$/u.test(label),
      )
    ) {
      return undefined;
    }
    return hostname;
  } catch {
    return undefined;
  }
}

function extractAccountId(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Check(jwtPayloadSchema, decoded)) return undefined;
    return decoded["https://api.openai.com/auth"]?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}
