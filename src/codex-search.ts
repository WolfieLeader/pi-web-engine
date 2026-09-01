import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import { z } from "zod";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const SEARCH_TIMEOUT_MS = 60_000;

const responseSchema = z
  .object({
    output: z.array(z.unknown()).optional(),
  })
  .passthrough();

const eventSchema = z
  .object({
    item: z.unknown().optional(),
    response: z.unknown().optional(),
    type: z.string(),
  })
  .passthrough();

interface SearchSource {
  title: string;
  url: string;
}

export interface WebSearchDetails {
  model: string;
  query: string;
  sources: SearchSource[];
  truncated: boolean;
}

interface SearchOptions {
  allowedDomains?: readonly string[];
  signal?: AbortSignal;
}

type PiModel = NonNullable<ExtensionContext["model"]>;

export async function searchWithCodex(
  query: string,
  options: SearchOptions,
  context: ExtensionContext,
): Promise<AgentToolResult<WebSearchDetails>> {
  const selectedModel = requireOfficialCodexModel(context.model);
  const model = context.modelRegistry.find(selectedModel.provider, selectedModel.id);
  if (!model) throw new Error("The active Codex model is not registered in Pi");
  requireOfficialCodexModel(model);
  const auth = await context.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(`Codex authentication failed: ${auth.error}`);
  if (!auth.apiKey) throw new Error("Codex authentication failed: no OAuth token is available");

  const headers = new Headers();
  for (const [name, value] of Object.entries(model.headers ?? {})) headers.set(name, value);
  for (const [name, value] of Object.entries(auth.headers ?? {})) {
    if (value !== null) headers.set(name, value);
  }
  headers.set("Authorization", `Bearer ${auth.apiKey}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");
  if (!headers.has("chatgpt-account-id")) {
    const accountId = extractAccountId(auth.apiKey);
    if (accountId) headers.set("chatgpt-account-id", accountId);
  }
  if (!headers.has("originator")) headers.set("originator", "pi");

  const allowedDomains = normalizeDomains(options.allowedDomains);
  const webSearchTool = {
    type: "web_search",
    ...(allowedDomains.length > 0 ? { filters: { allowed_domains: allowedDomains } } : {}),
  };
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)])
    : AbortSignal.timeout(SEARCH_TIMEOUT_MS);

  const response = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model.id,
      instructions:
        "Search the web and answer concisely using only retrieved evidence. Include citations.",
      input: [{ role: "user", content: [{ type: "input_text", text: query }] }],
      tools: [webSearchTool],
      include: ["web_search_call.action.sources"],
      parallel_tool_calls: true,
      store: false,
      stream: true,
      tool_choice: "required",
    }),
    signal,
  });

  if (!response.ok) {
    const message = redactToken((await response.text()).slice(0, 500), auth.apiKey);
    throw new Error(`Codex web search failed (HTTP ${response.status}): ${message}`);
  }

  const payload = await parseResponseStream(response);
  const output = payload.output ?? [];
  if (!output.some((item) => isRecord(item) && item["type"] === "web_search_call")) {
    throw new Error("Codex returned no native web_search call");
  }

  const answer = extractAnswer(output);
  const sources = extractSources(output);
  if (!answer && sources.length === 0)
    throw new Error("Codex web search returned no answer or sources");

  const rendered = [answer, renderSources(sources)].filter(Boolean).join("\n\n");
  const truncation = truncateHead(rendered);
  return {
    content: [{ type: "text", text: truncation.content }],
    details: {
      model: model.id,
      query,
      sources,
      truncated: truncation.truncated,
    },
  };
}

export function normalizeDomains(domains: readonly string[] | undefined): string[] {
  if (!domains) return [];
  const normalized = new Set<string>();
  for (const input of domains) {
    try {
      const url = new URL(input.includes("://") ? input : `https://${input}`);
      const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
      if (hostname && !hostname.includes("..")) normalized.add(hostname);
    } catch {
      // Invalid optional filters are omitted rather than weakening the request.
    }
  }
  return [...normalized].slice(0, 100);
}

function requireOfficialCodexModel(model: PiModel | undefined): PiModel {
  if (
    !model ||
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
  return model;
}

async function parseResponseStream(response: Response): Promise<z.infer<typeof responseSchema>> {
  const text = await response.text();
  if (text.trimStart().startsWith("{")) return responseSchema.parse(JSON.parse(text));

  const output: unknown[] = [];
  let completed: z.infer<typeof responseSchema> | undefined;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const parsedJson: unknown = JSON.parse(data);
    const event = eventSchema.safeParse(parsedJson);
    if (!event.success) continue;
    if (event.data.type === "response.output_item.done" && event.data.item !== undefined) {
      output.push(event.data.item);
    }
    if (
      (event.data.type === "response.completed" || event.data.type === "response.done") &&
      event.data.response !== undefined
    ) {
      completed = responseSchema.parse(event.data.response);
    }
  }
  if (completed) return completed.output?.length ? completed : { ...completed, output };
  if (output.length > 0) return { output };
  throw new Error("Codex returned no parseable response output");
}

function extractAnswer(output: readonly unknown[]): string {
  const text: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || item["type"] !== "message" || !Array.isArray(item["content"])) {
      continue;
    }
    for (const part of item["content"]) {
      if (!isRecord(part) || typeof part["text"] !== "string" || part["text"].trim().length === 0) {
        continue;
      }
      text.push(part["text"].trim());
    }
  }
  return text.join("\n");
}

function extractSources(output: readonly unknown[]): SearchSource[] {
  const sources = new Map<string, SearchSource>();
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item["type"] === "message" && Array.isArray(item["content"])) {
      for (const part of item["content"]) {
        if (!isRecord(part) || !Array.isArray(part["annotations"])) continue;
        for (const annotation of part["annotations"]) addSource(sources, annotation);
      }
    }
    if (item["type"] === "web_search_call") {
      const action = item["action"];
      if (isRecord(action) && Array.isArray(action["sources"])) {
        for (const source of action["sources"]) addSource(sources, source);
      }
      if (Array.isArray(item["sources"])) {
        for (const source of item["sources"]) addSource(sources, source);
      }
    }
  }
  return [...sources.values()];
}

function addSource(sources: Map<string, SearchSource>, input: unknown): void {
  if (!isRecord(input)) return;
  const citation = input["url_citation"];
  const nested = isRecord(citation) ? citation : input;
  if (typeof nested["url"] !== "string" || !URL.canParse(nested["url"])) return;
  const url = removeTracking(nested["url"]);
  if (sources.has(url)) return;
  const title = nested["title"];
  sources.set(url, {
    title: typeof title === "string" && title.trim() ? title.trim() : url,
    url,
  });
}

function renderSources(sources: readonly SearchSource[]): string {
  if (sources.length === 0) return "";
  return `## Sources\n${sources.map((source, index) => `${index + 1}. [${source.title}](${source.url})`).join("\n")}`;
}

function removeTracking(input: string): string {
  const url = new URL(input);
  if (url.searchParams.get("utm_source") === "openai") url.searchParams.delete("utm_source");
  return url.toString();
}

function extractAccountId(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  const auth = payload?.["https://api.openai.com/auth"];
  if (!isRecord(auth)) return undefined;
  return typeof auth["chatgpt_account_id"] === "string" ? auth["chatgpt_account_id"] : undefined;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return isRecord(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function redactToken(message: string, token: string): string {
  return message.replaceAll(token, "[redacted]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
