import { Readability } from "@mozilla/readability";
import { truncateHead, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { fetchPublicUrl, readBoundedText } from "./network.js";

export const DEFAULT_FETCH_TIMEOUT_SECONDS = 30;
export const MAX_FETCH_TIMEOUT_SECONDS = 120;

export type FetchFormat = "html" | "markdown" | "text";

export interface WebFetchDetails {
  contentType: string;
  finalUrl: string;
  format: FetchFormat;
  title?: string;
  truncated: boolean;
}

interface FetchOptions {
  format: FetchFormat;
  signal?: AbortSignal;
  timeoutSeconds?: number;
}

const turndown = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
});

export async function fetchWebContent(
  url: string,
  options: FetchOptions,
): Promise<AgentToolResult<WebFetchDetails>> {
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_FETCH_TIMEOUT_SECONDS;
  const timeoutSignal = AbortSignal.timeout(timeoutSeconds * 1_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  const response = await fetchPublicUrl(url, {
    headers: {
      Accept: acceptHeader(options.format),
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "pi-websearch/0.0.1 (+https://github.com/WolfieLeader/pi-web-search)",
    },
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());

  const contentType = response.headers.get("content-type") ?? "";
  assertTextContentType(contentType);
  const body = await readBoundedText(response);
  const converted = convertContent(body, contentType, options.format, response.url || url);
  const truncation = truncateHead(converted.content);
  let output = truncation.content;
  if (truncation.truncated) {
    output += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines, ${truncation.outputBytes} of ${truncation.totalBytes} bytes.]`;
  }

  return {
    content: [{ type: "text", text: output }],
    details: {
      contentType,
      finalUrl: response.url || url,
      format: options.format,
      ...(converted.title ? { title: converted.title } : {}),
      truncated: truncation.truncated,
    },
  };
}

export function convertContent(
  body: string,
  contentType: string,
  format: FetchFormat,
  url: string,
): { content: string; title?: string } {
  if (!contentType.toLowerCase().includes("text/html")) return { content: body };
  if (format === "html") return { content: body };

  const { document } = parseHTML(body);
  if (format === "text") {
    for (const element of document.querySelectorAll(
      "script, style, noscript, iframe, object, embed",
    )) {
      element.remove();
    }
    return { content: document.body?.textContent.trim() ?? "" };
  }

  const article = new Readability(document, { charThreshold: 0 }).parse();
  const html = article?.content ?? document.body?.innerHTML ?? body;
  return {
    content: turndown.turndown(html).trim(),
    ...(article?.title ? { title: article.title } : titleFromDocument(document, url)),
  };
}

function titleFromDocument(document: Document, url: string): { title?: string } {
  const title = document.title.trim();
  if (title) return { title };
  try {
    return { title: new URL(url).hostname };
  } catch {
    return {};
  }
}

function acceptHeader(format: FetchFormat): string {
  if (format === "html") return "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5";
  if (format === "text") return "text/plain,text/markdown;q=0.9,text/html;q=0.8";
  return "text/markdown,text/x-markdown;q=0.9,text/html;q=0.8,text/plain;q=0.7";
}

function assertTextContentType(contentType: string): void {
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    !mime ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime.endsWith("+json") ||
    mime === "application/xml" ||
    mime.endsWith("+xml") ||
    mime === "application/javascript" ||
    mime === "application/x-javascript"
  ) {
    return;
  }
  throw new Error(`Unsupported fetched content type: ${mime}`);
}
