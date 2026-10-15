# Reusable tool executor

The existing `@cartwhl/mcp-server` package exposes `@cartwhl/mcp-server/tool-executor`
to both CommonJS `require` and ESM named imports. It has no separate build or release.
Existing package file subpaths remain available for compatibility.

Exports: `definitions` (all 32 local tools), `toolRequest`, `executeTool`,
`ToolInputError`, `origins`, and the shared `keyPose` schema.

`toolRequest(name, args)` validates catalog schemas and semantic constraints, then
returns `{ tool, args, path, body }`. `executeTool(name, args, options)` uses fixed
staging/production API origins and forbids redirects. Options supply `apiKey`,
`environment` (default production), `createdByUser`, `signal`, `timeoutMs`,
`fetchImpl`, optional `requestJSON(url, init, remainingMs)`, and `specialHandler`.
One deadline covers preflight checks and execution. Some local long operations
require at least 240 seconds. `analyze_motion` needs a local special handler.

The caller owns authentication, exposure policy, response bounds and output/error
sanitization. The default transport uses `response.json()` for local use. An
adapter needing bounded responses must inject `requestJSON`. Credentials are
caller-supplied; this module does not discover user credentials or cache keys.

Catalogs and shared constraints live here; parent `.mjs` modules retain their local
imports as re-exports. Run `npm ci`, `npm test`, and `npm run check:package` at root.

The npm 0.7.0 release predates this subpath. Until a release includes it, consumers
must pin an immutable public repository commit containing this module. Do not
assume the unchanged manifest version means npm 0.7.0 contains this API.
