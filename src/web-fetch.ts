import { Readability } from "@mozilla/readability";
import { truncateHead, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { fetchPublicUrl, readBoundedText } from "./network.js";

export const DEFAULT_FETCH_TIMEOUT_SECONDS = 30;
export const MAX_FETCH_TIMEOUT_SECONDS = 120;

export type FetchFormat = "html" | "markdown" | "text";

export interface WebFetchDetails {
  readonly contentType: string;
  readonly finalUrl: string;
  readonly format: FetchFormat;
  title?: string;
  readonly truncated: boolean;
}

interface FetchOptions {
  readonly format: FetchFormat;
  readonly signal: AbortSignal | undefined;
  readonly timeoutSeconds: number;
}

interface ConvertedContent {
  readonly content: string;
  readonly title?: string;
}

const MILLISECONDS_PER_SECOND = 1_000;
const MAX_TITLE_LENGTH = 500;
const turndown = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
});

export async function fetchWebContent(
  url: string,
  options: FetchOptions,
): Promise<AgentToolResult<WebFetchDetails>> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutSeconds * MILLISECONDS_PER_SECOND);
  const signal =
    options.signal === undefined ? timeoutSignal : AbortSignal.any([options.signal, timeoutSignal]);
  const response = await fetchPublicUrl(url, {
    headers: {
      Accept: acceptHeader(options.format),
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "pi-web-engine (+https://github.com/WolfieLeader/pi-web-engine)",
    },
    signal,
  });
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }

  const contentType = response.headers.get("content-type") ?? "";
  try {
    assertTextContentType(contentType);
  } catch (error) {
    await cancelResponseBody(response);
    throw error;
  }
  const body = await readBoundedText(response, undefined, charsetFromContentType(contentType));
  const finalUrl = response.url.length > 0 ? response.url : url;
  const converted = convertContent(body, contentType, options.format, finalUrl);
  const truncation = truncateHead(converted.content);
  let output = truncation.content;
  if (truncation.truncated) {
    output += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines, ${truncation.outputBytes} of ${truncation.totalBytes} bytes.]`;
  }

  const details: WebFetchDetails = {
    contentType,
    finalUrl,
    format: options.format,
    truncated: truncation.truncated,
  };
  if (converted.title !== undefined) details.title = converted.title.slice(0, MAX_TITLE_LENGTH);
  return {
    content: [{ type: "text", text: output }],
    details,
  };
}

export function convertContent(
  body: string,
  contentType: string,
  format: FetchFormat,
  url: string,
): ConvertedContent {
  if (mimeFromContentType(contentType) !== "text/html") return { content: body };
  if (format === "html") return { content: body };

  const { document } = parseHTML(body);
  if (format === "text") {
    for (const element of document.querySelectorAll(
      "script, style, noscript, iframe, object, embed",
    )) {
      element.remove();
    }
    return { content: document.body.textContent.trim() };
  }

  const article = new Readability(document, { charThreshold: 0 }).parse();
  const html = article?.content ?? document.body.innerHTML;
  const content = turndown.turndown(html).trim();
  const title = article?.title ?? titleFromDocument(document, url);
  return title === undefined ? { content } : { content, title };
}

function titleFromDocument(document: Document, url: string): string | undefined {
  const title = document.title.trim();
  if (title.length > 0) return title;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function acceptHeader(format: FetchFormat): string {
  if (format === "html") return "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5";
  if (format === "text") return "text/plain,text/markdown;q=0.9,text/html;q=0.8";
  return "text/markdown,text/x-markdown;q=0.9,text/html;q=0.8,text/plain;q=0.7";
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body === null) return;
  await response.body.cancel().catch(() => null);
}

function charsetFromContentType(contentType: string): string {
  const match = /(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/iu.exec(contentType);
  const charset = match?.[1] ?? "utf-8";
  try {
    const decoder = new TextDecoder(charset);
    return decoder.encoding;
  } catch {
    return "utf-8";
  }
}

function mimeFromContentType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function assertTextContentType(contentType: string): void {
  const mime = mimeFromContentType(contentType);
  if (
    mime.length === 0 ||
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
