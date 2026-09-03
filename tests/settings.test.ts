import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_AGENT,
  loadUserAgent,
  MAX_USER_AGENT_LENGTH,
  resolveUserAgent,
} from "../src/settings.js";

describe("resolveUserAgent", () => {
  it("uses the built-in identity by default", () => {
    expect(resolveUserAgent({}, {})).toBe(DEFAULT_USER_AGENT);
  });

  it("lets project settings override global settings", () => {
    expect(
      resolveUserAgent(
        { "pi-web-engine": { userAgent: "GlobalAgent/1.0" } },
        { "pi-web-engine": { userAgent: "ProjectAgent/2.0" } },
      ),
    ).toBe("ProjectAgent/2.0");
  });
});

describe("loadUserAgent", () => {
  it("reads project settings only when Pi trusts the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-engine-settings-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        "pi-web-engine": { futureSetting: true, userAgent: "GlobalAgent/1.0" },
      }),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ "pi-web-engine": { userAgent: "ProjectAgent/2.0" } }),
    );

    try {
      await expect(loadUserAgent(cwd, true, agentDir)).resolves.toBe("ProjectAgent/2.0");
      await expect(loadUserAgent(cwd, false, agentDir)).resolves.toBe("GlobalAgent/1.0");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("User-Agent validation", () => {
  it.each([
    ["an empty value", ""],
    ["surrounding whitespace", " OpenCode/1.0"],
    ["a control character", "OpenCode/1.0\nInjected: true"],
    ["a non-ASCII character", "OpenCode/β"],
    ["an oversized value", "a".repeat(MAX_USER_AGENT_LENGTH + 1)],
    ["a non-string value", 42],
  ])("rejects %s", async (_description, userAgent) => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-engine-settings-"));
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ "pi-web-engine": { userAgent } }),
    );

    try {
      await expect(loadUserAgent(root, false, agentDir)).rejects.toThrow(
        "Invalid pi-web-engine settings",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
