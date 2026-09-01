import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Parse } from "typebox/value";

export const DEFAULT_USER_AGENT =
  "pi-web-engine/0.1.1 (+https://github.com/WolfieLeader/pi-web-engine)";
export const MAX_USER_AGENT_LENGTH = 512;

const settingsSchema = Type.Object({
  "pi-web-engine": Type.Optional(
    Type.Object({
      userAgent: Type.Optional(
        Type.String({
          maxLength: MAX_USER_AGENT_LENGTH,
          minLength: 1,
          pattern: "^[!-~](?:[ -~]*[!-~])?$",
        }),
      ),
    }),
  ),
});

type PiSettings = Static<typeof settingsSchema>;

export async function loadUserAgent(
  cwd: string,
  projectTrusted: boolean,
  agentDir = getAgentDir(),
): Promise<string> {
  const globalSettings = await readSettingsFile(join(agentDir, "settings.json"));
  const projectSettings = projectTrusted
    ? await readSettingsFile(join(cwd, ".pi", "settings.json"))
    : undefined;
  return resolveUserAgent(globalSettings, projectSettings);
}

export function resolveUserAgent(
  globalSettings: PiSettings | undefined,
  projectSettings?: PiSettings,
): string {
  return (
    projectSettings?.["pi-web-engine"]?.userAgent ??
    globalSettings?.["pi-web-engine"]?.userAgent ??
    DEFAULT_USER_AGENT
  );
}

async function readSettingsFile(path: string): Promise<PiSettings | undefined> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error(`Unable to read Pi settings at ${path}`, { cause: error });
  }

  try {
    const decoded: unknown = JSON.parse(source);
    return Parse(settingsSchema, decoded);
  } catch (error) {
    throw new Error(`Invalid pi-web-engine settings in ${path}`, { cause: error });
  }
}
