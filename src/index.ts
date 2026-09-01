import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { searchWithCodex, type WebSearchDetails } from "./codex-search.js";
import {
  DEFAULT_FETCH_TIMEOUT_SECONDS,
  fetchWebContent,
  MAX_FETCH_TIMEOUT_SECONDS,
  type WebFetchDetails,
} from "./web-fetch.js";

const webSearchParameters = Type.Object(
  {
    query: Type.String({
      description: "The search query or question to answer with current web sources",
      minLength: 1,
    }),
    allowed_domains: Type.Optional(
      Type.Array(Type.String(), {
        description: "Optional domains that the native search may use",
        maxItems: 100,
      }),
    ),
  },
  { additionalProperties: false },
);

const webFetchParameters = Type.Object(
  {
    url: Type.String({ description: "The public HTTP or HTTPS URL to fetch" }),
    format: Type.Optional(
      StringEnum(["markdown", "text", "html"] as const, {
        description: "Output format. Defaults to markdown",
      }),
    ),
    timeout: Type.Optional(
      Type.Integer({
        description: `Timeout in seconds (maximum ${MAX_FETCH_TIMEOUT_SECONDS})`,
        maximum: MAX_FETCH_TIMEOUT_SECONDS,
        minimum: 1,
      }),
    ),
  },
  { additionalProperties: false },
);

const webSearchTool = defineTool<typeof webSearchParameters, WebSearchDetails>({
  name: "web_search",
  label: "Web Search",
  description:
    "Search the live web with OpenAI Codex's native web_search tool and return a cited answer. " +
    "Requires an active official OpenAI Codex GPT-5.6 model. Output is limited to 50KB or 2,000 lines.",
  promptSnippet: "Search the live web through the active OpenAI Codex model",
  promptGuidelines: [
    "Use web_search whenever current or external information could change the answer, and cite the returned sources.",
  ],
  parameters: webSearchParameters,
  execute(_toolCallId, parameters, signal, onUpdate, context) {
    onUpdate?.({
      content: [{ type: "text", text: `Searching for “${parameters.query}”…` }],
      details: {
        model: context.model?.id ?? "unknown",
        query: parameters.query,
        sources: [],
        truncated: false,
      },
    });
    return searchWithCodex(
      parameters.query,
      {
        allowedDomains: parameters.allowed_domains,
        signal,
      },
      context,
    );
  },
});

const webFetchTool = defineTool<typeof webFetchParameters, WebFetchDetails>({
  name: "web_fetch",
  label: "Web Fetch",
  description:
    "Fetch a public HTTP or HTTPS URL as markdown, text, or HTML. Private-network targets and unsafe redirects are blocked. " +
    "Responses are limited to 2MB; tool output is limited to 50KB or 2,000 lines.",
  promptSnippet: "Fetch and read a public web page",
  promptGuidelines: [
    "Use web_fetch to inspect a relevant URL returned by web_search or supplied by the user.",
  ],
  parameters: webFetchParameters,
  execute(_toolCallId, parameters, signal, onUpdate) {
    const format = parameters.format ?? "markdown";
    onUpdate?.({
      content: [{ type: "text", text: `Fetching ${parameters.url}…` }],
      details: {
        contentType: "",
        finalUrl: parameters.url,
        format,
        truncated: false,
      },
    });
    return fetchWebContent(parameters.url, {
      format,
      signal,
      timeoutSeconds: parameters.timeout ?? DEFAULT_FETCH_TIMEOUT_SECONDS,
    });
  },
});

export default function piWebSearch(pi: ExtensionAPI): void {
  pi.registerTool(webSearchTool);
  pi.registerTool(webFetchTool);
}
