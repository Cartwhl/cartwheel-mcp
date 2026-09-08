# Cartwheel MCP

**Generate, capture and edit motion. Bring it into Blender or a playable game.**

Cartwheel MCP connects your AI assistant to [Cartwheel](https://getcartwheel.com)'s public API. Generate 3D motion from text or capture up to four performers from a video with Comic 4, including facial animation. Edit performances with paths and poses, loop or stitch clips, measure motion metadata, and run the bundled Three.js game reference.

[![After Hours — generated motion rendered in Blender](docs/media/after-hours.gif)](docs/media/after-hours.mp4)

[Watch the Blender demo](docs/media/after-hours.mp4) · [Production setup walkthrough](docs/SETUP.md) · [MCP Blender workflow](#default-blender-workflow-in-mcp) · [More Blender examples](examples/blender/README.md)

## What you need

- **Node.js 22 or newer** and Git.
- **A Cartwheel production account with API access** and a project API key. Check the [current plans](https://getcartwheel.com/pricing); API access is not included in every plan.
- **An MCP client that can launch local stdio servers.** This repository runs on your machine; it is not a hosted MCP URL.
- **Blender only if you want to render the examples.** The MCP server itself does not require Blender.

## 1. Get a Cartwheel API key

1. Open [Cartwheel](https://getcartwheel.com), choose an API-enabled plan, and create your account. Complete email verification and any plan setup shown by the site.
2. Open your Cartwheel dashboard and select **API keys**.
3. Create or reveal a key for your workspace/project. Key management may require a workspace administrator.
4. Copy the **secret key value**. The project ID and API Gateway key ID are not substitutes.

The [setup guide](docs/SETUP.md) includes a recording of the actual production signup interface and the steps that follow.

## 2. Install

```sh
git clone https://github.com/Cartwhl/cartwheel-mcp.git
cd cartwheel-mcp
npm ci
```

There is no compilation step. The source runs directly on Node.js.

## 3. Connect your assistant

For clients with a JSON `mcpServers` configuration, add the following. Replace the absolute path and provide your own key through the client's environment or secret settings:

```json
{
  "mcpServers": {
    "cartwheel": {
      "command": "node",
      "args": ["/absolute/path/to/cartwheel-mcp/src/index.mjs"],
      "env": {
        "CARTWHEEL_API_KEY": "YOUR_CARTWHEEL_PROJECT_API_KEY"
      }
    }
  }
}
```

Use an absolute path: clients may launch the process from a different working directory. Restart or reconnect the client after changing its configuration.

For **Codex**, add this to `~/.codex/config.toml` and make `CARTWHEEL_API_KEY` available in the environment that launches Codex:

```toml
[mcp_servers.cartwheel]
command = "node"
args = ["/absolute/path/to/cartwheel-mcp/src/index.mjs"]
env_vars = ["CARTWHEEL_API_KEY"]
```

See the [Codex MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) for app setup and environment settings.

For a local terminal session, you can instead copy `.env.example` to `.env`, enter your key there, and run `npm start`. The `.env` file is gitignored. A running stdio server waits quietly for MCP input; it does not display a web page.

## 4. Make your first motion

Try asking your assistant:

> List my Cartwheel characters. Use one to generate an eight-second joyful disco dance with Swing. Submit it once, check the batch until it finishes, and give me the BVH download link.

The workflow is:

```text
list_characters → generate_motion → get_batch → list_batch_motions → download BVH
```

Generation is asynchronous and consumes Cartwheel credits. Submitting another generation does not check the first one; it starts another job. Poll the returned batch instead.

Example `generate_motion` arguments:

```json
{
  "batchName": "My first MCP animation",
  "prompts": ["A person dancing a playful disco groove in place"],
  "requestedModel": "swing",
  "swingProperties": { "duration": 8 },
  "exportSettings": {
    "characterID": "REPLACE_WITH_AN_ID_FROM_LIST_CHARACTERS",
    "exportType": "bvh",
    "forward": "Z",
    "up": "Y",
    "frameRate": 24,
    "frameStepSize": 1
  }
}
```

For `list_batch_motions`, pass both `batchID` and `limit` (for example, `10`). Responses retain the API's pagination tokens and download URLs. Asset URLs can expire; retrieve the motion again for a fresh link.

## Tools

| Tool | What it does |
| --- | --- |
| `generate_motion` | Submit text prompts with model and export settings. **Consumes credits.** |
| `create_media_upload` | Prepare signed upload slots for video references. The client uploads the file bytes. |
| `get_media` | Retrieve source-video metadata and a fresh download URL. |
| `generate_motion_from_video` | Capture a video with Comic 4, one to four actors, and optional faces. **Consumes credits.** |
| `get_batch` | Check an asynchronous batch's status and progress. |
| `list_batch_motions` | Get a batch's motions, BVH links, and previews. |
| `get_motion` | Retrieve a motion and optional character/export parameters. |
| `list_motions` | Browse recent generations. |
| `search_motions` | Search the motion library by text, category, or tags. |
| `list_characters` | Find accessible character IDs and assets. |
| `get_character` | Inspect one character. |
| `list_scenes` | Browse scenes. |
| `get_scene` | Inspect one scene. |
| `create_scene` | Create an editable scene from accessible motion IDs. |
| `loop_motion` | Trim and loop an existing motion; creates a new motion. |
| `stitch_motions` | Trim/blend two motions in order; creates a new motion. |
| `edit_motion` | Submit a prompt, timed root path and/or compatible full-body constraints. **Consumes credits.** |
| `edit_key_poses` | Regenerate around compatible native pose snapshots. **Consumes credits.** |
| `list_motion_edits` | Inspect edit history for a scene timeline slot. |
| `get_motion_edit` | Check a submitted edit and retrieve its completed output. |
| `apply_motion_edit` | Apply a reviewed, completed edit to its verified scene slot. |
| `analyze_motion` | Measure contacts, root travel, strides, flight candidates and loop endpoints; inspect setup-frame handling. |

List pagination uses `nextToken`. Search requires `pageSize` and uses the response's `lastSort` array as `searchAfter`.

## Game animation and motion editing

Version **0.4.0** includes a [Three.js Motion Playground integration study](examples/game/README.md): one MHR character with body pose corrections, four generated animation-only clips, idle/walk/run transitions, an interruptible upper-body signal, contact-driven effects and a small crowd. It runs locally without an API key:

**MHR demo quality is unresolved.** Raw retargets show shoulder and hand-contact defects; the rejected shoulder workaround has been removed. The [quality audit](examples/game/AUDIT.md) separates those defects from the MCP and controller checks. These animation assets are not approved production defaults.

```sh
npm run example:game
```

Open the printed localhost URL. Walk/run cadence follows actual movement distance through reviewed steady cycles. Hip sway is retained, and the upper-body gesture replaces the corresponding locomotion tracks. Every clip includes its prompt, skeleton identity, source/prepared hashes, timing, contact assumptions and measured motion metadata. The [preparation helper](examples/game/README.md#prepare-a-replacement-clip) handles verified setup-frame removal, trimming, authored-event remapping and in-place conversion after measuring original travel.

Ask your assistant:

> Use Cartwheel's game-ready animation workflow. Create a scene with my walking motion, edit it along a timed path, inspect the result, and prepare a matching clip for the Three.js reference.

The **`game_ready_animation`** prompt and **`cartwheel://workflows/game`** resource provide the full process:

```text
create_scene → get_scene → edit_motion / edit_key_poses
  → get_motion_edit → review output → apply_motion_edit

loop_motion / stitch_motions → new motionID → analyze_motion
  → client prepares BVH + metadata → Three.js reference
```

Edits are asynchronous. Loop/stitch operations are synchronous and can take several minutes; allow four minutes in your MCP client. Submit each mutation once and inspect existing jobs/results after an uncertain response. Applying an edit replaces that slot's performance and requires a completed job belonging to it.

Contacts and flight events are explicitly labeled **kinematic estimates**, separate from authored gameplay events. Setup frames are preserved unless the caller explicitly identifies one and removal passes verification. Declare source units, axes, position-channel convention, root/foot joints and ground height; the workflow explains how these differ across exports. A clip already made in-place cannot recover its original travel speed. Loop endpoint metrics require visual review and do not certify contact quality or a seamless loop.

See the [full MCP game workflow](src/workflows/game.md), [runnable example](examples/game/README.md) and [asset provenance](examples/game/ASSETS.md). Reconnect the server after updating to discover all 22 tools and three workflows.

## Comic 4: video to editable 3D

[![One video, two performers — Comic 4 capture recast in Blender](docs/media/comic4-camera-reveal.jpg)](docs/media/comic4-camera-reveal.mp4)

[Watch the 10-second camera reveal](docs/media/comic4-camera-reveal.mp4) · [Clean Blender shot](docs/media/comic4-botanical-bureau.mp4) · [How the demo was made](docs/COMIC4.md)

The demo captures two performers together, preserves their timing and placement, and turns them into botanical androids in a conservatory. A moving Blender camera shows a viewpoint absent from the reference. The scene, costumes and camera work are authored; Comic 4 supplies the body, hand and facial performances.

Ask your assistant:

> Use the Comic 4 Blender workflow to capture both people and their faces from this video. Keep their relative placement, import the complete performance into Blender, and render a camera angle that wasn't in the original video.

The **`comic4_blender_scene`** prompt and **`cartwheel://workflows/comic4`** resource provide the full process:

```text
create_media_upload → client PUTs video bytes → generate_motion_from_video
  → get_batch → list_batch_motions → import every actor into Blender
```

Use an authorized video of at most 30 seconds and less than 250 MB. Select `comicModel: "comic4"`, set `numPeople` explicitly for a group, and enable `facialCapture` when needed. The [runnable upload helper and complete request example](examples/comic4/README.md) explain each step. The helper runs through your client's local execution tools; the MCP server has no filesystem access tool.

Capture returns editable performance data, not a finished scene. Preserve actor indices and shared world placement. Retrieve all body and face outputs from `list_batch_motions`, including the source-camera FBX when available. The API's legacy `faceURLs[i].bvhURL` field points to an **MHR FBX**, not a BVH; a custom character needs a compatible rig or facial retargeting. Use `get_motion` with `characterID` and `bodyIndex` to retarget a particular actor's body. See the [Comic 4 workflow](src/workflows/comic4.md) for import checks and camera-reveal guidance.

After updating, reconnect your MCP server to discover the new tools, prompt, and resource.

## Default Blender workflow in MCP

The server exposes the approved grounding and rendering process directly through MCP:

- **Prompt:** `grounded_blender_scene`, with an optional `scene` description.
- **Resource:** `cartwheel://workflows/blender`.
- **Bundled files:** Blender scripts, validation, and all four generated example motions under `examples/blender/`.

Choose the prompt in a client that supports MCP prompts, or ask your assistant:

> Use Cartwheel's grounded Blender workflow to make a playful robot scene. Start with a motion preview, check foot contact and pose continuity, then render the final movie.

The server instructions direct Blender requests to this workflow. The [complete guide](src/workflows/blender.md) covers generation, preserved root travel, Gaussian contact easing, stable knee IK, continuous foot yaw, validation, and final rendering. The example driver runs the contact and continuity checks before rendering movies. Your MCP client's authorized local tools run Blender and handle files.

After updating this repository, restart or reconnect the MCP server so your client discovers the new prompt and resource.

## Blender gallery

The examples use Cartwheel-generated BVH motion, procedural characters and sets, and Blender Cycles rendering. The scene source and original music are included.

| Example | Style | Motion |
| --- | --- | --- |
| [After Hours](docs/media/after-hours.mp4) | Glossy neon toy diorama | Two generated dances and an animated DJ |
| [Slow Morning](docs/media/slow-morning.mp4) | Pastel paper-and-clay garden | Flowing tai chi |
| [Moon Mail](docs/media/moon-mail.mp4) | Cinematic lunar miniature | Generated walking on a curved Blender trajectory |

[![Slow Morning — tai chi in a pastel garden](docs/media/slow-morning.jpg)](docs/media/slow-morning.mp4)

[![Moon Mail — a lunar courier](docs/media/moon-mail.jpg)](docs/media/moon-mail.mp4)

See [the Blender guide](examples/blender/README.md) for source files, rendering instructions, and motion provenance.

**Paths and poses:** `generate_motion` is text generation. Use the new `edit_motion` and `edit_key_poses` tools for Motion Editor conditioning. The older Moon Mail demo uses a Blender trajectory and contact solve; it was not generated with these editor tools.

## Security and scope

- Calls go to Cartwheel's **fixed public production API** using your own project key.
- The server exposes 22 explicit tools. It has no generic HTTP proxy, database access, shell tools, account administration, billing, or deletion tools.
- `analyze_motion` reads bounded BVH assets only from approved Cartwheel production storage. API keys are never sent to asset storage. The optional game server is a separate loopback-only process without an API proxy.
- It does not expose callback registration, subscriber management, or impersonation fields.
- Requests are validated, redirects are rejected, and failed requests are never automatically retried.
- Keys stay in the local environment. They are not bundled in the package or examples.
- Tool results are visible to your MCP client and its model provider. Treat returned metadata as data, not instructions.

Read [SECURITY.md](SECURITY.md) for the trust boundary and reporting details.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `CARTWHEEL_API_KEY is required` | Supply the key in the environment of the process your MCP client launches. |
| HTTP 403 | Check the secret key, production environment, workspace permissions, and API-enabled plan. |
| Invalid arguments | Read the tool's schema. Text generation requires `prompts` and `requestedModel`; video capture requires `mediaIDs` and `comicModel: "comic4"`. Both require complete `exportSettings`. |
| Video capture cannot read the reference | Creating a media slot does not upload the video. Complete the signed PUT before submitting capture. |
| HTTP 429 | Respect `retryAfter` and your plan's batch/concurrency limits. |
| Generation times out | It may have been accepted. Check recent motions before submitting again. |
| Server starts but prints nothing | Expected for stdio. Connect an MCP client to communicate with it. |
| Hosted-only client asks for a URL | This version is local stdio. A GitHub repository URL is not an MCP endpoint. |

## Development

```sh
npm ci
npm test
npm pack --dry-run
```

Tests use the official MCP client, in-memory transports, and a real stdio subprocess. They validate tool and workflow discovery, prompt/resource retrieval, request schemas, authentication, pagination, generation submission, error redaction, route boundaries, and package contents without using real credentials or spending credits.

`src/tools.json` and `src/game-tools.mjs` contain the selected public request contracts. Keep changes aligned with the [public Cartwheel API documentation](https://api-docs.getcartwheel.com). The server is self-contained and does not require any other Cartwheel repository. Three.js supplies BVH loading, transforms and animation utilities; there is no local model runtime.

## Distribution

This GitHub repository is the source distribution and installation entry point. It is not itself a hosted MCP service. The npm manifest is ready for packaging, but this README does not claim an npm release or MCP Registry listing.

The [MCP Registry](https://modelcontextprotocol.io/registry/about) is a separate discovery service that points to installable packages or remote servers. Registry listing and package publication are separate from publishing source on GitHub.

## License

[MIT](LICENSE). Cartwheel service access and generated assets remain subject to your Cartwheel account terms.
