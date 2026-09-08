# Motion Playground

A complete Three.js integration with **one reusable Cartwheel character and four real Swing performances**: idle, walk, run, and a right-hand signal. The clips, prepared metadata, model and source are bundled. No API key is needed to play it.

From the repository root:

```sh
npm ci
npm run example:game
```

Open **http://127.0.0.1:4173**. If the port is occupied, use `npm run example:game -- --port 4174`. The server binds only to loopback and serves this example and installed Three.js assets. It has no Cartwheel credentials or API proxy. It is a separate process from the MCP stdio server.

Use the Idle/Walk/Run buttons for a movement preview, or **WASD/arrows** to control the character, **Shift** to run, **E** to signal, and **Escape** to interrupt the gesture. Touch direction buttons are available on narrow screens. Drag to orbit and scroll to zoom. The crowd slider adds up to eight independent characters. Source & metrics shows the exact prompts and measured clip properties.

## What the example demonstrates

| Behavior | Implementation |
| --- | --- |
| One character, multiple clips | A single native Mani GLB; animation-only BVHs. Skeleton IDs, rest offsets and hashes must match. |
| Idle/walk/run | Smoothed movement, idle blending and a shared left-contact phase between walk/run. |
| Movement speed | Cadence follows **actual distance traveled** after boundary clamping, using measured stride distance. Source reference speeds determine walk/run input targets. |
| Moving upper-body action | Three.js additive quaternion tracks above `spine3`, relative to the gesture’s first pose. The locomotion root and legs remain independent. |
| Interruption | Immediate cancellation of future gesture events, with a short fade of the current upper-body pose. |
| Event-driven VFX | Footfall rings follow inferred contact intervals. The hand signal ring uses an explicitly authored event, not an invented model timing guarantee. |
| Small crowd | `SkeletonUtils.clone` shares geometry/materials; each character owns its skeleton, mixer, movement state and phase. |

This is an integration reference on a flat surface. It does not implement navigation, terrain IK, collision-aware generation, cloth/hair simulation, or a large-crowd performance target. Device and asset cost matter; the UI reports actual render frame rate and draw calls. Speed matching and phase blending reduce integration errors but do not repair source motion foot sliding or guarantee planted feet during every transition.

## Included MCP workflow

Ask your assistant:

> Use Cartwheel’s game-ready animation workflow. Inspect the installed Three.js reference, make a matching walking clip, measure travel and contacts, and replace that clip only after checking its skeleton, setup frame and loop seam.

- Prompt: **`game_ready_animation`** (optional `scene` argument).
- Resource: **`cartwheel://workflows/game`**.
- Tools: `create_scene`, `edit_motion`, `edit_key_poses`, `list_motion_edits`, `get_motion_edit`, `apply_motion_edit`, `loop_motion`, `stitch_motions`, `analyze_motion`.

The [full workflow](../../src/workflows/game.md) includes complete scene/job lifecycle guidance, path/pose units, trim semantics and verification. Reconnect the MCP server after updating to discover these additions.

## Prepare a replacement clip

Generate or retarget to the **same native character skeleton** using the MCP. Keep original root travel (`moveInPlace: false`) until after measuring speed and stride length. Use a fresh BVH URL from `get_motion`; download it using your MCP client’s authorized local tools. Keep signed URLs and raw API records private.

Inspect the file first:

```sh
node examples/game/prepare-game.mjs --input /path/to/walk-source.bvh --inspect
```

Copy `preparation.example.json` to your own options file. Confirm units, axes, root and foot joints, and whether position channels **replace** offsets (`absolute_local`) or **add** to them (`offset_relative`). The supplied options match the native Mani retargets used here. A batch BVH export may use different names, units and wrappers.

```sh
node examples/game/prepare-game.mjs \
  --input /path/to/walk-source.bvh \
  --options /path/to/preparation.json \
  --out /path/to/prepared/walk
```

This writes `walk.bvh` and `walk.motion.json`. It measures source travel, normalizes position channels to standard offset-relative BVH, optionally trims/removes an identified setup frame, and makes the motion in-place while retaining vertical movement. The example uses meters/Y-up prepared BVH, so choose a compatible export; the general analyzer also supports centimeters and Z-up and reports metric metadata without silently changing source axes or units.

Replace **both** files under `assets/` only after review. The browser checks the prepared BVH hash against its sidecar. A matching skeleton ID identifies names, parent relationships and rest offsets normalized to meters/Y-up; it does not certify skin weights, mesh quality or root coordinate conventions. The reference also checks the loaded character’s rest offsets and converts the BVH root into its GLB parent’s coordinate basis.

### Setup frames and trimming

`setupFrame: "keep"` preserves the first frame. `"remove_verified_rest"` removes one frame only when the caller has identified an extra setup frame **and** its non-root rotation channels are within 0.001° of rest. A genuine first animation pose can also be at rest, so detection alone never removes it. If a known setup pose uses nonzero rest rotations, inspect and explicitly trim it; the verifier refuses to guess.

`startFrame` is inclusive and `endFrame` is exclusive, both zero-based **after setup removal**. Keep at least two samples. An authored event’s `frame` is always an index in the **original input BVH**. Events outside the retained range are discarded and counted; retained events are shifted by the recorded source offset exactly once.

```json
{
  "units": "meters", "upAxis": "Y", "positionConvention": "absolute_local",
  "rootJoint": "pelvis", "leftFootJoint": "left_ankle", "rightFootJoint": "right_ankle",
  "groundHeight": 0, "setupFrame": "remove_verified_rest",
  "startFrame": 3, "endFrame": 90, "rootMotion": "in_place",
  "authoredEvents": [{"name": "impact", "frame": 18}]
}
```

In that example, source frame 18 becomes output frame 14. The impact is an authored gameplay choice. **The four bundled native clips contain no extra setup frame**, so their preparation keeps frame 0.

### Metadata interpretation

- Root displacement, horizontal path length and reference speed are measured **before** in-place removal. Already-in-place clips cannot recover original travel speed. Strides use complete same-foot contact cycles when available; missing measurements are `null`.
- Contacts use joint height and 3D velocity, 1.35× release hysteresis, and a 60 ms minimum interval. Confidence is explicitly **uncalibrated**. Inspect against the feet. This example uses 0.10 m height, 0.25 m/s speed for idle/walk/signal, and 0.70 m/s for running ankle motion.
- Flight intervals are candidates where both selected joints are above the height threshold. These are not authored takeoff, landing, damage or recovery events.
- Loop metrics report sample endpoint joint angles, root wrap and velocity mismatch. A moving root can intentionally have large displacement; a small endpoint angle does not prove the whole loop is smooth.
- `frameCount / fps` is the playback period; `(frameCount - 1) / fps` is the measured sample span. Use the supplied fields rather than silently treating them as equal.

## Edit compatible key poses

Create a scene, inspect `get_scene`, and download the exact timeline slot’s `bvhURL`. Do **not** use a trimmed, resampled or separately retargeted game export for editor pose indices. The helper supports native Y-up BVHs with one translating root:

```sh
node examples/game/sample-poses.mjs \
  --input /path/to/scene-source.bvh --frames 24,60 \
  --positions offset_relative --out /path/to/poses.json
```

The output records the source hash, cadence, and Three BVHLoader bone order, including End Sites. Supply its `keyPoses` array to `edit_key_poses` with the scene ID, object reference and timeline index. Positions retain the scene BVH’s native units; rotations are axis-angle radians. Sampled snapshots preserve existing poses; author different compatible snapshots to request a changed pose. The helper does not rename or retarget bones.

Use `edit_motion.constraints` for timed root waypoints or inline full-body constraints. Inline positions are meters. Do not combine `keyPoses` and `constraints` in one request: the upstream worker gives key poses precedence, so the MCP rejects that ambiguous combination. Combine `root2d` and `fullbody` entries inside `constraints` when both are needed. Poll the job, inspect its output, then apply it explicitly.

## Files and validation

- `controller.mjs`: movement, contact phase, and interruptible event clocks.
- `app.mjs`: native-rig loading, Three.js animation layers, controls and rendering.
- `prepare-game.mjs`: bounded BVH preparation and metadata sidecars.
- `sample-poses.mjs`: source-compatible editor snapshots.
- `serve.mjs`: loopback-only preview server.
- [ASSETS.md](ASSETS.md): character and motion provenance.

`npm test` checks MCP requests and trust boundaries, frame/unit/root handling, event remapping, pose sampling, blocked movement and interruption. Review the rendered result too: start/stop, walk/run changes, motion across loop seams, gesture while walking, cancellation, diagonal input, boundaries, crowd phases, and mobile controls. Refresh the browser after changing example files; this small server has no hot reload.

Built on the maintained [Three.js animation system](https://threejs.org/manual/en/animation-system.html), [BVHLoader](https://threejs.org/docs/pages/BVHLoader.html), [AnimationUtils](https://threejs.org/docs/pages/AnimationUtils.html) and [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html).
