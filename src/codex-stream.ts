import { eventSchema, responseSchema, type ParsedResponse } from "./codex-schemas.js";
import { readBoundedText } from "./network.js";

const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const MAX_SEARCH_RESPONSE_BYTES = 4 * 1024 * 1024;

export async function readCodexErrorBody(response: Response): Promise<string> {
  try {
    return await readBoundedText(response, MAX_ERROR_RESPONSE_BYTES);
  } catch (error) {
    return `[response body unavailable: ${errorMessage(error)}]`;
  }
}

export async function parseResponseStream(response: Response): Promise<ParsedResponse> {
  const text = await readBoundedText(response, MAX_SEARCH_RESPONSE_BYTES);
  if (text.trimStart().startsWith("{")) return responseSchema.parse(JSON.parse(text));

  const output: unknown[] = [];
  let completed: ParsedResponse | undefined;
  for (const block of text.split(/\r?\n\r?\n/u)) {
    const data = extractEventData(block);
    if (data.length === 0 || data === "[DONE]") continue;
    const decoded: unknown = JSON.parse(data);
    const parsedEvent = eventSchema.safeParse(decoded);
    if (!parsedEvent.success) continue;
    const event = parsedEvent.data;
    if (event.type === "response.output_item.done" && event.item !== undefined) {
      output.push(event.item);
    }
    if (
      (event.type === "response.completed" || event.type === "response.done") &&
      event.response !== undefined
    ) {
      completed = responseSchema.parse(event.response);
    }
  }
  if (completed !== undefined) {
    return (completed.output?.length ?? 0) > 0 ? completed : { ...completed, output };
  }
  if (output.length > 0) return { output };
  throw new Error("Codex returned no parseable response output");
}

function extractEventData(block: string): string {
  return block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n")
    .trim();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
