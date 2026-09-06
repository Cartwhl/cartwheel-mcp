# Cartwheel MCP

**Describe a motion. Get an animation. Bring it into Blender.**

Cartwheel MCP connects your AI assistant to [Cartwheel](https://getcartwheel.com)'s public API. Generate 3D motion from text, search the motion library, retrieve animation files, and inspect your characters and scenes.

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
| `get_batch` | Check an asynchronous batch's status and progress. |
| `list_batch_motions` | Get a batch's motions, BVH links, and previews. |
| `get_motion` | Retrieve a motion and optional character/export parameters. |
| `list_motions` | Browse recent generations. |
| `search_motions` | Search the motion library by text, category, or tags. |
| `list_characters` | Find accessible character IDs and assets. |
| `get_character` | Inspect one character. |
| `list_scenes` | Browse scenes. |
| `get_scene` | Inspect one scene. |

List pagination uses `nextToken`. Search requires `pageSize` and uses the response's `lastSort` array as `searchAfter`.

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

**Paths and poses:** `generate_motion` exposes the documented text-generation API. It does not promise path or pose conditioning. In Moon Mail, Blender advances the generated walking performance along a curve at the source stride speed, turns the character along its tangent, and solves planted-foot contact on the flat floor. That changes scene placement; it is not a constraint sent to the motion model.

## Security and scope

- Calls go to Cartwheel's **fixed public production API** using your own project key.
- The server exposes ten explicit tools. It has no generic HTTP proxy, database access, shell tools, account administration, billing, or deletion tools.
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
| Invalid arguments | Read the tool's schema. Generation requires `prompts`, `requestedModel`, and complete `exportSettings`. |
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

`src/tools.json` contains only the selected public request contracts. Keep changes aligned with the [public Cartwheel API documentation](https://api-docs.getcartwheel.com). The server is self-contained and does not require any other Cartwheel repository.

## Distribution

This GitHub repository is the source distribution and installation entry point. It is not itself a hosted MCP service. The npm manifest is ready for packaging, but this README does not claim an npm release or MCP Registry listing.

The [MCP Registry](https://modelcontextprotocol.io/registry/about) is a separate discovery service that points to installable packages or remote servers. Registry listing and package publication are separate from publishing source on GitHub.

## License

[MIT](LICENSE). Cartwheel service access and generated assets remain subject to your Cartwheel account terms.
