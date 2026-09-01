# Vendored anti-slop plugin

Source: https://github.com/dmmulroy/anti-slop

Synced from commit: `e8c4880471b23ab7f216fba7b27d173a6ef07d4c`

Upstream intentionally does not publish an official npm package and instructs consumers to vendor the plugin. This copy contains the runtime files from upstream `src/` and omits upstream tests. `LICENSE` preserves the upstream MIT license.

When updating:

1. Pin the upstream commit in this file.
2. Copy the non-test files from upstream `src/`.
3. Keep `oxlint` and `@oxlint/plugins` on exactly matching versions.
4. Run `pnpm check`.
