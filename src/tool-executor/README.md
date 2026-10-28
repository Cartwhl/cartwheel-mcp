# Reusable tool executor

The existing `@cartwhl/mcp-server` package exposes the reusable executor as
`@cartwhl/mcp-server/tool-executor` for CommonJS and ESM consumers. It shares
the local server's canonical tool definitions, validation, execution and safe
output handling; it does not create a separate package or release. The local
stdio server and its [workflow resources](../workflows/) remain available.

```js
import { executeTool, definitions } from '@cartwhl/mcp-server/tool-executor';

const tools = definitions; // Use these canonical definitions in the adapter.
const result = await executeTool('list_characters', {}, {
  apiKey: process.env.CARTWHEEL_API_KEY,
  environment: 'production', // or 'staging'
});
```

`executeTool(name, args, options)` validates inputs, calls only fixed staging or
production API origins, rejects redirects, enforces a 1 MiB JSON response cap,
projects normal API outputs, and never automatically retries. Options include
`apiKey`, `environment`, `signal`, `timeoutMs`, `fetchImpl`, optional
`requestJSON(url, init, remainingMs)`, `createdByUser`, and `specialHandler`; `analyze_motion` requires
a caller-provided local special handler. The caller owns authentication,
exposure allowlists, client metadata and sanitized error handling. Preserve the
canonical definitions and semantics; annotations are not an exposure policy.
Credentials are passed by the caller and are neither discovered nor cached.
Injected `requestJSON` must enforce its own body/deadline bounds; special handlers
must preserve output safety. One deadline covers preflight and execution. Some
synchronous operations require at least 240 seconds; hosted adapters must enforce
their shorter overall deadline.
`toolRequest(name, args)` returns the validated `{ tool, args, path, body }`.
Other exports include `ToolInputError`, `origins`, `keyPose`,
`projectToolOutput`, `safeAsset`, `JSON_LIMIT`, `withinJSONLimit`,
`isProcessingTool`, and response-size error types.

For hosted MCP architecture and current integration guidance, see the
[hosted MCP overview](https://github.com/Cartwhl/cartwheel-mcp-hosted/blob/main/docs/OVERVIEW.md)
and [hosted service repository](https://github.com/Cartwhl/cartwheel-mcp-hosted).

This source checkout includes source-neutral HTTPS video import support. It
validates untrusted source URLs, requires public DNS answers, rejects redirects,
and streams bounded video bytes into the existing signed-upload flow. The
source URL is never sent to Cartwheel with the API key. This does not expose a
local source-URL tool or submit generation. These changes are in the current
source tree and are not part of npm 0.7.0; consumers need a source commit
containing them until a release is published.

`importVideo(input, options)` and `validateVideoImport(input)` take `downloadURL`,
`extension`, declared `duration`, optional `name`/`resolution`; the caller supplies
authorized `createUpload({ media: [metadata] }, signal)`. Import uses public-only DNS validation
and connection pinning with hostname TLS verification, not a hostname allowlist.
It rejects private/mixed addresses, redirects, non-443 HTTPS and URL credentials.
Storage is restricted to the production/staging media S3 buckets' exact global
and `us-east-1` regional HTTPS origins. Known unencoded
positive Content-Length <250 MB and duration ≤30s are required. Complete source
bytes, consumed upload body and storage 2xx before deadline are all required for
`uploaded:true`; an error's mediaID is not confirmation. No generation or retry.

## Output and processing contracts

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
exact original pose count or unlimited custom-rig support. The 300-pose limit,
numeric/vector bounds, credential and URL safety, and aggregate 1 MiB cap remain
in force. Reading a pose does not imply that write tools accept it unchanged.

The catalog owns input bounds, descriptions, annotations and supported output schemas.
The executor bounds JSON responses to 1 MiB, projects cataloged outputs, validates
signed asset hosts, preserves ordered multi-actor slots, and rejects API-key/Bearer
reflection. `projectToolOutput` is also exported for adapters and accepts extra
secrets to reject. Injected transports must enforce the same byte bound before parsing.

`get_motion` accepts its existing `characterID`, `downloadType`, `fps` and `bodyIndex`
arguments. Its conservative annotations acknowledge synchronous retarget processing.
`isProcessingTool` classifies a status-only call as a read and a call with `characterID`
as processing, so transports can budget correctly without guessing from HTTP GET.
The default retarget deadline is 35 seconds; explicit caller deadlines remain honored.
Adapters must report uncertain processing outcomes without automatic retries.
Hosted release exposure remains a separate explicit allowlist, not an annotation filter.

## Video transport safety contract

`validateVideoImport` validates metadata and the HTTPS source URL boundary before
credential lookup. The upload callback is `createUpload({ media: [metadata] }, signal)`
using the unchanged `create_media_upload` executor. API keys belong only in that
callback's fixed-origin API execution, never download or storage headers.

Sources are untrusted regardless of the client or authentication. Any HTTPS host
can supply bytes, including ChatGPT's Azure attachment hosts and other clients'
sources. Only port 443 is accepted (explicit `:443` is allowed); URL credentials,
fragments and redirects are rejected. Literal IPs and **every** DNS answer must
be public: private, loopback, link-local/metadata, multicast, reserved and
special-purpose addresses are rejected, including IPv4 aliases and IPv6 mapped
or translation forms. Mixed public/private DNS answers fail closed.

The built-in Node HTTPS source transport validates DNS inside its controlled
lookup and hands one validated address directly to that same TLS connection.
Each download uses its own cancellable DNS Resolver for A and AAAA, with no
workerpool `getaddrinfo` or OS-lookup fallback. Both families must finish before
selection; only `ENODATA` means an absent family. All other DNS errors fail closed
and cancel pending sibling queries. Abort/deadline cancels the native DNS requests
as well as the HTTPS connection, so cancelled imports cannot accumulate DNS work.
It keeps the original hostname for SNI, certificate verification and Host, uses
no pooled agent or secondary DNS/fallback, never follows redirects and does not
use proxy environment variables. This avoids resolve-then-fetch rebinding/TOCTOU
without another dependency. `fetchImpl` handles only storage PUTs; the separate
`downloadSource` backend test seam must preserve this policy if replaced. Neither
transport accepts API/OAuth credentials. No local source-URL tool is exposed.
Storage requires a signed URL and matching extension.

Download must be HTTP 200, unencoded, non-partial, with a positive integer
Content-Length of at most 249,999,999 bytes. Missing/invalid length fails before
media registration; this avoids S3's incompatibility with unknown-length chunked
PUTs. No buffering to disk or whole-file memory is used. The byte-counting stream
holds the last chunk until EOF, rejects length mismatches, propagates backpressure,
and sends an explicit Content-Length with Node fetch's `duplex: 'half'`.
Validation applies to the HTTP entity exposed by the transport, not bytes outside HTTP
Content-Length framing. Duration (0 < seconds <= 30) and optional resolution are
caller-declared metadata; no binary probing or video-content verification occurs.

One deadline (maximum/default 38 seconds) covers download, registration and PUT;
adapters must also include credential lookup in their overall budget. All phases
are cancellable, including raced transports/reads that ignore abort. There are no
automatic retries. Source EOF/length validation alone is insufficient: the PUT
body must also have been consumed through its readable end event. An early 2xx
with an unread upload tail fails immediately; the helper never drains the tail
itself to manufacture completion. Only these checks plus PUT 2xx before deadline return
`{ uploaded: true, mediaID, bytes }`. Failures return `uploaded: false`, a fixed
error code and the validated mediaID when known. Such an ID is a slot, not proof
of upload; transport uncertainty can leave an uploaded object or an empty slot.
No signed URL or raw transport diagnostic is returned. Invalid input throws
`VideoImportError` before any I/O. The local catalog and
`examples/comic4/upload-video.mjs` retain their existing client-run flow.

Catalogs and shared constraints live here; parent `.mjs` modules retain their local
imports as re-exports. Existing package file subpaths remain available.
The current shared source pin is `397262a9ba38ef06fe4c3f09d2e5b5d473664c2f`;
npm 0.7.0 predates this subpath. Until a release includes it, consumers must pin
an immutable repository commit containing this module. The unchanged manifest
version does not mean npm 0.7.0 contains this API.

Run `npm ci`, `npm test`, and `npm run check:package` at the repository root.
