# Security

The server is a local stdio process. It does not listen on a network port, run shell commands, or provide filesystem tools.

Every tool maps to an explicit operation on Cartwheel's public production API. The destination origin is fixed. Tool arguments cannot select a host, URL, HTTP method, or authentication identity. Redirects are rejected, IDs are constrained to safe characters, and request bodies are validated before transmission. The API enforces the permissions of the caller's project key.

Generation consumes credits. It is marked as a write operation and is never automatically retried. The other nine tools retrieve data. The server does not expose account administration, billing, deletions, email subscriptions, or callback registration.

Set `CARTWHEEL_API_KEY` through your MCP client's secret storage or a local environment file. Never commit it. The package uses an explicit file allowlist that includes the reviewed Blender scripts and generated BVH examples, while excluding environment files, rendered movies, screenshots, and generated scene files. Protocol tests use mocked requests and require no credentials.

Returned motion data and signed asset URLs are available to your MCP client and its model provider. Treat asset metadata as untrusted content. Do not publish raw API responses or signed URLs in screenshots, logs, issues, or demos. HTTP failure bodies and transport diagnostics are omitted from tool results.

To report a vulnerability, contact support@getcartwheel.com. Do not put credentials or exploitable details in a public GitHub issue.

The Blender prompt and workflow resource contain guidance and the installed example directory. They do not execute Blender, download files, or read arbitrary filesystem paths. The client controls any local execution it performs while following the guide.
