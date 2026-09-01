<div align="center">

<img src="https://github.com/WolfieLeader/pi-web-engine/blob/main/assets/pi-web-engine.svg" align="center" alt="pi-web-engine banner" />

<h1 align="center">pi-web-engine</h1>

<p align="center">
  Native OpenAI Codex web search and secure, readable web fetching.<br/>
  Built for Pi with no additional search API key.
</p>

<a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/WolfieLeader/pi-web-engine?color=DC343B" alt="License"></a>
<a href="https://www.npmjs.com/package/pi-web-engine" rel="nofollow"><img src="https://img.shields.io/npm/v/pi-web-engine?color=0078D4" alt="npm version"></a>
<a href="https://www.npmjs.com/package/pi-web-engine" rel="nofollow"><img src="https://img.shields.io/npm/dt/pi-web-engine.svg?color=03C03C" alt="npm downloads"></a>
<a href="https://github.com/WolfieLeader/pi-web-engine" rel="nofollow"><img src="https://img.shields.io/github/stars/WolfieLeader/pi-web-engine" alt="stars"></a>

</div>

## About 📖

`pi-web-engine` gives [Pi](https://github.com/earendil-works/pi-mono) two focused tools: native web search through the active OpenAI Codex model and hardened fetching of public web pages.

Search reuses Pi's existing Codex OAuth session, so there is no second API key to configure. Fetching converts pages into model-friendly Markdown while applying strict network, redirect, content-type, and response-size protections.

> This focused release does not include Exa, Firecrawl, or Tavily. See the [roadmap](#roadmap-).

## Features 🌟

- 🔎 **Native Codex Search** — follows the official Codex CLI's standalone web-search contract
- 🔑 **No Additional Search Key** — securely reuses the Codex OAuth session managed by Pi
- 🧠 **Model-Agnostic Integration** — supports models from Pi's official `openai-codex` provider without a brittle model-name allowlist
- 🛡️ **Hardened Web Fetching** — blocks private networks, DNS rebinding, unsafe redirects, URL credentials, and non-HTTP schemes
- 📄 **Readable Output** — extracts article content and returns Markdown, plain text, or HTML
- 📏 **Bounded Responses** — enforces download, provider-response, line, and tool-output limits
- 🧰 **Type-Safe & Tested** — built with TypeScript and TypeBox, with contract and security tests

## Installation 📦

### Requirements ✅

- Node.js 24.11 or newer
- Pi 0.84.4 or newer
- An OpenAI Codex login for `web_search`

### Install from npm 🔥

```bash
pi install npm:pi-web-engine
```

Or directly from GitHub:

```bash
pi install git:github.com/WolfieLeader/pi-web-engine
```

## Quick Start 🚀

1. Start Pi.
2. Use `/login` to create an OpenAI Codex session.
3. Use `/model` to select a model from the official `openai-codex` provider.
4. Ask Pi to search or fetch the web:

```text
Search the web for the latest OpenAI Codex release and summarize the changes.

Fetch https://example.com and return the page as Markdown.
```

No additional configuration is required.

## Tools 🧰

### `web_search` 🔎

Searches the live web through Codex's native standalone search endpoint and returns evidence with normalized source URLs.

| Parameter         | Type       | Required | Description                                      |
| ----------------- | ---------- | -------- | ------------------------------------------------ |
| `query`           | `string`   | Yes      | Search query or question                         |
| `allowed_domains` | `string[]` | No       | Restrict results to up to 100 normalized domains |

- Credentials are resolved through Pi and sent only to the official `https://chatgpt.com/backend-api` endpoint.
- The active model must use Pi's official `openai-codex` provider and `openai-codex-responses` API.
- Search output is limited to 50 KB or 2,000 lines and includes an explicit truncation notice when needed.

### `web_fetch` 📄

Fetches a public HTTP(S) URL and returns readable content.

| Parameter | Type                             | Required | Description                                   |
| --------- | -------------------------------- | -------- | --------------------------------------------- |
| `url`     | `string`                         | Yes      | Public HTTP or HTTPS URL                      |
| `format`  | `"markdown" \| "text" \| "html"` | No       | Output format; defaults to `"markdown"`       |
| `timeout` | `integer`                        | No       | Timeout in seconds, from 1 to 120; default 30 |

- HTML pages are parsed with Mozilla Readability before Markdown or text conversion.
- Non-text content and responses larger than 2 MB are rejected.
- Tool output is limited to 50 KB or 2,000 lines.

## Security 🛡️

- 🌐 **Network Boundaries** — rejects localhost, private and reserved addresses, IPv4 transition addresses, URL credentials, and unsupported schemes
- 🔁 **Safe Redirects** — validates every redirect target and removes sensitive headers from cross-origin redirects
- 🧱 **DNS Rebinding Protection** — validates hostnames whenever the connector opens a socket, including after redirects
- 🔒 **Credential Redaction** — removes OAuth credentials from bounded provider errors before they reach tool output

> [!IMPORTANT]
> These controls are defense in depth, not a sandbox boundary. Pi extensions execute with the user's permissions, so install only code you trust. Retrieved web content is untrusted and may contain prompt-injection attempts.

## Codex Compatibility 🔌

- 🥇 **Primary Source of Truth** — the official Codex app and CLI
- 🔎 **Search Contract** — the Codex CLI's [standalone web-search extension](https://github.com/openai/codex/tree/main/codex-rs/ext/web-search) and `codex/alpha/search` endpoint
- 📚 **Supporting Documentation** — OpenAI's public [web-search guide](https://developers.openai.com/api/docs/guides/tools-web-search), which describes the related Responses API behavior
- 🧪 **Release Policy** — because the standalone endpoint is explicitly alpha, every release should retain request-contract tests and receive live Codex verification

## Development 🛠️

```bash
pnpm install
pnpm check
pnpm build
```

For local Pi development:

```bash
pi -e ./src/index.ts
```

- 🧰 **Tooling** — TypeScript, pnpm, OXC, Knip, Vitest, TypeBox, and tsdown
- 📐 **Validation** — reuses Pi's TypeBox peer dependency for tool schemas and untrusted provider responses
- 🧹 **Linting** — the development-only [anti-slop](https://github.com/dmmulroy/anti-slop) Oxlint plugin is vendored as required by upstream, retains its MIT license and provenance, and is excluded from the npm package

## Roadmap 🗺️

Possible follow-up releases:

1. Exa provider support
2. Firecrawl search and extraction
3. Tavily provider support
4. Provider routing and configuration
5. Opt-in, credential-gated integration tests against live providers

Version history is available in the [changelog](CHANGELOG.md).

## Contributions 🤝

- Open an [issue](https://github.com/WolfieLeader/pi-web-engine/issues) or feature request
- Submit a PR to improve the extension
- Star the repository if you find it useful

<div align="center">
<br/>

Crafted carefully by [WolfieLeader](https://github.com/WolfieLeader)

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).

</div>
