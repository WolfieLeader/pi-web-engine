# pi-web-engine

Focused web access for [Pi](https://github.com/earendil-works/pi-mono): native OpenAI Codex search plus safe, readable web fetching.

This first release intentionally starts small. It does not yet include Exa, Firecrawl, or Tavily.

## Tools

### `web_search`

Uses the active OpenAI Codex GPT-5.6 model and its existing Pi OAuth session to call OpenAI's native `web_search` Responses API tool. It returns a grounded answer and source URLs.

- Credentials are resolved through Pi; no second API key is required.
- Codex credentials are sent only to the official `https://chatgpt.com/backend-api` endpoint.
- Optional `allowed_domains` filters narrow the native search.
- For the MVP, requires `gpt-5.6-luna`, `gpt-5.6-sol`, or `gpt-5.6-terra` on the official `openai-codex` provider.

### `web_fetch`

Fetches a public HTTP(S) URL and returns `markdown` (default), `text`, or `html`.

- Extracts readable article content from HTML.
- Blocks localhost, private/reserved IP addresses, IPv4 transition addresses, URL credentials, non-HTTP schemes, and redirects to blocked targets.
- Rejects non-text content and responses larger than 2 MB.
- Truncates tool output to Pi's 50 KB / 2,000-line limit.

> [!NOTE]
> Hostnames are validated by the connector when it opens each socket, including after redirects, to prevent DNS rebinding into private networks. This is defense in depth, not a sandbox boundary: Pi extensions execute with the user's permissions, so install only code you trust.

## Requirements

- Node.js 24.11 or newer
- Pi 0.84.4 or newer
- An OpenAI Codex login and a GPT-5.6 Codex model for `web_search`

## Install

From npm:

```sh
pi install npm:pi-web-engine
```

Or directly from GitHub:

```sh
pi install git:github.com/WolfieLeader/pi-web-engine
```

For local development:

```sh
pnpm install
pi -e ./src/index.ts
```

Then select `gpt-5.6-luna`, `gpt-5.6-sol`, or `gpt-5.6-terra` with `/model`. Pi's `/login` command can create the required Codex session.

## Development

The project uses TypeScript 7, pnpm 11, OXC, Knip, Vitest, Zod 4, and tsdown. Oxlint runs type-aware linting, experimental type-check diagnostics, strict correctness/pedantic/performance/suspicious categories, and the vendored [anti-slop](https://github.com/dmmulroy/anti-slop) ruleset.

```sh
pnpm install
pnpm check
pnpm build
```

Pi currently requires TypeBox schemas at the extension tool boundary. The extension therefore uses Pi's bundled TypeBox-compatible `Type`/`StringEnum` helpers for tool parameters and Zod for untrusted provider response validation.

## Roadmap

Possible follow-up releases:

1. Exa provider support
2. Firecrawl search and extraction
3. Tavily provider support
4. Provider routing and configuration
5. Integration tests against live providers (opt-in and credential-gated)

## License

[MIT](LICENSE)
