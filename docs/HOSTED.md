# Hosted OAuth: profile by default, opt-in motion

This is a **separate** entry point:

```text
ChatGPT → HTTPS /mcp → verify Connected App access token → get_profile
    ↳ Stytch discovery → frontend /oauth/authorize → regular login + consent
                      → Stytch code exchange (PKCE) → ChatGPT
```

By default only `get_profile({})` is available. Opt-in motion authenticates the **company service with AWS IAM**, independently of the user OAuth token, to resolve the exact consent-selected API key from user-api on every tool request. Hosted MCP then calls the shared executor with that key. The key stays only in the request's memory, never in a cross-request cache or a browser/model response. The motion API still owns billing and asset access. Existing `npm start` / `src/index.mjs` and all 30 local tools are unchanged. No deployment or Stytch dashboard changes are automated here.

## Fixed ChatGPT and Claude clients

`STYTCH_CLIENT_ID` remains ChatGPT's pre-registered client. Optionally set
`MCP_CLAUDE_CLIENT_ID` to a **different**, manually registered Connected App in the
same Test/Live project. With it unset, Claude is disabled. Both clients must issue
RS256 access tokens with the same exact issuer, project audience and MCP resource
audience; all existing claims/scope checks remain required. No DCR, CIMD, incoming
client registration or arbitrary client acceptance is implemented.

Register Claude's actual callback(s) and authorization UI URL manually in Stytch;
its ID and callbacks are currently unknown. Configure its ID in homepage as
`VITE_HOSTED_MCP_CLAUDE_CLIENT_ID`, and in user-api as `MCP_CLAUDE_CLIENT_ID`.
Callbacks live in Stytch, not backend environment configuration. Backend type defaults to public; confidential
registration requires its own type and secret ARN (see user-api `HOSTED_MCP.md`).
Never add Claude callbacks to ChatGPT's list just to make preflight succeed.

The opaque `get_profile.id` remains the hash of issuer/subject: the same account
has the same profile across clients and reconnections. Motion forwards the
**original verified user token in a SigV4-signed custom header**, retaining its `client_id`; the backend selects that
client's independent immutable key binding. Disconnecting Claude disables only
Claude's Cartwheel tool permission, leaving its Stytch grant and ChatGPT's binding intact. The MCP caller IAM role
is company service identity, never a replacement for either user's authorization.

## Optional hosted motion

Set `MCP_MOTION_ENABLED=true`, `MCP_USER_API_ENVIRONMENT=staging`,
`MCP_USER_API_REGION=us-east-1` (verify the deployed HTTP API region) and
`MCP_USER_API_URL=https://user-staging.api.getcartwheel.com/mcp/credential` explicitly.
For production use environment `production`, exact URL
`https://user.api.getcartwheel.com/mcp/credential`, and matching live Stytch project/client IDs.
Only these two exact canonical URLs are accepted: no arbitrary hosts, ports, paths,
query strings, credentials, URL normalization aliases, or redirect following.
Missing/mismatched enabled configuration fails startup. The default is disabled;
`false` leaves the successful profile-only prototype working without backend configuration.

### Service authentication and credential flow

```text
AI client --user OAuth--> hosted company MCP
                           | validate arguments first
                           | POST {} /mcp/credential, SigV4 + signed user token
                           v
                        user-api: IAM role + user JWT/introspection + current binding/access
                           | no-store {apiKey, createdByUser, expiresAt}
                           v
                        hosted MCP src/tool-executor --x-api-key--> fixed motion API
                           | bounded, projected, schema-checked output only
                           v
                        AI client
```

`Authorization` on the credential request is **AWS4-HMAC-SHA256**, service
`execute-api`, explicitly configured region. The original user token (no Bearer
prefix) is in **`x-cartwheel-oauth-token`**, covered by the signature along with host,
content type, date and the SHA-256 of literal `{}`. Temporary AWS session credentials
include `x-amz-security-token`. There are no caller-supplied key IDs/operations,
cookies, query parameters or identity overrides. User-api's old `/mcp/invoke` route
is removed. No browser route can retrieve the credential.

Use the standard AWS SDK default credential chain. Locally set `AWS_PROFILE` to a
company profile that assumes **user-api's exact `MCP_CALLER_ROLE_ARN`**; an arbitrary
developer IAM user/role is denied even if it can invoke other APIs. For future AWS
Lambda hosting, use the **Lambda execution role** matching that configured caller
role. SigV4 signing is still required. No custom shared secret or service JWT,
no static AWS keys in examples/config/source, and no per-user AWS role is needed.

Provision that caller role in the API account with only `execute-api:Invoke` on:

```text
arn:aws:execute-api:<region>:<api-account-id>:<http-api-id>/prod/POST/mcp/credential
```

Use user-api's CDK output `McpCredentialInvokeArn<suffix>` for the exact resource.
Both vanity-domain hosts map to the **`prod` stage**, not `$default`; do not use a
wildcard stage. This stage is part of the IAM resource only: the public URL and
SigV4 canonical path remain **`/mcp/credential`**, without a `/prod` prefix.
Keep role trust restricted to company workloads/developers. Hosted MCP needs no
`apigateway:GET`, DynamoDB, Stytch secrets or `lambda:InvokeFunction` grants. The
user-api execution role alone retrieves key values from API Gateway. Its handler
pins the IAM role/account as well as the user authorization; HTTP API IAM itself
does not support resource policies. CORS is not this security boundary. See
user-api `HOSTED_MCP.md` for canonical/STS role matching and direct Lambda invocation
trust. Verify actual v2 event/header delivery and signed/unsigned/unknown-role
negatives before enablement; do not relax a missing IAM context/header check.

Treat credential responses as secrets: disable request/response-body and sensitive
header capture in proxies, APM/tracing and logs. Redact `authorization`,
`x-cartwheel-oauth-token`, `x-amz-security-token`, `x-api-key` and credential bodies.
The resolver's raw errors/headers never reach model output. The key is reusable:
OAuth expiry/disconnect prevents new resolution, but cannot recall an already
delivered key or cancel authorized/submitted work. The company MCP is explicitly
trusted to use it only in the current request. AWS credential-provider caching is
service-identity caching, not a user-token/API-key cache.

Enabled tools (in addition to the unchanged `get_profile`):

The shared executor extension adds twelve operations to the four below: **16 motion
tools, 17 total**. See [the internal executor guide](../src/tool-executor/README.md)
for module boundaries and verification; `hosted.cjs` defines exact input/output
schemas. New tools are `get_character`,
`list_scenes`, `get_scene`, `get_motion`, `search_motions`, `list_motions`,
`create_scene`, `list_motion_edits`, `get_motion_edit`, `save_key_poses`,
`export_scene`, and `get_scene_exports`. `apply_motion_edit` is deferred because its
upstream path can synchronously retarget/restitch beyond the execution budget.
Hosted `get_motion` reads existing assets only; retarget/transform inputs stay local.
Scene/pose/export writes use the generation-length timeout and return
`mutation_outcome_unknown` on uncertain outcomes, never an automatic retry.
The default profile-only mode and original four contracts remain compatible.

| Tool | Arguments | Result |
| --- | --- | --- |
| `list_characters` | Optional integer `limit` 1–50 (default 20), `nextToken` | `characters`, optional `nextToken` |
| `generate_motion` | `prompt` 1–2000 nonblank characters without controls, `characterID`; optional `durationSeconds` 3–8 (default 5), `exportType` `fbx-blender` (default), `bvh`, or `glb` | `batchID`, `status`, optional wait/job counts |
| `get_batch` | `batchID` | `batchID`, `status`, optional wait/job counts |
| `list_batch_motions` | `batchID`; optional `limit`, `nextToken` | `items`, optional `nextToken`, `hasMore` |

Identifiers are at most 256 characters matching `[A-Za-z0-9][A-Za-z0-9_-]*`;
pagination tokens are nonblank, control-free strings of at most 4096 characters.
Unknown arguments are rejected. Shared hosted translation applies defaults before resolution.
Generation submits one asynchronous **Swing-only** request. It consumes existing
credits/balance and has **no separate ChatGPT spending limit**. Its descriptor marks
it as a non-idempotent paid/destructive write; read tools are read-only/idempotent.
These hints do not authorize payment: `openid profile` are identity scopes only.
The backend independently verifies/introspects each token and strongly checks the
active paid-consent binding, current membership, project and exact selected key.

The approved MVP uses **one immutable selected key ID per issuer/user/ChatGPT
client/resource**, shared across that user's ChatGPT connections. Disconnect
disables only the binding, not OAuth or identity-only access. Explicit same-key
reapproval can reenable **still-valid tokens issued before disconnect**. Permission
is persistent user/client permission, saved independently of browser OAuth
completion; a failed/closed OAuth flow does not undo explicit paid approval.
Changed-key rebinding remains blocked even after disconnect. Hosted MCP never chooses an alternate key.
See the backend's `HOSTED_MCP.md` for browser consent/disconnect contracts.

Read calls have a 10-second total deadline; writes have 32 seconds, including AWS
credential resolution/signing and the user-api lookup. Writes require at least
22 seconds left **before** execution; execution is at most 24 seconds (including
history preflight), accommodating upstream's 20-second generation wait. No paid
submission happens after a resolver failure/expired token/insufficient budget.
Client cancellation aborts outgoing transport; it does not undo accepted work.
The deadline covers response bodies, capped at exactly **1 MiB / 1,048,576 bytes**
for both resolver and motion responses, even chunked. Projected outputs and motion
input validation retain the same cap. MCP structured/text output contains two
copies of the bounded projection, not a 1 MiB protocol-envelope guarantee. Enabled
MCP JSON ingress is 1 MiB; 0–300 poses fit subject to that aggregate cap. Profile-only
ingress remains 16 KiB; browser consent remains 20,000 bytes; `/mcp/credential`
accepts only empty JSON (max 1,024 bytes). Configure the hosting
platform/reverse proxy response timeout above 32 seconds, with margin for JWT
verification; Node's 15-second request-upload timeout is separate.
There are **no automatic retries**, including on redirects, transport errors,
malformed success, or timeouts. **Resolver failures are pre-submission errors, not
unknown mutations.** Only after motion transport is attempted does uncertain generation return
`generation_outcome_unknown`, `retryable: false`: inspect Cartwheel batch history
before a new explicit attempt. No generation idempotency protocol is provided.

Successful results are recursively allowlisted and output-schema validated by
`projectHostedOutput`. Hosted execution always injects a bounded transport instead
of using the executor's unbounded local `response.json()` default. Both user-token
and key reflection are rejected even inside allowed fields. Numeric variation ID
zero survives; malformed optional motion numbers/URLs are omitted without coercion.
Signed HTTPS Cartwheel/AWS asset URLs are intentional download capabilities and
are preserved; do not log them. Raw backend errors, headers, nested metadata and
unknown fields are discarded. Error codes/statuses are matched to static local
messages, always nonretryable. Backend `401` returns an MCP error with a locally
constructed `_meta["mcp/www_authenticate"]` challenge; binding/key `403` is an
explicit paid-access error, not an OAuth scope upgrade. Errors never silently
downgrade discovery to profile-only. No bearer appears in tool outputs or logs.

### Deployment gates

Future hosting should follow the existing apps' **AWS Lambda** approach. The
current `src/hosted.mjs` starts a bare Node HTTP server for local/proxy testing;
it is not a Lambda handler. A Lambda adapter, API Gateway integration timeouts
(including the current 32-second write budget plus JWT verification), and MCP
response/streaming behavior still need assessment before choosing the deployment
integration. No hosting infrastructure or adapter is implemented here.

This implementation is not a deployed/end-to-end verified connector. Before
enabling it, complete the backend's `HOSTED_MCP.md` release gates: publish its
matching DAO dependency, resolve CDK tooling/deployment, remove upstream credential
logging, verify the root MCP package includes `src/tool-executor` (the internal
module has no separate publication gate or user-api dependency), verify the caller role/trust policy and
exact execute-api grant, gateway v2 IAM context/signed-header delivery and old-route
removal, and live Stytch introspection/configuration,
and deploy the matching browser-SDK paid consent UI. It saves permission through
user-api, then submits authorization directly to Stytch; the default profile-only
mode below does not create a paid binding. Verify the same
issuer/project/client/resource in all three units. Run an explicitly approved
staging smoke test before production; these tests make no live paid calls.
Persistent user/client permission intentionally shares the same key across valid
old/new tokens; key replacement is not supported. This unit adds no spend cap or per-chat key isolation. Obtain an independent
security review of the cross-service credential boundary before enabling it.

## 1. Agree on the URLs and identifiers

Set these **nonsecret** values in a local `.env` (gitignored) or process environment:

| Variable | Meaning |
| --- | --- |
| `MCP_PUBLIC_URL` | Exact canonical HTTPS endpoint, e.g. `https://mcp.example.com/mcp`. Must end in `/mcp`, without query, fragment, or trailing slash. Used for discovery and token audience validation. |
| `STYTCH_ISSUER` | Exact HTTPS project/custom **origin** from Stytch discovery, without a trailing slash. Not `api.stytch.com`, the frontend login URL, or the legacy `stytch.com/project-…` issuer. |
| `STYTCH_PROJECT_ID` | `project-test-…` from the **same Consumer project** used by regular Cartwheel frontend login. |
| `STYTCH_CLIENT_ID` | `connected-app-test-…` of the pre-registered ChatGPT Connected App. Optional `MCP_CLAUDE_CLIENT_ID` adds the separately registered Claude client. |
| `HOST`, `PORT` | Listen address/port; default `127.0.0.1:3001`. |
| `MCP_ALLOWED_ORIGINS` | Optional comma-separated, exact browser origins (no trailing slash). The MCP public origin is allowed automatically; requests without `Origin` are allowed. No wildcard or cookie authentication. |

There is **no Stytch project secret or OAuth client secret in this service**. Do not add credentials to source, examples, issue reports, or logs. The project public token belongs to the frontend, not here.

## 2. Configure a Test Connected App manually

Use the regular application's **Consumer Stytch Test project**, not a new B2B project. Confirm all values in the dashboard before using them; example domains are placeholders.

1. In **Connected Apps**, set **Authorization URL** to the frontend's reachable `https://<frontend-host>/oauth/authorize`. It is **not** the MCP URL and **not** ChatGPT's callback. The frontend route is separate work in the frontend repository.
2. Pre-register ChatGPT as a **third-party** app so the user must grant consent. Prefer `third_party_public` when the client UI supports preconfigured client ID + `none` authentication: Stytch requires S256 PKCE and no client secret. If that UI requires a secret, use `third_party` (confidential), store the secret only in ChatGPT's OAuth settings/your local secret manager, and still use S256 PKCE. Never put a client secret in the frontend.
3. Copy the **exact redirect URI shown by ChatGPT's MCP management screen** into the Connected App's redirect allowlist. Do not guess it: current ChatGPT uses either a callback-specific URL or the stable callback depending on the authorization server's issuer-identification support. For Inspector, use its separately displayed callback; use a separate Test client and update `STYTCH_CLIENT_ID` for that test.
4. Set the Connected App's **`access_token_custom_audience` to the exact `MCP_PUBLIC_URL`**, including `/mcp`. This is mandatory for this implementation. Keep custom token templates unset; do not copy session or ID-token claims into access tokens. Recommend **`access_token_expiry_minutes: 5`** for this Test MVP (Stytch's default is 60).
5. Enable/request **`openid profile`**. No custom RBAC scopes or `full_access` are needed. ChatGPT may also request the issuer's advertised OIDC scopes: the frontend accepts optional `email`, `phone`, and `offline_access`, and explains each requested permission before approval. This MCP still returns only an opaque profile ID. Stytch only issues a refresh token when `offline_access` is granted. Without it, reconnect after expiry.
6. Inspect `<STYTCH_ISSUER>/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`: the exact issuer, frontend authorization URL, Stytch token/JWKS endpoints, supported client authentication method, and `code_challenge_methods_supported: ["S256"]` must be correct. If issuer identification is advertised, successful **and error** callbacks must include the matching `iss`.

Stytch handles code issuance, code exchange, PKCE, consent, and client registration. ChatGPT supports predefined clients, CIMD, and DCR; **use predefined registration for this first test**. No registration endpoint is implemented in this service. Its fixed allowlist accepts ChatGPT and optionally the separately registered Claude client, not arbitrary DCR/CIMD clients.

### Frontend handoff: `/oauth/authorize`

- The frontend implementation is in `frontend-monorepo/apps/homepage/src/components/OAuthAuthorizePage`; its setup guide is `apps/homepage/docs/hosted-mcp-oauth.md`. Both modes reuse Stytch's headless consent APIs, browser session validation and the **same Test project/session**. Hosted motion additionally requires explicit existing-key paid permission through user-api. Backend cookies alone cannot prove an SDK session.
- Preserve the authorization request through login and return: `client_id`, `redirect_uri`, `response_type`, `scope`, `state`, `nonce`, PKCE parameters, **every `resource` parameter**, and optional `prompt=consent`. The frontend accepts but ignores `id_token_hint` and removes it from the login return URL; the browser session determines identity. Keep login return paths local/allowlisted; never treat the OAuth client's `redirect_uri` as an unchecked application redirect.
- For this dedicated single-resource MVP, reject a missing or mismatched resource for this client instead of silently rewriting it. ChatGPT must send `resource=<MCP_PUBLIC_URL>` at authorization **and** token exchange. Do not drop it when rendering consent. Stytch's headless authorize API calls this input `resources: string[]`; use a frontend SDK version that preserves it when using the prebuilt component.
- Configure the Stytch frontend SDK's `customBaseUrl` to the same project/custom domain used in discovery, as described in Stytch's custom-domain guide. Allowlist the frontend origin and its normal login callbacks in Stytch's Frontend SDK settings.
- Stytch, not this MCP service, validates registered client callbacks and generates the authorization response. Never forward the regular frontend session JWT as an MCP access token.
- Approval submits explicit consent. Decline cancels locally without issuing a code or navigating to a callback; return to ChatGPT to cancel its pending connection. It does not revoke an existing grant. This avoids treating Stytch's `consent_granted: false` (which can continue an already-approved grant) as cancellation.

## 3. Start locally and expose HTTPS

Requires Node 22+ and npm; no build step or platform-specific runtime:

```sh
npm ci
npm run start:hosted
```

Supply the variables above through `.env` or environment. `CARTWHEEL_API_KEY` can be absent. Use an HTTPS tunnel/reverse proxy forwarding to `http://127.0.0.1:3001`; **preserve the public `Host` header**. If using a container/network proxy, set `HOST=0.0.0.0` explicitly and firewall the plain-HTTP listener so only the TLS proxy can reach it. The public resource remains HTTPS. Configure proxy request limits/rate limiting and redact authorization headers; this small service has no application-level rate limiter.

The service checks Host against `MCP_PUBLIC_URL` and rejects unexpected browser origins. It deliberately ignores `X-Forwarded-*` for URL construction and security decisions. A tunnel that rewrites Host to localhost needs its host-preservation setting adjusted. Add exact origins to `MCP_ALLOWED_ORIGINS` only for browser clients you intend to allow; the consent page does not need to call MCP directly.

For **local development only**, `MCP_PUBLIC_URL=http://127.0.0.1:3001/mcp` (also `localhost` or `[::1]`) is allowed. Remote ChatGPT cannot reach loopback: switch to the public HTTPS tunnel URL, change the Connected App custom audience, and reauthorize. Do not deploy a shared plain-HTTP URL.

Discovery is public at both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`. Unauthenticated `/mcp` requests return `401` with the canonical `WWW-Authenticate` metadata URL and `openid profile` scope. Invalid tokens return `401 invalid_token`; valid but insufficient scopes return `403 insufficient_scope`. CORS preflight is public, not tool access. Authenticated GET/DELETE return `405`: this stateless, JSON-response Streamable HTTP service has no persistent SSE stream or session deletion endpoint.

## Token and identity contract

Verification uses JOSE RS256 signature checking against the fixed issuer's public JWKS (cached/rotated by JOSE), exact `iss`, required `exp`/`nbf`/`iat`, **both** the project and MCP audiences, pinned `client_id`, Consumer user `sub`, token ID, and exact scope membership. No raw JWT or claims object is returned or logged. Only credential resolution forwards the original access token to user-api, never to motion upstream. A new MCP server and transport are created for **every request**. Only public keys and AWS service credentials may be cached, never user tokens or Cartwheel keys.

**Important Stytch distinction:** the access-token reference documents `aud: [project_id]`, with `access_token_custom_audience` appended. ID tokens instead target the OAuth client, and session JWTs share the project signing keys. `typ: JWT` alone does not distinguish them. This implementation additionally requires the access-token audience/client/scope shape, rejects the Stytch session claim, and rejects a conflicting `token_type` if present. Stytch's Node `introspectTokenLocal` implementation synthesizes `token_type: "access_token"`; relying on that return value alone would not establish token type or resource binding.

**Native `resource` claim limitation:** the current public authorize API documents a `resources` input but the access-token/exchange references checked do **not specify which JWT claim it emits or how token-request resource narrowing changes it**. This MVP therefore relies on the documented, administrator-configured custom **audience**, not a guessed `resource`/`resources` claim and never project audience alone. It does not claim native resource-parameter issuance was verified live. Before the first real connection, confirm in a private Test flow that the **access token** contains both expected audiences and that the frontend preserves `resource`; if not, stop and resolve the Stytch contract rather than relaxing validation. Native resource-only tokens, DCR, and CIMD need separate verification before expanding this MVP.

`get_profile` returns only `{ "id": "prf_…" }`, in both `structuredContent` and JSON text, with `_meta["openai/profile"]: true`, an output schema, and OAuth security schemes. The ID is `prf_` plus base64url SHA-256 of the UTF-8 JSON array `[verified issuer, verified sub]`. This stable identity contract does not depend on token/client IDs, resource URL, scopes, or editable profile fields. Preserve it in future versions; changing the issuer or migrating Stytch users needs an explicit identity migration. We intentionally omit names/emails: OIDC profile/email display claims are in ID tokens/UserInfo, not guaranteed access-token fields. No extra UserInfo call or raw identity dump is made.

### Revocation and replay

`get_profile` and discovery use **local JWT verification**, not online introspection. Revoking consent, disabling a client/user, or logging out does **not** immediately invalidate profile access to an already signed token here. It can be used until `exp` (up to the configured client lifetime; default 60 minutes, recommend 5 for testing). Missing scopes/expired tokens are rechecked on every HTTP request. Motion calls additionally rely on backend online introspection and current binding/key checks on every invocation. Disconnect cannot cancel already-authorized/submitted paid work. Bearer-token replay is possible; use TLS and do not log/copy tokens. There is no token/session cache or local denylist.

## Verification and first live test

```sh
node --test test/hosted.test.mjs
npm test
npm run check:package
```

Tests generate local JWTs and inject static **nonsecret fake AWS credentials**, independently check SigV4 scope/header/body hashing, mock resolver/API transport, and run real loopback MCP initialize/list/call. They cover isolated identities, no key cache, argument-before-credential validation, exact origins/no redirects, capped bodies, token/key reflection, resolver-versus-mutation failure classification, cancellation and existing stdio regressions. They make no live AWS/Stytch/paid API calls and spend no credits.

**Not tested here:** a live Stytch/ChatGPT authorization flow, real project metadata/issued claims, frontend login return/consent, tunnel settings, or dashboard configuration. With Test credentials/configuration, verify login → consent → callback → one `get_profile` tool, reconnect identity stability, a second distinct identity, expiration/reauthorization, and the documented revocation delay. Keep tokens out of recordings, terminal logs, and issue reports.

Official references consulted:
- [OpenAI authentication and profile tools](https://developers.openai.com/plugins/build/auth)
- [Stytch MCP overview](https://stytch.com/docs/guides/connected-apps/mcp-server-overview) and [client types](https://stytch.com/docs/connected-apps/oauth-learn-more/client-types)
- [Access-token claims](https://stytch.com/docs/api-reference/consumer/api/connected-apps/tokens/connected-app-access-token-object), [ID-token claims](https://stytch.com/docs/api-reference/consumer/api/connected-apps/tokens/connected-app-id-token-object), [client custom audience](https://stytch.com/docs/api-reference/consumer/api/connected-apps/application-management/create-connected-app)
- [Authorize input](https://stytch.com/docs/api-reference/consumer/api/connected-apps/consent-management/submit-oauth-authorization), [custom domains](https://stytch.com/docs/connected-apps/resources/custom-domains), [OAuth scopes](https://stytch.com/docs/connected-apps/oauth-learn-more/oauth-scopes)
- [Stytch Node local introspection source](https://github.com/stytchauth/stytch-node/blob/main/lib/b2c/idp.ts)
