# Character creation and auto-rigging

Use this workflow to generate a new character from text or an image, or to import and auto-rig an existing model. All service calls use the caller's Cartwheel project key. The MCP client handles the selected local files; the MCP server does not run Blender or upload file bytes itself.

For new generation, one batch may mix text-prompt and reference-image jobs. Each job supplies either a `prompt` or an uploaded `mediaID`, never both. The sum of requested final characters across all jobs and their `numVariations` values must not exceed 25; the number of jobs is not necessarily the number of characters.

## Generate from text

1. Call `generate_character_batch` once with one or more jobs. For example:

   ```json
   { "batchName": "Forest couriers", "jobs": [
     { "prompt": "A friendly humanoid forest courier, quilted green jacket, leather boots, expressive face, stylized animation character", "characterName": "Courier" }
   ] }
   ```

   Image preparation and character generation consume credits. The response contains a `batchID`, not a character ID. The server also returns the submission's `idempotencyKey`. Preserve both; reuse that key with the exact same request body only if submission acceptance was uncertain. Never resubmit simply to check progress.

2. Poll `get_batch` with the returned `batchID` until it reaches a final status. Then page through `list_batch_characters` using `nextToken`. Inspect every row: one image or character can fail while others complete. Use each returned `characterID` with `get_character` until `uploadStatus` is `COMPLETE` or a failure state. Download the completed `characterFbxURL` for a rigged FBX or `characterFileURL` for its preview model, plus available `configURL` / `thumbnailURL`, using the client's file tools.

## Generate from a reference image

1. Use an image the user selected or authorized. Call `create_media_upload`:

   ```json
   { "media": [{ "extension": "png", "name": "courier-reference" }] }
   ```

   Supported reference images are `png`, `jpg`, `jpeg`, and `webp`. Omit video duration for an image. Save the JSON body containing `mediaUploads` in a private file outside the repository.

2. PUT the actual image bytes to its `mediaUploadURL` before preparation. The bundled helper runs under the MCP client's local execution authority:

   ```sh
   node /path/to/cartwheel-mcp/examples/characters/upload-asset.mjs image \
     /private/path/reference.png /private/path/media-upload.json media-REPLACE_ME
   ```

   Use the exact returned media ID. The helper permits signed Cartwheel production storage only, rejects redirects, and sends no project API key to storage.

3. Call `generate_character_batch` with `{ "jobs": [{ "mediaID": "media-REPLACE_ME" }] }`, omitting `prompt` from that job. Choose the image mode for that job:

   - **INSPIRATION (default):** Generate a new image guided by the reference. Prefer this when the source is meant as visual inspiration rather than a clean character reference, or is cropped, posed, poorly lit, carrying items, or otherwise unsuitable as direct 3D input. The generated image may change details of the original and incurs image-generation billing.
   - **DIRECT:** Set `"referenceImageMode": "DIRECT"` in the job to pass the uploaded image unchanged to 3D generation. Use it when the user wants to preserve that image and it already shows one unobstructed, full-body character facing forward in a neutral A- or T-pose, with visible separated limbs, even lighting, a simple background, and no held objects. Side views, action poses, cropped limbs, overlapping parts, harsh shadows, or props can make the mesh or rig unreliable. DIRECT skips image-generation billing but still incurs character-generation billing and supports only one final character for that job.

   Use the same batch → list → character sequence as text generation. Do not send a local file path or arbitrary image URL in place of `mediaID`.

## Legacy single-character generation

`prepare_character_generation` and `submit_character_generation` remain available for existing prepared `jobID`s and clients that require the older flow. Prefer `generate_character_batch` for new work. Legacy preparation accepts exactly one `prompt` or uploaded `mediaID`, consumes credits, and returns a `jobID`. Pass that ID once to `submit_character_generation`, then poll `get_character` using the same ID. The optional submit `prompt` is display metadata; it does not change the prepared appearance. Both legacy calls may take several minutes and are never retried automatically after an uncertain result.

## Upload and auto-rig a model

1. Inspect the selected model locally. Prefer a self-contained GLB or FBX with embedded textures; referenced files on the user's disk will not accompany a single-file upload. The API accepts `fbx`, `glb`, `gltf`, `ma`, `mb`, `obj`, and `mjcf`. A MuJoCo `mjcf` slot takes a ZIP bundle; this is not a general ZIP option for other formats.

2. Call `create_character_upload`, for example:

   ```json
   { "fileExtension": "glb", "characterName": "Forest Courier", "characterDescription": "Custom model for the animation" }
   ```

   Save the returned `characterID` and private response. Creating the slot does not upload bytes or start processing.

3. Upload the model:

   ```sh
   node /path/to/cartwheel-mcp/examples/characters/upload-asset.mjs character \
     /private/path/courier.glb /private/path/character-upload.json
   ```

   **A rig config is optional.** Without one, the service auto-rigs an unrigged mesh or detects an existing rig. Only provide a real compatible Cartwheel config when one is available; do not invent mappings or a placeholder config. Upload an optional saved config using the helper's `config` mode and `configUploadURL`. If a `thumbnailExtension` was requested, `thumbnail` mode uploads the matching file. Finish all uploads before submitting. `tempConfigUploadURL` is for temporary mapping work and does not replace the saved config used for initial processing.

4. Call `submit_character_upload` with `{ "characterID": "REPLACE_WITH_UPLOADED_CHARACTER_ID" }`. The API checks that the mesh exists before processing. Poll `get_character` for this same ID; repeated submission is not a status check.

5. At `uploadStatus: "COMPLETE"`, download `baseFbxURL` or `baseGlbURL` and `configURL`. **For uploaded characters, `characterFileURL` may still point to the original unrigged mesh.** Do not import it as the rigged result. If the native rigged deliverable is absent, report that and inspect the character; do not silently substitute the source mesh or another character.

## Status, recovery and review

| Response | Next action |
| --- | --- |
| `PENDING` after slot creation | Finish the bytes upload, then submit. |
| Character batch is `VALIDATING` or `IN_PROGRESS` | Poll `get_batch`, respecting `estimatedSecondsWaitTime` as an estimate. Then use `list_batch_characters` to inspect individual outcomes. |
| `PENDING`, `AUTORIGGING_IN_PROGRESS`, or `RETARGETING_IN_PROGRESS` after submission | Poll `get_character` for each listed character. Use the client's wait tools between checks. |
| Generated character is `QUEUED` or `3D_CONVERT_*` | Continue checking both `generatedStatus` and `uploadStatus`. `3D_CONVERT_COMPLETE` does not mean the rig is ready. |
| `uploadStatus: COMPLETE` | Confirm the exact character ID and usable output files, then review the rig. |
| `FAILED`, `ADJUSTMENT_FAILED`, or `generatedStatus: 3D_CONVERT_FAILED` | Stop polling and inspect the failed character in Cartwheel. Do not create or submit another paid job automatically. |
| `NEEDS_VALIDATION` | Inspect and resolve the rig or mapping in Cartwheel. The MCP does not provide a marker/mapping validation UI. |
| Timeout or disconnected batch submission | The batch may have been accepted. If a `batchID` was returned, poll it. Otherwise preserve the returned `idempotencyKey` and retry only the exact same request with that key after an uncertain response. Do not generate a new key for the retry. |

Batch submission returns before image preparation and character generation finish. The server never automatically retries. `get_batch` can be `COMPLETED` when some individual characters failed, so always inspect all pages of `list_batch_characters`. `get_character` rejects a response whose `characterID` differs from the requested ID.

The upload helper caps model files at 1 GiB, reference images and thumbnails at 50 MiB, and configs at 16 MiB. These are local helper limits, not promises about service capacity. It uploads one chosen file per invocation and prints only the asset ID, kind, byte count and success flag. Keep source files, upload responses and signed URLs private.

Import the actual rigged output and inspect the rest pose, shoulders, elbows, hands, hips and knees with a short motion. Auto-rigging is not a guarantee of facial blendshapes, cloth simulation, or a particular skeleton such as MHR. Use the returned character ID for later animation; do not relabel a custom rig as MHR.

To animate it with **swing-edit**, create a scene from an accessible seed motion, call `set_scene_character` with the new character ID, and follow `cartwheel://workflows/swing-edit` to generate, review, apply and export. For a standalone Swing batch, use the new character ID in `generate_motion.exportSettings.characterID`. Reuse this character instead of generating or uploading it again for each clip.

## Finish generated rigs in Blender

Use the [Lantern Port example](https://github.com/Cartwhl/cartwheel-mcp/tree/main/examples/lantern-port) for three generated characters, Comic 4 acting, swing-edit walking and a complete Blender set with camera cuts. The scene assets and rendered film are in the GitHub checkout; they are not bundled into the npm server package.

The Lantern Port builder replaces the current Blender scene; use a fresh file/process for the example.

For these generated rigs, enable **Preserve Volume** on the Armature modifier (`use_deform_preserve_volume = True`). It substantially improved the shoulder collapse observed with linear skinning in this example. Review raised arms, bent elbows and knees after enabling it; it is a skinning choice, not a motion or rest-pose correction. Do not apply this blindly to MHR with its native body correctives, which expects linear skinning.

Inspect the mesh shading separately from the motion. The example's exported custom normals produced dark, broken-looking patches even with the normal-map strength set to zero. Clearing those custom split normals and recomputing smooth mesh normals restored the generated materials. Keep the color textures and rig intact; check the actual asset before applying this repair to another character.

When fitting a GLB to a scene, measure only its skinned meshes. Blender's glTF importer can create a hidden icosphere for bone display; including it in the bounds gives an incorrect character height and floor offset. Apply a constant scene placement and scale, preserve root travel, and check feet throughout the performance. Do not change bone rest transforms to solve a shading or silhouette problem.

Use Gaussian-eased planted-foot IK for the generated-rig example. Its solver measures the actual weighted boots, anchors established contacts, preserves the original knee bend plane and segment lengths, and anticipates pelvis lowering near full leg extension. It uses 80 ms contact easing and a 45 ms ankle-roll smoothing pass. Swing phases remain free. A smooth floor bound keeps soles clear without lifting established plants.

Check skinned sole geometry after IK: a fixed ankle alone does not prevent a soft sole from deforming. These three characters wear rigid work boots, so their sole weights are anchored to the ankle with a soft transition into the original upper-boot weights. Adapt that footwear finishing for different characters; keep MHR's native deformation model intact. Run the example's `verify_contacts.py` and review the movie before final rendering. It checks actual sole drift, floor clearance, ankle rotation, knee acceleration and unchanged leg lengths across the full clip.
