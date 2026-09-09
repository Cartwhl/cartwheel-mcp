# Cartwheel Hermes → playable game animation

Use **Hermes** for the text-to-motion and editing steps in this workflow. The installed `examples/game` directory includes a working Three.js reference, BVH preparation, pose sampling, one MHR character, four Hermes body performances and their metadata. Static hand poses are explicit. Read its README for commands and the coordinate contract, and `examples/game/AUDIT.md` for review evidence and limitations. The separate `hermes_motion` prompt / `cartwheel://workflows/hermes` resource documents every Motion Editor primitive.

## Inspect the reference and its current limits

Run `node serve.mjs` from the installed example directory (or `npm run example:game` from the repository). Open the printed localhost URL. No API key belongs in the browser. Use Idle/Walk/Run, Signal, Interrupt, WASD + Shift, the crowd slider, and Source & metrics. Keep this working while replacing one clip at a time.

The example demonstrates distance-driven locomotion, reviewed steady gait cycles, a normalized right-arm replacement gesture, interruption, contact-driven footfall effects, an explicitly authored signal event, and independent mixers sharing assets/materials, with MHR full-body pose corrections evaluated after blending. It is a small reference scene, not a claim that arbitrary crowds or characters meet a frame-rate target.

## Generate and keep the Hermes performance

1. `list_characters`, then `get_character` for the intended character. Use the same native character for the base GLB and all animation-only clips. Inspect hierarchy and transforms; matching names alone do not prove compatibility.
2. Find an accessible seed with `list_motions` / `search_motions`, then `create_scene`, or inspect an existing isolated scene with `get_scene`. Use its actual reference name and timeline index. `set_scene_character` selects the intended character, preserving the slot's timeline. Check the resulting scene before generation.
3. Call `edit_motion` with a concise prompt, explicit duration and optional seed. Omit `constraints` and `keyPoses` for fresh **Hermes text-only generation**. The source clip provides the skeleton/export template rather than conditioning the body performance. Unmapped channels can survive from that template: choose deliberate hand poses when newly generated finger animation is required but unavailable.
4. Submit once; poll `get_motion_edit`. Recover uncertain submissions through `list_motion_edits`. Review the completed output on the intended character, then `apply_motion_edit` to the same slot.
5. `export_scene` exports the applied scene; poll `get_scene_exports`. Preserve travel with `moveInPlace: false`, Y up, Z forward, and consistent cadence. Export a self-contained GLB for visual review and an animation-only BVH for preparation. Scene exports use the object's selected character. Calling `get_motion` on the seed ID still retrieves the seed performance, not its edited scene replacement.

Hermes is not a valid `generate_motion.requestedModel` value. Swing batches and Comic 4 captures remain separate options; do not silently substitute them when the user asks for Hermes. For all current controls and complete request examples, read `cartwheel://workflows/hermes`.

Separate creative direction from gameplay requirements. Author interruption windows, damage, recovery and VFX timing after reviewing the actual clip. Cartwheel does not promise an impact on a particular beat or frame.

## Edit, loop and stitch through MCP

- `edit_motion` supports Hermes text-only generation, `root2d` paths/facing, `fullbody` stamps, hand/foot controls, selected end effectors, and built-in curved repathing with handles, holds and optional pose stamps. Constraints refer to the exact scene BVH cadence.
- `edit_key_poses` regenerates around compatible native snapshots and derives duration from the source. Use `sample-poses.mjs` on the exact untrimmed Y-up scene BVH. Its `localJointRot` includes End Sites in Three BVHLoader order; rotations are axis-angle radians and positions retain native source units. MHR has a dedicated native pose conversion path. Inline end-effector controls require correctly converted Hermes SOMA-30 or SOMA-77 poses; MHR/Axel snapshots cannot be passed directly.
- For ordinary edits, combine `root2d` and `fullbody` inside `constraints`; do not also supply native `keyPoses`, which take precedence upstream. One built-in `twoPassRepath` envelope can accompany native key poses, or contain inline pose/effector stamps. The Hermes guide documents that exception and all curve fields.
- `save_key_poses` persists editor state without generation; an empty list clears it. Inspect `get_scene` to read it back.
- Poll edits and review output before applying. Applying replaces that slot's performance. The MCP verifies job membership and completion; a completed historical job can restore a prior edit. Missing old history does not permit applying a job to another slot.
- `loop_motion` trims/loops an existing completed motion ID; `stitch_motions` blends two motion IDs in order. They return new motion IDs and do not automatically consume edited scene output. `trimMode` selects seconds (`duration`) or source `frames`.
- Loop/stitch are synchronous operations: allow up to four minutes in the MCP client. They are not automatically retried. After an uncertain response, inspect `list_motions` before resubmitting.

Example waypoint edit **for a reviewed 96-frame, Y-up, meters-scale source at 24 fps**:

```json
{
  "sceneID": "REPLACE_SCENE_ID",
  "referenceName": "REPLACE_REFERENCE_NAME",
  "timelineIndex": 0,
  "duration": 4,
  "prompt": "A person doing a relaxed walk along the path.",
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

The reference asserts skeleton identity and native offsets, retains a single character asset, and checks each BVH against its metadata hash. Root travel and heading are measured in world space using the animated parent hierarchy, then baked back into parent-local coordinates. Never infer world forward from a pelvis-local displacement or a bind-pose parent matrix. Verify anatomical facing against actual gameplay displacement for every locomotion clip. Locomotion follows actual traveled distance after movement limits, never intended speed alone. Walk/run use one reviewed steady cycle each, with a selected shared foot phase and constant source-time rate. Supply `reviewedCycle` to the local preparation helper to record its start/end boundary samples, phase marker and short seam-blend window. The helper measures net cycle travel and ties this choice to the source hash. Keep traveling samples: playback subtracts net travel while retaining hip sway. Do not drive phase directly from every inferred contact; split/missed contacts can introduce severe speed changes. Stride averages exclude non-alternating candidates, which remain visible with warnings.

First play a self-contained animated scene export from `export_scene` / `get_scene_exports`, using its own rig and animation. For an unedited motion-library asset, use `get_motion` with the appropriate character and download format instead. Compare it with the same performance on the source character before adding BVH preparation, cycles, layers, smoothing or pose corrections. Preserve original files and hashes privately. If the untouched export is already malformed, investigate the retargeted pose and character compatibility; do not declare a browser-side offset a general repair.

Inspect actual skin deformation in the native bind pose, arms down and arms raised from front and side. Check wrists, finger bends, hand/body intersections and intended contacts. Matching BVH offsets or inverse binds does not establish a suitable animated pose. Different characters' internal collarbone directions are not interchangeable targets. Retargeted rotations can lose hand contact when proportions differ. Review the complete performance at source cadence before selecting it for gameplay.

The example signal replaces the right clavicle and arm tracks with complementary weights, omitting the source torso and opposite-arm follow-through. Review whether that loss suits the action; it is not added on top of a complete walking arm swing. Gesture interruption stops future authored events and fades the layer out. Crowd motion follows continuous steering rather than chasing moving point targets. The bundled MHR character preserves its static identity and applies native full-body pose corrections to the final blended pose.

Check: start/stop, walk/run changes, diagonal input, boundary blocking, gesture while moving, interruption before/after its event, loop wraps, paused tabs, and several independent crowd phases. Test both keyboard and touch controls. Measure actual device performance; shared assets do not eliminate per-character skinning and draw calls. No navigation, terrain IK, exact collision-aware generation, musical timing guarantee, or large-crowd benchmark is implied.
