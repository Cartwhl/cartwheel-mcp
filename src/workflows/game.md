# Cartwheel → playable game animation

Use this workflow for editing a performance and preparing clips for a game. The installed `examples/game` directory includes a complete local Three.js reference, a BVH preparation helper, pose sampling, one character, four generated clips, and their metadata. Read its README for commands and the coordinate contract.

## Start with the working reference

Run `node serve.mjs` from the installed example directory (or `npm run example:game` from the repository). Open the printed localhost URL. No API key belongs in the browser. Use Idle/Walk/Run, Signal, Interrupt, WASD + Shift, the crowd slider, and Source & metrics. Keep this working while replacing one clip at a time.

The example demonstrates distance-driven locomotion, reviewed steady gait cycles, a normalized right-arm replacement gesture, interruption, contact-driven footfall effects, an explicitly authored signal event, and independent mixers sharing assets/materials, with MHR full-body pose corrections evaluated after blending. It is a small reference scene, not a claim that arbitrary crowds or characters meet a frame-rate target.

## Generate and keep the source performance

1. `list_characters`, then `get_character` for one accessible character. Use that same character for the base GLB and all animation-only clips. Inspect its hierarchy and transforms; matching names alone do not prove compatibility.
2. `generate_motion` with concise creative prompts, `requestedModel: "swing"`, explicit duration, and complete export settings. Use `moveInPlace: false`, Y up, Z forward, and a consistent frame rate so original travel remains measurable. `includeMesh: false` requests animation-only output. Use `loop: true` for cyclic locomotion; inspect the result rather than assuming it loops well.
3. Submit once, then poll `get_batch` and `list_batch_motions`. Generation and editing consume credits. After an uncertain response, recover the existing job rather than regenerating.
4. Use `get_motion` with `characterID`, `downloadType: "bvh"`, and the selected `fps` for the native character skeleton. A batch export and a native retarget can differ in units, bone names, position convention, and setup frames. Never treat them as interchangeable. Comic 4 actors also require the correct `bodyIndex`.

Separate creative direction from gameplay requirements. Author interruption windows, damage, recovery and VFX timing after reviewing the actual clip. Cartwheel does not promise an impact on a particular beat or frame.

## Edit, loop and stitch through MCP

- `loop_motion` trims/loops an existing completed motion and returns a new `motionID`. Preserve root travel while measuring locomotion speed. `trimMode` selects seconds (`duration`) or source `frames`.
- `stitch_motions` blends two motion IDs in order, with optional trims. Review the transition, root motion, feet and pose continuity in the output.
- Loop/stitch are synchronous operations: allow up to four minutes in the MCP client, and cancel explicitly if needed. Neither operation is automatically retried. On an uncertain response, inspect `list_motions` before resubmitting.
- `create_scene` creates an editable scene from accessible motion IDs. `get_scene` returns its object reference names and timeline. Read these instead of inventing a reference name or timeline index.
- `edit_motion` accepts a creative prompt, timed `root2d` waypoints and/or `fullbody` constraints. These target the exact scene source BVH, not the separately exported game rig. Inspect source frame count, frame rate, coordinate system and joint order first.
- `edit_key_poses` regenerates around compatible native pose snapshots and derives duration from the source. Use `sample-poses.mjs` on the exact, untrimmed Y-up scene BVH to construct snapshots. Its `localJointRot` includes End Sites in Three BVHLoader order; rotations are axis-angle radians, and positions retain the native source units. Do not copy Euler rotations into this field.
- `keyPoses` overrides inline constraints upstream, so the MCP rejects requests containing both. To combine path and poses, put `root2d` and `fullbody` entries together in `constraints`; inline positions use meters. MHR pose conversion has a separate source rig contract: use valid native MHR snapshots with `edit_key_poses`, not an arbitrary game skeleton.
- Each edit returns a `jobID`. Poll `get_motion_edit` until `COMPLETED` or a terminal failure. `list_motion_edits` recovers history for that slot. Inspect the returned output BVH before `apply_motion_edit`; applying replaces that scene slot’s performance. The server checks job membership and completion. History lookup is limited to the service’s accessible recent jobs; a missing old job is not permission to apply it to another slot.

Example waypoint edit **for a reviewed 96-frame, Y-up, meters-scale source at 24 fps**:

```json
{
  "sceneID": "REPLACE_SCENE_ID",
  "referenceName": "REPLACE_REFERENCE_NAME",
  "timelineIndex": 0,
  "duration": 4,
  "prompt": "A person walks forward, following the path",
  "constraints": [{
    "type": "root2d",
    "frame_indices": [0, 48, 95],
    "smooth_root_2d": [[0, 0], [0.75, 1.5], [1.5, 3]]
  }]
}
```

Optional `global_root_heading` has one unit `[cos(yaw), sin(yaw)]` pair per waypoint. Sparse waypoints constrain those instants; add reviewed intermediate samples for a curve. Do not claim exact continuous scene collision avoidance or exact contact compliance. Compare the resulting trajectory with the constraints.

## Inspect and prepare clips

`analyze_motion` downloads only the BVH returned for an authorized motion on approved Cartwheel production storage. It returns metadata and does not edit the asset. Declare:

- `units`: `meters` or `centimeters`; `upAxis`: `Y` or `Z`.
- Optional `fps` with `characterID`: match the local retarget cadence before specifying frame trims. Retargeting otherwise defaults to 60 fps. The local helper reads cadence directly from the file.
- `positionConvention`: `offset_relative` for standard BVH channels added to OFFSET, or `absolute_local` for exports whose channels replace OFFSET. Cartwheel native retargets used by this reference use `absolute_local`; verify your actual export contract.
- Exact `leftFootJoint`/`rightFootJoint`, and `groundHeight` in meters. Thresholds `contactHeight`/`contactSpeed` are meters and meters/second. Foot joint choice matters: an ankle can move while the toe remains planted.
- Optional `rootJoint`: select the moving hips/pelvis when an armature wrapper is above it. Defaults to the hierarchy root.
- `setupFrame`: default `keep`. Choose `remove_verified_rest` only after identifying an extra setup frame. The tool verifies the first frame’s non-root rotation channels are at rest before removal; it never silently detects and drops a T-pose. A legitimate first pose may also be at rest. Nonzero rest rotations require explicit reviewed trimming instead.
- Optional `startFrame`/`endFrame`: zero-based, start inclusive/end exclusive **after setup removal**. Keep at least two frames. Metadata reports the final source-frame offset.

Analyze traveling motion before making it in-place. Reported reference speed, root displacement and stride distance come from original travel. A clip that was already made in-place cannot recover those measurements. For a completed scene edit, download its output and use the local helper; an old motion ID still identifies its original asset.

For local preparation, run `prepare-game.mjs --input SOURCE.bvh --options preparation.json --out OUTPUT_STEM`. It saves standard offset-relative BVH and a `.motion.json` sidecar, applies verified setup removal/trimming, optionally removes horizontal root travel while preserving height, and remaps authored events from original source frames. The server does not gain filesystem access; local commands run through the client’s authorized tools. `--inspect` lists source joints and cadence before choosing mappings.

## Review the data and the game

Contacts use joint world height/speed with hysteresis and a minimum duration. They are **kinematic estimates with uncalibrated confidence**, not authored impacts or certified ground truth. Flight intervals are candidates, not a guaranteed takeoff/landing detector. Review them over the rendered feet and set explicit thresholds for the chosen joints. The sidecar preserves assumptions and provenance. Authored events are marked `authored`, kept separate, and remapped with trims.

Loop diagnostics measure first/last joint angles, root translation wrap, and velocity mismatch. A traveling root can intentionally have a large wrap. Small endpoint errors do not certify a smooth loop; inspect the wrap in motion. `frameSequenceDurationSeconds` is frame count/fps for frame-sequence exports; `sampleSpanSeconds` is `(frameCount - 1)/fps`, the actual key span. Do not invent a loop period or extend a clip with a held frame from either number.

The reference asserts skeleton identity and native offsets, applies the character parent’s root coordinate transform, retains a single character asset, and checks each BVH against its metadata hash. Locomotion follows actual traveled distance after movement limits, never intended speed alone. Walk/run use one reviewed steady cycle each, with a selected shared foot phase and constant source-time rate. Supply `reviewedCycle` to the local preparation helper to record its start/end boundary samples, phase marker and short seam-blend window. The helper measures net cycle travel and ties this choice to the source hash. Keep traveling samples: playback subtracts net travel while retaining hip sway. Do not drive phase directly from every inferred contact; split/missed contacts can introduce severe speed changes. Stride averages exclude non-alternating candidates, which remain visible with warnings.

Also inspect actual skin deformation in the native bind pose, arms down, and arms raised from front and side. BVH offsets do not encode rest rotations. A mismatched anatomical retarget reference can collapse shoulders even when names, offsets and inverse binds agree. The bundled Swing/MHR example explicitly corrects its reviewed shoulder reference frames before blending; `rest-pose.mjs` compensates the upper-arm children to preserve their world rotations. Read its calibration and audit before replacing clips. Do not apply those MHR constants to another rig or native Comic capture. Keep upstream motion quality, reference-frame alignment and mesh pose corrections separate when diagnosing defects.

The signal replaces the right clavicle and arm tracks with complementary weights; it is not added on top of a complete walking arm swing. Gesture interruption stops future authored events and fades the layer out. Crowd motion follows continuous steering rather than chasing moving point targets. The bundled MHR character preserves its static identity and applies native full-body pose corrections to the final blended pose.

Check: start/stop, walk/run changes, diagonal input, boundary blocking, gesture while moving, interruption before/after its event, loop wraps, paused tabs, and several independent crowd phases. Test both keyboard and touch controls. Measure actual device performance; shared assets do not eliminate per-character skinning and draw calls. No navigation, terrain IK, exact collision-aware generation, musical timing guarantee, or large-crowd benchmark is implied.
