import type { Api, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { parseResponseStream, readCodexErrorBody } from "./codex-stream.js";
import {
  jwtPayloadSchema,
  messageItemSchema,
  webSearchItemSchema,
  type SourceCandidate,
} from "./codex-schemas.js";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const SEARCH_TIMEOUT_MS = 60_000;
const MAX_ALLOWED_DOMAINS = 100;
const MAX_ERROR_BODY_LENGTH = 500;
const MAX_SOURCES = 100;

interface SearchSource {
  readonly title: string;
  readonly url: string;
}

export interface WebSearchDetails {
  readonly model: string;
  readonly query: string;
  readonly sources: readonly SearchSource[];
  readonly truncated: boolean;
}

interface SearchOptions {
  readonly allowedDomains: readonly string[] | undefined;
  readonly signal: AbortSignal | undefined;
}

interface WebSearchTool {
  readonly type: "web_search";
  filters?: { readonly allowed_domains: readonly string[] };
}

type PiModel = NonNullable<ExtensionContext["model"]>;

export async function searchWithCodex(
  query: string,
  options: SearchOptions,
  context: ExtensionContext,
): Promise<AgentToolResult<WebSearchDetails>> {
  const model = resolveModel(context);
  const auth = await context.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(`Codex authentication failed: ${auth.error}`);
  if (auth.apiKey === undefined) {
    throw new Error("Codex authentication failed: no OAuth token is available");
  }

  const headers = createHeaders(model.headers, auth.headers, auth.apiKey);
  const signal = combineSignal(options.signal);
  const response = await fetch(CODEX_RESPONSES_URL, {
    body: JSON.stringify(createRequestBody(model.id, query, options.allowedDomains)),
    headers,
    method: "POST",
    signal,
  });
  if (!response.ok) await throwResponseError(response, auth.apiKey);

  const payload = await parseResponseStream(response);
  const output = payload.output ?? [];
  if (!output.some((item) => webSearchItemSchema.safeParse(item).success)) {
    throw new Error("Codex returned no native web_search call");
  }
  return formatSearchResult(model.id, query, output);
}

export function normalizeDomains(domains: readonly string[] | undefined): string[] {
  if (domains === undefined) return [];
  const normalized = new Set<string>();
  for (const input of domains) {
    try {
      const url = new URL(input.includes("://") ? input : `https://${input}`);
      const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
      if (hostname.length > 0 && !hostname.includes("..")) normalized.add(hostname);
    } catch {
      // Invalid optional filters are omitted rather than weakening the request.
    }
  }
  return [...normalized].slice(0, MAX_ALLOWED_DOMAINS);
}

function resolveModel(context: ExtensionContext): Model<Api> {
  assertOfficialCodexModel(context.model);
  const model = context.modelRegistry.find(context.model.provider, context.model.id);
  if (model === undefined) throw new Error("The active Codex model is not registered in Pi");
  assertOfficialCodexModel(model);
  return model;
}

function assertOfficialCodexModel(model: PiModel | undefined): asserts model is PiModel {
  if (
    model === undefined ||
    model.provider !== "openai-codex" ||
    model.api !== "openai-codex-responses" ||
    !/^gpt-5\.6(?:-|$)/u.test(model.id)
  ) {
    throw new Error(
      "Native web_search MVP requires an active OpenAI Codex GPT-5.6 model. Use /login and /model to select gpt-5.6-luna, gpt-5.6-sol, or gpt-5.6-terra.",
    );
  }
  const baseUrl = new URL(model.baseUrl);
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.hostname !== "chatgpt.com" ||
    baseUrl.pathname.replace(/\/+$/u, "") !== "/backend-api"
  ) {
    throw new Error(
      "Native web_search only sends Codex credentials to the official ChatGPT endpoint",
    );
  }
}

function createHeaders(
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
  headers.set("Accept", "text/event-stream");
  if (!headers.has("chatgpt-account-id")) {
    const accountId = extractAccountId(apiKey);
    if (accountId !== undefined) headers.set("chatgpt-account-id", accountId);
  }
  if (!headers.has("originator")) headers.set("originator", "pi");
  return headers;
}

function createRequestBody(model: string, query: string, domains: readonly string[] | undefined) {
  const allowedDomains = normalizeDomains(domains);
  const webSearchTool: WebSearchTool = { type: "web_search" };
  if (allowedDomains.length > 0) {
    webSearchTool.filters = { allowed_domains: allowedDomains };
  }
  return {
    include: ["web_search_call.action.sources"],
    input: [{ content: [{ text: query, type: "input_text" }], role: "user" }],
    instructions:
      "Search the web and answer concisely using only retrieved evidence. Include citations.",
    model,
    parallel_tool_calls: true,
    store: false,
    stream: true,
    tool_choice: "required",
    tools: [webSearchTool],
  };
}

function combineSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

async function throwResponseError(response: Response, apiKey: string): Promise<never> {
  const message = redactToken(
    (await readCodexErrorBody(response)).slice(0, MAX_ERROR_BODY_LENGTH),
    apiKey,
  );
  throw new Error(`Codex web search failed (HTTP ${response.status}): ${message}`);
}

function formatSearchResult(
  model: string,
  query: string,
  output: readonly unknown[],
): AgentToolResult<WebSearchDetails> {
  const answer = extractAnswer(output);
  const sources = extractSources(output);
  if (answer.length === 0 && sources.length === 0) {
    throw new Error("Codex web search returned no answer or sources");
  }
  const rendered = [answer, renderSources(sources)].filter((part) => part.length > 0).join("\n\n");
  const truncation = truncateHead(rendered);
  return {
    content: [{ text: truncation.content, type: "text" }],
    details: { model, query, sources, truncated: truncation.truncated },
  };
}

function extractAnswer(output: readonly unknown[]): string {
  const text: string[] = [];
  for (const item of output) {
    const message = messageItemSchema.safeParse(item);
    if (!message.success) continue;
    for (const part of message.data.content) {
      if (part.text !== undefined && part.text.trim().length > 0) text.push(part.text.trim());
    }
  }
  return text.join("\n");
}

function extractSources(output: readonly unknown[]): SearchSource[] {
  const sources = new Map<string, SearchSource>();
  for (const item of output) {
    const message = messageItemSchema.safeParse(item);
    if (message.success) {
      for (const part of message.data.content) {
        for (const candidate of part.annotations ?? []) addSource(sources, candidate);
      }
    }
    const search = webSearchItemSchema.safeParse(item);
    if (search.success) {
      for (const candidate of search.data.action?.sources ?? []) addSource(sources, candidate);
      for (const candidate of search.data.sources ?? []) addSource(sources, candidate);
    }
  }
  return [...sources.values()].slice(0, MAX_SOURCES);
}

function addSource(sources: Map<string, SearchSource>, candidate: SourceCandidate): void {
  if (!URL.canParse(candidate.url)) return;
  const parsedUrl = new URL(candidate.url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return;
  const url = removeTracking(parsedUrl);
  if (sources.has(url)) return;
  const candidateTitle = candidate.title ?? candidate.caption;
  const title =
    candidateTitle === undefined || candidateTitle.trim().length === 0
      ? url
      : candidateTitle.trim();
  sources.set(url, { title, url });
}

function renderSources(sources: readonly SearchSource[]): string {
  if (sources.length === 0) return "";
  return `## Sources\n${sources.map((source, index) => `${index + 1}. [${escapeMarkdown(source.title)}](${source.url})`).join("\n")}`;
}

function removeTracking(input: URL): string {
  const url = new URL(input);
  if (url.searchParams.get("utm_source") === "openai") {
    url.searchParams.delete("utm_source");
  }
  return url.toString();
}

function escapeMarkdown(input: string): string {
  return input.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function extractAccountId(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const parsed = jwtPayloadSchema.safeParse(decoded);
    return parsed.success
      ? parsed.data["https://api.openai.com/auth"]?.chatgpt_account_id
      : undefined;
  } catch {
    return undefined;
  }
}

function redactToken(message: string, token: string): string {
  return message.replaceAll(token, "[redacted]");
}
