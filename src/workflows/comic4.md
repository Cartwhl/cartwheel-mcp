# Comic 4 performance capture in Blender

Use this workflow when the user supplies a video or asks for captured body and facial performance. Comic 4 supports one to four people. The source performance, capture, character finishing and Blender cinematography are separate stages; preserve their provenance.

## Prepare and upload

Select a video the user has authorized you to process. Inspect the entire clip. Choose a continuous shot with visible bodies, readable faces, and little occlusion. Video references must be at most 30 seconds and smaller than 250 MB. Measure duration, resolution and frame rate with the client's media tools; metadata is not a substitute for inspecting the actual file.

Call `create_media_upload` with the video's extension, name, duration and resolution. This registers upload slots but does not transfer bytes. Use the client's authorized local file tools to PUT the selected video to its returned `mediaUploadURL`. The bundled `upload-video.mjs` helper can perform this transfer using a private saved JSON response. Do not send a Cartwheel API key to a storage URL. A successful PUT is required before capture submission. Keep raw responses and signed URLs private.

## Capture once and track the batch

Use `list_characters` to select an accessible export character. Call `generate_motion_from_video` with the uploaded `mediaIDs`, `comicModel: "comic4"`, the intended `numPeople`, `facialCapture: true` when faces are needed, and complete `exportSettings`. Use `moveInPlace: false`, `frameStepSize: 1`, consistent axes, and the same frame rate for every actor. Leave loop disabled for a faithful reference comparison. Hand-pose presets and static face expressions are not part of this capture tool.

Generation consumes credits. Submit once, save the batch ID, and poll `get_batch`. A timeout does not mean submission failed: inspect recent batches/motions before considering another generation. Use `list_batch_motions` with `limit` and pagination; inspect failed items as well as successful ones. Keep each item's complete output arrays. `get_motion` retrieves the primary motion or a requested body retarget; it does not replace the batch listing for multi-person and facial exports.

## Preserve all actors, faces and the camera

The `list_batch_motions` items are retained without removing fields. Keep the original array indices, including missing slots:

- `bvhURL` is a primary body motion; `bvhURLs` can contain additional body motions. It is not the full facial performance.
- `exportURLs` and `exportFilenames` align by export slot. A null URL means that export is not ready, not that the actor can be discarded.
- `faceURLs[i].bvhURL` is the API's existing field name for that person's **MHR FBX**. Save it as FBX and inspect its meshes, shape keys and animation; do not parse it as body BVH.
- `mhrBvhURLs` and `mhrIdentityJsonURLs` align by output index. Their identity, height and morph data must be applied to a compatible MHR asset.
- `cameraFbxURL`, when present, is the reconstructed source camera. Import it to inspect alignment; do not imply it contains unobserved scene geometry.
- `sourceVideoMediaID` can be resolved with `get_media` for the reference video.

For a different body character, call `get_motion` with its accessible `characterID` and the capture's zero-based `bodyIndex` (0, 1, 2, or 3 as available). The second performer needs `bodyIndex: 1`; repeatedly downloading index 0 creates duplicate performances. Match `downloadType` to the character asset: `gltf` for GLB/GLTF or `fbx` for FBX. These body retargets do not replace the captured MHR facial data.

Do not mix body exports and camera/MHR data until their units, axes, frame rate and start time have been verified. Import everyone into one coordinate frame and preserve relative scale and root translation. Do not center, floor-shift, time-stretch or auto-fit each performer independently. Apply any necessary shared scene transform to all performers and the captured camera together.

The bundled `import_capture.py` imports MHR FBXs and their camera into Blender 5 with a common parent and retains body, hand and facial animation. Compare source and imported timing at several anchors. If the body and camera exports have different sample cadences, its explicit time-scale options can correct the verified discrepancy for all relevant channels together. Do not apply a guessed or universal factor. See the example README for the observed 537-body-sample / 269-reference-frame case.

Use the captured facial animation on a compatible face rig. A body-only retarget onto another character does not automatically transfer facial shape keys. Verify a close-up against the source before claiming face capture in the final scene. Keep manual cleanup limited and documented; do not replace a failed captured performance with authored animation while presenting it as capture.

## Build and review the scene

First render a low-cost source-aligned view and an alternate camera view of the actual capture. Check identity continuity, performer spacing, foot sliding, body intersections, wrist orientation and expression timing throughout the shot. Foot corrections must preserve the pair's shared world placement; reuse the Gaussian contact principles from `cartwheel://workflows/blender` only where applicable to the imported rig.

Finish character silhouettes, clothing and materials after the capture is usable. Review portraits and bent-limb poses before rendering a full edit. A clean performance with a new viewpoint is the core demonstration; source video projection is not a substitute for animated 3D characters.

For MHR knees that collapse in a deep crouch, inspect the exported corrective data before repainting weights or adding IK. The 72 facial shapes do not include MHR's nonlinear body pose correctives. The bundled `examples/comic4/mhr_knees.py` restores the official LOD1 knee blends from separately downloaded MHR assets after checking topology, axes and scale. It compiles the native model into Blender shape keys and drivers with a smooth spatial falloff, retaining the captured motion. Keep the original linear skinning; do not stack another volume-preservation pass over the native correction. Transfer the same corrective deltas to clothing with verified source vertex IDs. Verify the saved drivers across motion extremes, including an unkeyed pose edit, and inspect both knees in the encoded animation. See the example README for setup and compatibility requirements.

Show the source and captured performance in sync, then move the Blender camera to a clearly different angle. Keep any freeze, replay, cut or speed change explicit. Scrub the entire camera path for near-lens foliage, pillars or other geometry that obscures the performers. Inspect the revealed geometry and contacts, and verify the final encoded movie across every cut and motion extreme. Record the source clip and trim, capture model/settings, media and motion IDs, selected exports, manual adjustments, character credits and camera work locally. Exclude keys, signed URLs and internal infrastructure from public material. Preview before publishing when the user requests it.
