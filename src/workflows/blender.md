# Grounded Cartwheel → Blender workflow

Use this workflow by default when a user asks to turn Cartwheel motion into a Blender scene. The MCP prompt is `grounded_blender_scene`; this guide is also available at `cartwheel://workflows/blender`. The package includes the approved example scripts and four generated BVH motions under `examples/blender/`.

## Start with a working scene

For a packaged install, copy the bundled `examples/blender` directory into the task's writable workspace before editing or rendering, keeping its scripts and `assets` directory together. A writable repository checkout can use the examples directly.

For a gallery demo, use the bundled motions without making API calls. Choose `after-hours` (two dances and a DJ), `garden` (tai chi), or `moon` (walking along a circular route). Build a preview first:

```sh
python3 /path/to/cartwheel-mcp/examples/blender/render_examples.py \
  --blender /Applications/Blender.app/Contents/MacOS/Blender \
  --device METAL --example all --preview-only
```

Use the actual Blender executable on the user's machine. The scripts target Blender 5.2. Select a supported Cycles device; use `CPU` when appropriate. The command builds editable scenes and preview images, then verifies grounding and pose continuity. Python 3 and FFmpeg are required for the complete movie workflow.

For a new generated performance, first use `list_characters` to select an accessible character. Submit `generate_motion` once with Swing, an eight-second prompt, and complete BVH export settings. Poll `get_batch`, then retrieve `list_batch_motions` with the returned batch ID and `limit`. Generation consumes credits; polling must not resubmit the generation. Download the returned BVH using the client's authorized local file tools, and keep signed URLs and raw API responses out of published files. Use the file in the scene's `animate_bot` call or replace the matching example asset.

## Retarget without destroying contact

The default adapter is `examples/blender/motion.py`. Reuse it for these native Cartwheel rigs:

1. Read the BVH frame time and sample it at the scene's 24 fps. The gallery is eight seconds long and uses the native Cartwheel joint names.
2. Preserve the source's horizontal travel. Recenter by a constant offset; do not subtract the moving pelvis from an otherwise travelling performance.
3. For an authored route, advance by accumulated source travel distance and transform the pose along the route before solving contact. The lunar route is Blender placement, not a path or pose constraint sent to the motion model.
4. Detect stance from source ankle height and speed. The same detector adapts its speed threshold to source root speed across all examples.
5. Blend toward shoe-center anchors with symmetric Gaussian contact weights, using a 60 ms sigma. Smooth the transition into and out of contact and allow natural pivots.
6. Use the original knee bend plane for two-bone IK. Keep a small bend reserve near full extension and smoothly anticipate pelvis lowering so a contact change does not snap the knee or body.
7. Derive shoe yaw from the source ankle rotation's vertical-axis twist. Unwrap and smooth it. Projecting a nearly vertical toe directly onto the floor creates spurious yaw flips.
8. Keep the floor at the actual sole height and place props clear of the restored travel. The DJ's feet stay planted while its upper body performs.

Do not replace this with hard contact switches, shoulder-driven shoe rotation, per-clip foot patches, or an independently timed path. The adapter handles stylized native-rig examples on a flat floor; arbitrary rigs, terrain, and different clip durations require corresponding scene and validation work.

## Check motion before the final render

The example driver runs `verify_motion.py` before rendering the movies. It checks source-rotation yaw extraction, Gaussian transitions, IK segment lengths and knee direction, established-contact shoe drift, floor clearance, foot turns, knee acceleration, and the DJ's planted feet. To check existing scenes directly:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python-exit-code 1 --python /path/to/cartwheel-mcp/examples/blender/verify_motion.py
```

Inspect a moving preview as well. A low foot-sliding score alone does not establish good motion: look for knee pops, suction-like touchdown, foot flips, abrupt pelvis movement, hovering, and prop intersections. Compare the corrected performance with the source when diagnosing a regression. Preserve user-requested review gates before publishing.

## Render and deliver

Run the same `render_examples.py` command without `--preview-only` for the final movies. It uses the approved contact workflow automatically, checks the scenes, renders Cycles frame sequences, and encodes MP4s. After Hours is 1920 × 1200 with original music; Garden and Moon are 1600 × 1000. All are eight seconds at 24 fps. Output files are written beside the example scripts and are overwritten on rebuild; save user-edited scenes separately.

Return the movie and editable scene paths, mention the validation performed, and describe any remaining limitations. The server supplies API tools and this workflow; Blender execution and local file access remain with the MCP client's authorized tools. No shell execution, general filesystem access, or additional API endpoints are exposed by the server.
