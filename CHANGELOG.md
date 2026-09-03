# Changelog

All notable changes to this project are documented here. The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-09-01

### Changed

- Advertised accepted JSON, XML, and JavaScript text types as low-priority `web_fetch` fallbacks while preserving the requested format preference.
- Added sanitized, model-visible final-URL provenance when a fetch follows redirects.
- Added first-party verification guidance for time-sensitive search claims and clarified that external web access does not guarantee per-result freshness.
- Added an operator-controlled, complete `web_fetch` User-Agent override through namespaced global or trusted-project Pi settings.

### Security

- Redacted credential-like query values and omitted fragments from model-visible redirect provenance.
- Added regression coverage for structured request negotiation, GitHub-style JSON responses, redirect provenance, URL credentials in redirects, and User-Agent validation and precedence.

## [0.1.0] - 2026-09-01

### Added

- Contract tests adapted from the official Codex standalone web-search endpoint tests.
- GitHub Actions checks for formatting, linting, type checking, tests, Knip, builds, and production dependency audits.
- Structured source references and explicit truncation notices in search output.

### Changed

- Replaced the Codex Responses API search flow with the official Codex CLI's `POST /backend-api/codex/alpha/search` contract.
- Removed the GPT-5.6 model-name allowlist. Search now follows the Codex CLI's provider-level capability check for models from Pi's official `openai-codex` provider.
- Replaced direct Zod response validation with TypeBox and removed the obsolete streaming response parser.
- Improved source normalization, domain validation, MIME detection, and character-set decoding.

### Security

- Restricted Codex credentials to the official ChatGPT endpoint and added the required OAuth account headers.
- Redacted credentials before provider error truncation and bounded provider response bodies.
- Stripped sensitive headers from cross-origin fetch redirects.
- Added redirect-target tests covering private addresses and cross-origin credential handling.

## [0.0.2] - 2026-09-01

### Security

- Added socket-level DNS validation to prevent private-network access and DNS rebinding during web fetches.
- Added bounded response streaming, redirect validation, timeout limits, and expanded reserved-address coverage.

## [0.0.1] - 2026-09-01

### Added

- Initial release with native Codex web search and public HTTP(S) content fetching for Pi.
