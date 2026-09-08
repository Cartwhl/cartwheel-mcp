# Security

The server is a local stdio process. It does not listen on a network port, run shell commands, or provide filesystem tools.

API tools map to explicit operations on Cartwheel's public production API. The destination origin is fixed. Tool arguments cannot select a host, URL, HTTP method, or authentication identity. Redirects are rejected, IDs are constrained to safe characters, and request bodies are validated before transmission. The API enforces the permissions of the caller's project key.

The 22 tools comprise 13 read operations and nine write operations: preparing uploads, text/video generation, scene creation, looping, stitching, prompt/path editing, key-pose editing and applying an edit. Model operations consume service resources and may consume credits. Mutations are never automatically retried. Applying an edit is marked destructive because it replaces a scene slot's performance; the MCP verifies accessible slot membership and completion before applying it. Editor constraint schemas are closed and reject hidden callback, identity and pipeline configuration fields. The server does not expose account administration, billing, deletions, email subscriptions, or callback registration.

`analyze_motion` first requests an authorized motion from the fixed public API, then fetches only its returned BVH on the two explicitly allowed Cartwheel production S3 hostnames. The asset request contains no API key, rejects redirects, is time-limited, and enforces a 24 MiB streaming limit. Parsing validates the bounded BVH hierarchy, frame count, cadence, channels and finite values before Three.js performs forward kinematics. The tool does not accept an arbitrary URL or filesystem path and does not modify the motion. It returns numerical metadata, assumptions, provenance and clearly labeled heuristics, not an asset URL or raw transport diagnostics.

Preparing an upload returns a signed URL; it does not read or upload a local file. The optional `examples/comic4/upload-video.mjs` helper runs separately under the MCP client's authority and reads the one file explicitly supplied to it. It permits HTTPS uploads only to Cartwheel's production media bucket, rejects redirects, checks file size and extension, and never sends the project API key to storage. Use only video you are authorized to upload. Signed upload and download URLs grant temporary access and must remain private.

Set `CARTWHEEL_API_KEY` through your MCP client's secret storage or a local environment file. Never commit it. The package uses an explicit file allowlist that includes reviewed workflow scripts and example assets, while excluding environment files, raw API responses, rendered movies, screenshots, and generated Blender scenes. Protocol tests use mocked requests and require no credentials.

The game preparation and pose-sampling helpers run separately under the client's local execution authority. They read/write only the paths explicitly supplied by that client. The optional `examples/game/serve.mjs` is a separate preview server bound to `127.0.0.1`, with Host checks and restricted static paths; it serves no environment files or API credentials and has no API proxy. The browser uses a bundled character and prepared motion assets; external URLs are not needed for playback. Do not run the preview server as a public production hosting service.

Returned motion data and signed asset URLs are available to your MCP client and its model provider. Treat asset metadata as untrusted content. Do not publish raw API responses or signed URLs in screenshots, logs, issues, or demos. HTTP failure bodies and transport diagnostics are omitted from tool results.

To report a vulnerability, contact support@getcartwheel.com. Do not put credentials or exploitable details in a public GitHub issue.

The three prompts and workflow resources contain guidance and the installed example directories. Reading a workflow does not execute Blender, launch the game server, download files, or read arbitrary filesystem paths. The client controls local execution while following the guides.
