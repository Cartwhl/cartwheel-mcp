# Internal tool executor

Local stdio and hosted HTTP entry points import this same module and catalog.
It ships inside the root MCP package; there is no workspace, separate release,
build step, or user-api executor dependency. Explicit `.cjs` extensions keep these
CommonJS modules compatible with the root ESM manifest. Ajv comes from the root.

```text
local stdio → project API key → src/tool-executor/index.cjs → fixed motion API
hosted HTTP → user OAuth + service SigV4 → user-api credential resolution
            → request-scoped key → same index.cjs → fixed motion API
```

## Responsibilities

- `tools.json`, `game-tools.cjs`, `scene-tools.cjs`, and `character-tools.cjs`
  define all **30 local tools**. `swing-edit-constraints.cjs` owns pose/constraint
  schemas and semantic checks; the parent `.mjs` files re-export these definitions.
- `index.cjs` validates input, assembles catalog routes, fixes staging/production
  origins, forbids redirects, and preserves exact-character, scene-reference and
  edit-history checks. Callers supply credentials, audit identity, cancellation,
  transport and local special handlers. One deadline covers preflight and execution.
  `analyze_motion` stays in the local adapter, keeping Three out of this module.
- `hosted.cjs` explicitly selects **16 motion tools** from the same catalog;
  `get_profile` remains in the hosted adapter (**17 total** when motion is enabled).
  New catalog entries are never automatically exposed. Hosted input is bounded,
  unknown arguments rejected, Swing generation translated, and pagination defaulted.
  Output is recursively projected and schema-checked, including asset domains.

Hosted input envelopes and projected output are capped at **1 MiB**. Pose saves
allow 0–300 poses with 1–256 joint rotations each, subject to that aggregate cap.
Legacy output poses may omit `smoothRoot2d`; writes still require it. String hand
poses and numeric variation ID zero are preserved. Invalid optional motion
numbers/URLs are omitted without coercion.

Adapters own authentication, bounded response reading and public error sanitization.
Hosted execution must inject its bounded transport rather than the local default
`response.json()`. Credentials are request-scoped. No automatic retries occur;
resolver failures are pre-submission, while uncertain attempted writes return
`generation_outcome_unknown` or `mutation_outcome_unknown`. Hosted `get_motion`
reads existing assets only; synchronous retargeting and `apply_motion_edit` remain
local. See [hosted contracts and deadlines](../../docs/HOSTED.md).

## Verification

Run `npm ci`, `npm test`, and `npm run check:package` from the repository root.
Execution tests cover fixed origins, shared deadlines, exposure, schemas and byte
bounds; root packaging tests require every internal runtime/catalog file. Review
catalog/local regressions, then hosted adapter and IAM credential boundaries.
