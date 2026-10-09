# Create or auto-rig a character

Use the MCP prompt **`create_rigged_character`** (optional `character` description) or resource **`cartwheel://workflows/characters`**. The [full workflow](../../src/workflows/characters.md) covers job states, downloadable assets, recovery and animation.

Text generation:

```text
generate_character_batch(jobs: [{ prompt, characterName }]) → get_batch(batchID)
  → list_batch_characters(batchID) → get_character(characterID) → completed characterFbxURL
```

Image generation:

```text
create_media_upload → upload image bytes → generate_character_batch(jobs: [{ mediaID }])
  → get_batch(batchID) → list_batch_characters(batchID) → get_character(characterID)
```

Model upload and auto-rigging:

```text
create_character_upload → upload model bytes (optional saved config and thumbnail)
  → submit_character_upload(characterID) → get_character(characterID)
  → completed baseFbxURL / baseGlbURL + configURL
```

Batch generation consumes credits. Submit a batch once, poll its ID, and inspect every returned character; individual jobs may fail. The response includes an `idempotencyKey` for an uncertain submission retry with exactly the same body. Wait for `uploadStatus: "COMPLETE"` and usable assets. `generatedStatus: "3D_CONVERT_COMPLETE"` alone is not rig completion. For uploaded models, `characterFileURL` may be the original unrigged file; use the rigged `baseFbxURL` or `baseGlbURL`.

For an existing prepared `jobID` or a client that requires the older single-character flow, the **legacy** tools remain available: `prepare_character_generation` → `submit_character_generation` → `get_character`. Prefer batch generation for new characters.

## Upload helper

The helper requires Node.js 22+. Run it through your MCP client's local execution tools. Save the parsed JSON body from the upload tool to a **private file outside this repository**. For images, that body contains the `mediaUploads` array; for characters, it contains `characterID` and `characterFileUploadURL`.

```sh
# After create_character_upload with fileExtension: "glb"
node examples/characters/upload-asset.mjs character \
  /private/path/model.glb /private/path/character-upload.json

# After create_media_upload with extension: "png"
node examples/characters/upload-asset.mjs image \
  /private/path/reference.png /private/path/media-upload.json media-REPLACE_ME

# Optional compatible saved config; finish this before submit_character_upload
node examples/characters/upload-asset.mjs config \
  /private/path/config.json /private/path/character-upload.json

# Only if create_character_upload requested the matching thumbnailExtension
node examples/characters/upload-asset.mjs thumbnail \
  /private/path/thumbnail.png /private/path/character-upload.json
```

The helper streams only the selected file to the corresponding signed URL on Cartwheel production storage. It rejects redirects and unsupported or mismatched extensions, and never sends the project API key to storage or prints signed URLs. It does not submit generation or auto-rigging. Its limits are 1 GiB for models, 50 MiB for images/thumbnails, and 16 MiB for configs.

Supported models: FBX, GLB, glTF, Maya ASCII/binary, OBJ, and MuJoCo (`fileExtension: "mjcf"` with a `.zip` bundle). Use self-contained assets: the helper does not upload external textures, glTF buffers, or other referenced files. Supported reference images: PNG, JPG, JPEG and WebP. A rig config is optional; without one, the API auto-rigs an unrigged mesh or detects an existing rig.

After download, inspect the rig in Blender and test a short animation before production use. For **swing-edit**, select this character with `set_scene_character` and follow the [swing-edit workflow](../../src/workflows/swing-edit.md). Facial rigs, cloth simulation and MHR conversion are separate capabilities.

For a complete rendered example using three new characters, see [Lantern Port](../lantern-port/README.md). It includes generated GLBs, Comic 4 acting, swing-edit walking, four camera shots, and measured Gaussian foot-contact IK. Clone the GitHub repository to obtain its scene assets; the npm package includes the character upload helper and workflow documentation.
