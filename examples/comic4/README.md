# Comic 4 video to Blender

Ask your MCP client to use the `comic4_blender_scene` prompt or read `cartwheel://workflows/comic4`.

1. Inspect an authorized local video: at most 30 seconds and smaller than 250 MB.
2. Call `create_media_upload`, for example with `{"media":[{"extension":"mp4","name":"two-performers","duration":8,"resolution":"1920x1080"}]}`.
3. Save the tool's JSON body (the object containing `mediaUploads`) to a private local file. Upload the video's bytes to its assigned slot:

   ```sh
   node /path/to/cartwheel-mcp/examples/comic4/upload-video.mjs \
     /path/to/reference.mp4 /private/path/upload-response.json media-REPLACE_ME
   ```

   This helper runs locally under the client's control. It accepts a selected file and the media slot returned by Cartwheel, streams a PUT to Cartwheel's signed production storage URL, and prints only the media ID and byte count. It never adds an API key header. Registration and upload are distinct steps.

4. Select an accessible character with `list_characters`. Submit `generate_motion_from_video` once:

   ```json
   {
     "batchName": "Two-person camera reveal",
     "mediaIDs": ["media-REPLACE_ME"],
     "comicModel": "comic4",
     "numPeople": 2,
     "facialCapture": true,
     "exportSettings": {
       "characterID": "REPLACE_WITH_ACCESSIBLE_CHARACTER_ID",
       "exportType": "fbx-blender",
       "forward": "Z",
       "up": "Y",
       "frameRate": 30,
       "frameStepSize": 1,
       "moveInPlace": false,
       "includeMesh": true
     }
   }
   ```

5. Poll `get_batch`, then `list_batch_motions` with the batch ID and `limit`. Retrieve every actor's available exports and the captured camera from the returned items. Preserve null slots and actor indices. `get_motion` supplies a primary download or a requested body retarget; it does not return all of the batch item's facial and camera arrays. Do not stop after downloading the primary `bvhURL`.
6. For faces, inspect the MHR FBX in `faceURLs[i].bvhURL` (the field name is historical; the file is FBX), or use the compatible MHR BVH and identity pair. A custom body export does not automatically transfer facial animation to another rig.
7. Import all actors in the same world frame and verify source timing, scale and camera alignment before adding a set. Render the same performance from a new camera angle. Consult the MCP workflow for contact and facial checks.

The upload helper requires Node.js 22+. Blender and media inspection tools run under the client; the MCP server itself does not execute them. Keep private upload responses, source material, credentials and signed asset URLs out of public repositories.

To recast the second actor's body on an accessible GLB character, use `get_motion` with `{"motionID":"YOUR_MOTION_ID","characterID":"YOUR_CHARACTER_ID","bodyIndex":1,"downloadType":"gltf","fps":30}`. Actor indices start at zero. This retargets the body; transferring the face to a custom rig is a separate step.

## Import the captured MHR performers

`import_capture.py` imports one to four MHR FBXs and the optional reconstructed camera into a new Blender 5 scene. It preserves actor placement, body animation, hand articulation, and facial shape keys under one common parent. It does not transfer faces to an arbitrary character or correct contacts automatically.

```sh
blender --background --disable-autoexec --python-exit-code 1 --python examples/comic4/import_capture.py -- \
  --actor /private/path/actor-0-face.fbx \
  --actor /private/path/actor-1-face.fbx \
  --camera /private/path/source-camera.fbx \
  --fps 30 --output /private/path/capture.blend
```

Compare the imported animation at the start, middle and end with the reference. Do not rely on a file extension or requested export rate to establish timing. The importer has explicit `--actor-time-scale` and `--camera-time-scale` options for a **verified cadence mismatch**, applied to every imported channel including facial shape keys. For example, if a 269-frame, 30 fps reference produces 537 body samples whose imported frame coordinates advance by one, but the camera already has the correct cadence, `--actor-time-scale 0.5` maps the body and face to frames 1–269 while leaving the camera alone. This is an observed export case, not a universal Comic 4 conversion factor. Keep the default of 1 when the timing already matches.

## MHR knees in deep crouches

An MHR FBX can include its skeleton and 72 facial shapes while omitting MHR's separate nonlinear pose correctives. Linear skinning alone then loses volume around a deeply bent knee. For a matching LOD1 MHR capture, restore the native blends before making clothing or rendering a crouch.

Download `assets.zip` from the [official MHR v1.0.1 release](https://github.com/facebookresearch/MHR/releases/tag/v1.0.1). Extract `lod1.fbx`, `corrective_activation.npz`, and `corrective_blendshapes_lod1.npz` into a local asset directory. These model assets are [Apache-2.0 licensed](https://github.com/facebookresearch/MHR/blob/main/LICENSE), downloaded separately, and not included in this MCP package.

```sh
blender --background /private/path/capture.blend --disable-autoexec --python-exit-code 1 \
  --python examples/comic4/mhr_knees.py -- \
  --assets /private/path/mhr-assets \
  --output /private/path/capture-corrected.blend
```

The helper validates vertex order, polygon topology, joint axes, and the scale of all 72 facial deltas against the reference. It compiles MHR's released rotation-feature network into ordinary Blender drivers and corrective shape keys, limited to the knee region with a smooth falloff. The saved scene plays without Python handlers, external model files, or a machine-learning runtime. The blends respond to Euler and quaternion pose changes. Original weights, skeletal actions, root motion, facial animation and geometry outside the knee region are preserved.

Keep the original linear Armature modifier. Do not combine these native blends with an additional volume-preserving skinning pass: both would compensate for the same loss. This helper requires the unmodified, complete LOD1 MHR facial FBX imported by `import_capture.py`; it rejects incompatible topology or existing corrections instead of guessing a transfer.

For a garment built from the body, preserve the source vertex IDs and call `copy_knee_correctives(body, garment, source_indices)` from `mhr_knees.py`. This transfers the same pre-skin deltas and links their values to the body. Copying only the original weights leaves the clothing with the old knee deformation. Custom retopology needs an explicit, reviewed corrective transfer.

Review straight legs, the deepest crouch, both knees, and the transition in and out of contact from multiple angles. These are body pose correctives; they do not simulate cloth or fix a captured contact error. Preview the encoded result before publishing.

From a repository checkout, verify the saved driver graph against the native model with `blender -b capture-corrected.blend --disable-autoexec --python-exit-code 1 --python test/blender-mhr-knees.py -- --assets /path/to/mhr-assets`. This checks the motion range, unkeyed Euler/quaternion bends, and the boundary of the corrected region.
