import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { Check, Parse } from "typebox/value";
import { searchResponseSchema, sourceSchema, type SourceCandidate } from "./codex-schemas.js";
import {
  createCodexHeaders,
  createSearchRequestBody,
  redactSensitiveText,
} from "./codex-request.js";
import { readBoundedText } from "./network.js";

const CODEX_SEARCH_URL = "https://chatgpt.com/backend-api/codex/alpha/search";
const SEARCH_TIMEOUT_MS = 60_000;
const MAX_ERROR_BODY_LENGTH = 500;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const MAX_SEARCH_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_REFERENCE_LENGTH = 100;
const MAX_SOURCE_TITLE_LENGTH = 500;
const MAX_SOURCE_URL_LENGTH = 8_192;
const MAX_SOURCES = 100;
const SUPPORTED_MODELS = new Set(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]);

interface SearchSource {
  readonly refId?: string;
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

  const headers = createCodexHeaders(model.headers, auth.headers, auth.apiKey);
  const signal = combineSignal(options.signal);
  const response = await fetch(CODEX_SEARCH_URL, {
    body: JSON.stringify(
      createSearchRequestBody(
        context.sessionManager.getSessionId(),
        model.id,
        query,
        options.allowedDomains,
      ),
    ),
    headers,
    method: "POST",
    signal,
  });
  if (!response.ok) await throwResponseError(response, auth.apiKey);

  const decoded: unknown = JSON.parse(await readBoundedText(response, MAX_SEARCH_RESPONSE_BYTES));
  const payload = Parse(searchResponseSchema, decoded);
  return formatSearchResult(model.id, query, payload.output, payload.results ?? []);
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
    !SUPPORTED_MODELS.has(model.id)
  ) {
    throw new Error(
      "Native web_search requires an active OpenAI Codex GPT-5.6 model. Use /login and /model to select gpt-5.6-luna, gpt-5.6-sol, or gpt-5.6-terra.",
    );
  }
  const baseUrl = new URL(model.baseUrl);
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.hostname !== "chatgpt.com" ||
    baseUrl.port.length > 0 ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.pathname.replace(/\/+$/u, "") !== "/backend-api" ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0
  ) {
    throw new Error(
      "Native web_search only sends Codex credentials to the official ChatGPT endpoint",
    );
  }
}

function combineSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

async function throwResponseError(response: Response, apiKey: string): Promise<never> {
  let body: string;
  try {
    body = await readBoundedText(response, MAX_ERROR_RESPONSE_BYTES);
  } catch (error) {
    body = `[response body unavailable: ${errorMessage(error)}]`;
  }
  const message = redactSensitiveText(body, apiKey).slice(0, MAX_ERROR_BODY_LENGTH);
  throw new Error(`Codex web search failed (HTTP ${response.status}): ${message}`);
}

export function formatSearchResult(
  model: string,
  query: string,
  output: string,
  results: readonly unknown[],
): AgentToolResult<WebSearchDetails> {
  const sources = extractSources(results);
  const rendered = [output.trim(), renderSources(sources)]
    .filter((part) => part.length > 0)
    .join("\n\n");
  if (rendered.length === 0) throw new Error("Codex web search returned no results");
  const truncation = truncateHead(rendered);
  let content = truncation.content;
  if (truncation.truncated) {
    content += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines, ${truncation.outputBytes} of ${truncation.totalBytes} bytes.]`;
  }
  return {
    content: [{ text: content, type: "text" }],
    details: { model, query, sources, truncated: truncation.truncated },
  };
}

function extractSources(results: readonly unknown[]): SearchSource[] {
  const sources = new Map<string, SearchSource>();
  for (const result of results) {
    if (!Check(sourceSchema, result)) continue;
    addSource(sources, result);
  }
  return [...sources.values()].slice(0, MAX_SOURCES);
}

function addSource(sources: Map<string, SearchSource>, candidate: SourceCandidate): void {
  if (candidate.url.length > MAX_SOURCE_URL_LENGTH || !URL.canParse(candidate.url)) return;
  const parsedUrl = new URL(candidate.url);
  if (
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    parsedUrl.username.length > 0 ||
    parsedUrl.password.length > 0
  ) {
    return;
  }
  const url = removeTracking(parsedUrl);
  if (sources.has(url)) return;
  const candidateTitle = candidate.title ?? candidate.caption;
  const title = cleanSourceTitle(candidateTitle, url);
  const refId = candidate.ref_id?.trim().slice(0, MAX_SOURCE_REFERENCE_LENGTH);
  sources.set(
    url,
    refId === undefined || refId.length === 0 ? { title, url } : { refId, title, url },
  );
}

function cleanSourceTitle(title: string | undefined, fallback: string): string {
  if (title === undefined) return fallback;
  const cleaned = title.replaceAll(/\s+/gu, " ").trim();
  return cleaned.length === 0 ? fallback : cleaned.slice(0, MAX_SOURCE_TITLE_LENGTH);
}

function renderSources(sources: readonly SearchSource[]): string {
  if (sources.length === 0) return "";
  return `## Sources\n${sources.map((source, index) => `${index + 1}. ${source.refId === undefined ? "" : `\`${escapeCode(source.refId)}\` `}[${escapeMarkdown(source.title)}](<${source.url}>)`).join("\n")}`;
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

function escapeCode(input: string): string {
  return input.replaceAll("`", "\\`");
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
