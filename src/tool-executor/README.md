# Reusable tool executor

The existing `@cartwhl/mcp-server` package exposes `@cartwhl/mcp-server/tool-executor`
to both CommonJS `require` and ESM named imports. It has no separate build or release.
Existing package file subpaths remain available for compatibility.

Exports: `definitions` (all 32 local tools), `toolRequest`, `executeTool`,
`ToolInputError`, `origins`, and the shared `keyPose` schema. Safety exports are
`projectToolOutput`, `safeAsset`, `JSON_LIMIT`, `withinJSONLimit`, and
`isProcessingTool(name, args)`.

`ResponseTooLargeError` is the safe byte-overflow signal for injected transports.
The canonical executor converts it to `SceneListTooLargeError` for `list_scenes`;
adapters return its sanitized `result` (`code: scene_list_too_large`,
`retryable: false`, guidance and, when possible, `suggestedLimit`). Halve an explicit
limit, rounding down with minimum 1; with no explicit limit, suggest 1 rather than
guessing the API default. At limit 1, stop without a retry suggestion. No call is
retried automatically and a smaller page is not guaranteed to fit. Other tools
retain their existing failure/outcome handling. Never classify by remote error text.

Persisted scene/edit key poses allow 1–512 rotation triples and optional
`smoothRoot2d`; writes still allow 1–256 and require `smoothRoot2d`. This is a
read-compatibility ceiling, not a skeleton identity/compatibility check. The bundled
MHR GLB has 127 skin joints and 56 leaves (183 entries with leaf End Sites); its
prepared body BVHs have 127 entries. Those assets do not define a maximum for
saved native editor snapshots. The reported saved MHR poses exceed 256, so 512
doubles the previous read ceiling to provide bounded headroom without claiming an
exact original pose count or unlimited custom-rig support. The 300-pose limit, numeric/vector bounds, credential
and URL safety, and aggregate 1 MiB cap remain in force. Reading a pose does not
imply that the write tools accept it unchanged.

`toolRequest(name, args)` validates catalog schemas and semantic constraints, then
returns `{ tool, args, path, body }`. `executeTool(name, args, options)` uses fixed
staging/production API origins and forbids redirects. Options supply `apiKey`,
`environment` (default production), `createdByUser`, `signal`, `timeoutMs`,
`fetchImpl`, optional `requestJSON(url, init, remainingMs)`, and `specialHandler`.
One deadline covers preflight checks and execution. Some local long operations
require at least 240 seconds. `analyze_motion` needs a local special handler.

The catalog owns input bounds, descriptions, annotations and supported output schemas.
The executor bounds JSON responses to 1 MiB, projects cataloged outputs, validates
signed asset hosts, preserves ordered multi-actor slots, and rejects API-key/Bearer
reflection. `projectToolOutput` is also exported for adapters and accepts extra
secrets to reject. Injected transports must enforce the same byte bound before parsing.
The caller owns authentication, exposure, client metadata and sanitized errors;
it must preserve canonical tool definitions rather than redefine their semantics.
Credentials are caller-supplied; this module does not discover credentials or cache keys.

`get_motion` accepts its existing `characterID`, `downloadType`, `fps` and `bodyIndex`
arguments. Its conservative annotations acknowledge synchronous retarget processing.
`isProcessingTool` classifies a status-only call as a read and a call with `characterID`
as processing, so transports can budget correctly without guessing from HTTP GET.
The default retarget deadline is 35 seconds; explicit caller deadlines remain honored.
Adapters must report uncertain processing outcomes without automatic retries.
Hosted release exposure remains a separate explicit allowlist, not an annotation filter.

Catalogs and shared constraints live here; parent `.mjs` modules retain their local
imports as re-exports. Run `npm ci`, `npm test`, and `npm run check:package` at root.

The npm 0.7.0 release predates this subpath. Until a release includes it, consumers
must pin an immutable public repository commit containing this module. Do not
assume the unchanged manifest version means npm 0.7.0 contains this API.
