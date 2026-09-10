# swing-edit: text generation and motion editing

swing-edit creates a fresh performance from text or regenerates motion around paths, poses and selected body controls. It is a separate generation option from Swing. Use the **swing-edit** name in user-facing explanations. `edit_motion` is its MCP entry point; do not pass `swing-edit` to `generate_motion.requestedModel`, whose API is different.

## Start with text

1. Use `list_scenes` and `get_scene` to find an accessible object and timeline slot. Or use `search_motions` / `list_motions` to find an accessible seed motion and `create_scene` to make an isolated scene. An existing clip supplies the skeleton and timeline; there is no standalone blank-scene text endpoint in this MCP.
2. Use `list_characters` / `get_character` to choose the intended character. `set_scene_character` changes an existing scene reference to its `objectID` and retargets the timeline. Inspect `get_scene` afterward. The normal mesh-character flow returns an updated scene; if the service returns a pending retarget job, wait for that character change to complete in Cartwheel before editing/exporting. This workflow does not implement robot-job polling.
3. Call `edit_motion` once with `prompt`, `duration` (1–10 seconds), and an optional `seed`. **Omit constraints and keyPoses for fresh text-only generation.** The source performance does not condition the body generator in this mode. Export hierarchy, coordinate placement and unmapped channels can still depend on the source. Finger animation is not guaranteed to be newly generated; use a deliberate hand-pose preset at export when appropriate.
4. Poll `get_motion_edit` with the returned `jobID`. `list_motion_edits` recovers a submitted job after an uncertain response. Generation consumes credits; checking status must not submit another generation.
5. Download and inspect the completed `outputBvhURL` using the client's authorized file tools. Do not claim it is already retargeted to a different character: it uses the scene source's output skeleton. Review the actual character, hands, feet and continuity.
6. Use `apply_motion_edit` only after review. It replaces that exact scene slot's performance. A historical completed job can also be applied to revert the slot. The MCP verifies the job belongs to the requested slot.
7. `export_scene` exports the currently applied scene on its scene characters; `get_scene_exports` reads status and download links. Supply exact `objectReferenceNamesToExport` when exporting a subset. An original motion ID still identifies its original asset: calling `get_motion` on it does not retrieve an unapplied or edited scene result.

Example text-only request, after inspecting the scene:

```json
{
  "sceneID": "REPLACE_SCENE_ID",
  "referenceName": "REPLACE_REFERENCE_NAME",
  "timelineIndex": 0,
  "prompt": "A person doing a steady forward walk with relaxed arms and even steps.",
  "duration": 6,
  "seed": 42
}
```

For MHR game animation, start with swing-edit and inspect the unmodified export. The bundled Motion Playground uses swing-edit body performances and deliberate static hand poses. Its MHR pose correctives are part of the mesh deformation model, not a shoulder rotation workaround. Do not enable the rejected shoulder-direction patch.

## Available primitives

| Control | MCP input | Contract |
| --- | --- | --- |
| Text-only motion | `edit_motion.prompt`, optional `duration`, `seed` | Omit both constraint forms. Produces a fresh body performance. |
| Root waypoints or dense path | `constraints[].type: "root2d"` | Increasing `frame_indices`, `smooth_root_2d` X/Z pairs in world meters. One position per frame. |
| Root facing | `root2d.global_root_heading` | Optional unit `[cos(yaw), sin(yaw)]` pairs, one per waypoint. |
| Full-body stamps | `constraints[].type: "fullbody"` | Timed local axis-angle rotations in radians plus world root positions in meters; optional `smooth_root_2d`. |
| Native editor poses | `edit_key_poses.keyPoses` | Exact scene BVH bone order, including End Sites; native source position units; original frame cadence. Source duration controls this operation. |
| One hand or foot | `left-hand`, `right-hand`, `left-foot`, `right-foot` constraint types | Pose-derived end-effector position/orientation controls. Require swing-edit SOMA-30 or SOMA-77 pose order. |
| Selected effectors | `type: "end-effector"`, `joint_names` | Select `LeftHand`, `RightHand`, `LeftFoot`, `RightFoot`, and/or `Hips`; same swing-edit pose contract. |
| Curved repathing | One `type: "twoPassRepath"` envelope | Backend-planned strong recovery along a curve, with heading, handles, holds and optional pose/effector stamps. |
| Pose persistence | `save_key_poses` | Saves the full pose list without generation; `[]` clears saved poses. Read back with `get_scene`. |
| History and preview | `list_motion_edits`, `get_motion_edit` | Reads job state and output. Does not replace scene animation. |
| Apply or revert | `apply_motion_edit` | Applies a reviewed completed job belonging to that slot. |
| Character and exports | `set_scene_character`, `export_scene`, `get_scene_exports` | Retarget the scene character, then export its applied performance. |

`sampler` accepts `ddim` or `dpm_solver_v3` at the API boundary. The deployed worker can select its configured sampler; do not promise that this field alone controls the runtime or makes results identical across deployments. A seed records a generation choice, not cross-version determinism.

## Coordinate and pose rules

Every constraint frame refers to the **original scene BVH cadence**, not a separately exported, resampled or trimmed game clip. Inspect frame count and frame time first. Inline coordinates are Y-up meters; keyPoses retain native scene units. Axis-angle triples are radians, not Euler degrees. `smooth_root_2d` contains X/Z coordinates; heading pairs are not positions.

The bundled `sample-poses.mjs` samples compatible native editor poses, including End Sites. Those snapshots can be used as the starting point for edited poses. They do not automatically invent IK solutions.

```sh
node sample-poses.mjs --input scene-source.bvh --frames 24,60 \
  --positions offset_relative --out poses.json
```

For MHR pose editing, prefer `edit_key_poses`: the service has a dedicated MHR pose conversion path. Inline `fullbody` can remap compatible source BVH orders. **Hand/foot/end-effector constraints do not perform that remap:** their `local_joints_rot` must already be in the deployed swing-edit SOMA-30 or SOMA-77 order. A 30-element array alone does not establish compatibility. Use `swing-edit-skeleton.json` in the installed game example for the SOMA-30 names; supply correctly converted poses. Do not feed MHR's 127-joint snapshots or Axel snapshots directly into an end-effector constraint.

End-effector controls use a complete compatible pose to derive the selected target position and orientation; they also carry root position/heading. They are not arbitrary XYZ-only pins or guaranteed collision-free contacts. To request a hand reaching somewhere else, first solve/author a compatible pose with that hand at the target, then constrain it. The same shape as `fullbody` is used, plus `joint_names` for the generic type.

To combine a simple path and poses, place `root2d` and `fullbody` entries together in `constraints`. Do not also supply `keyPoses`, which takes precedence in ordinary edits. The supported exception is the sole built-in repath envelope with native keyPoses, described below.

## Curves, holds and repathing with poses

Use one envelope with `strategy: "builtIn"` and `recoveryMode: "strong"`. This asks swing-edit to preserve source motion detail while following the new curve. It is a constrained editing operation, unlike text-only generation.

```json
{
  "sceneID": "REPLACE_SCENE_ID",
  "referenceName": "REPLACE_REFERENCE_NAME",
  "timelineIndex": 0,
  "prompt": "A person doing a relaxed walk along the curved path.",
  "duration": 6,
  "constraints": [{
    "type": "twoPassRepath",
    "strategy": "builtIn",
    "recoveryMode": "strong",
    "preserveMotionDetail": true,
    "repathCurve": {
      "durationSec": 6,
      "sourceFrameCount": 180,
      "headingMode": "tangent",
      "points": [
        {"id": "start", "u": 0, "x": 0, "z": 0, "outHandle": [0, 1]},
        {"id": "end", "u": 1, "x": 2, "z": 3, "inHandle": [1, 3], "holdFrames": 0}
      ]
    }
  }]
}
```

This example assumes an inspected 180-frame source. Replace its count and coordinates with your actual scene. Curve points have increasing `u` from 0 to 1. `inHandle` / `outHandle` are absolute X/Z control points in meters. `holdFrames` requests a pause at a knot. `headingMode: "tangent"` faces along the path; `"original"` requires `sourceHeadings` samples `{ "u": 0, "heading": 0 }`, where heading is yaw in radians. Top-level duration and curve duration must agree when both are supplied.

Add either native `keyPoses` alongside the sole envelope, or inline pose/effector entries in its `trailingConstraints`. Native pose `pathProgress` is normalized **arc-length progress**, not a Bézier parameter. Do not supply duplicate full-body stamps in both forms. The backend plans both passes; obsolete client-authored pass arrays are unsupported. Review stops, changed speed, turns and pose alignment after regeneration.

## Repairing an unsuitable generated pose

Review the source performance and an untouched export on the intended character before adjusting playback. If text-only candidates repeat an unsuitable arm posture, author a small set of full-body poses with the desired elbow bend and hand clearance, then use `keyPoses` to regenerate around them. Keep each pose in the exact native scene skeleton, cadence and units. Do not substitute a browser shoulder offset for a reviewed export.

The included game run demonstrates this process with 13 native Axel pose guides in `examples/game/assets/run.swing-edit-poses.json`. With an inspected matching scene slot, pass its `keyPoses`, `prompt` and `seed` to `edit_motion` with `duration: 5`. Review the result on MHR, including the in-between frames, before applying and exporting it. The file is not an MHR pose array and must not be attached to a different skeleton by joint count alone. The guide poses and hand presets are authored inputs; swing-edit generates the body performance around the guides. See the game audit for the selected stride and remaining limits.

## Looping, stitching and game preparation

`loop_motion` and `stitch_motions` operate on completed motion IDs and create new motion IDs. They are distinct from swing-edit scene edits. Do not substitute an editor job ID for a motion ID or expect these operations to pick up an edited scene automatically. They are synchronous model operations; allow up to four minutes and do not automatically retry an uncertain mutation.

For an edited scene, download its output/export and run the local `prepare-game.mjs` helper to measure travel, contacts and seams. Keep travel before selecting an interior gait cycle. Use explicit source hashes, frame windows and authored gameplay events. Contacts are kinematic estimates; temporal/body masks and loop blending need visual review on the intended character. See `cartwheel://workflows/game` for the playable controller and preparation contract.

Export example after applying reviewed edits:

```json
{
  "sceneID": "REPLACE_SCENE_ID",
  "objectReferenceNamesToExport": ["REPLACE_REFERENCE_NAME"],
  "exportSettings": {
    "exportType": "glb", "forward": "Z", "up": "Y",
    "frameRate": 30, "frameStepSize": 1,
    "includeMesh": true, "moveInPlace": false, "handPose": "relaxed"
  }
}
```

All MCP operations use the authenticated Cartwheel API. Account administration, callback URLs and worker service addresses are not part of this workflow. Keep raw API responses, signed download URLs and keys private.
