# Create or auto-rig a character

Use the MCP prompt **`create_rigged_character`** (optional `character` description) or resource **`cartwheel://workflows/characters`**. The [full workflow](../../src/workflows/characters.md) covers job states, downloadable assets, recovery and animation.

Text generation:

```text
prepare_character_generation(prompt) → submit_character_generation(jobID, characterName)
  → get_character(characterID) → completed characterFileURL
```

Image generation:

```text
create_media_upload → upload image bytes → prepare_character_generation(mediaID)
  → submit_character_generation(jobID, characterName) → get_character(characterID)
```

Model upload and auto-rigging:

```text
create_character_upload → upload model bytes (optional saved config and thumbnail)
  → submit_character_upload(characterID) → get_character(characterID)
  → completed baseFbxURL / baseGlbURL + configURL
```

Preparation consumes character-generation credits. Submit each job once and poll its returned ID. Wait for `uploadStatus: "COMPLETE"` and usable assets. `generatedStatus: "3D_CONVERT_COMPLETE"` alone is not rig completion. For uploaded models, `characterFileURL` may be the original unrigged file; use the rigged `baseFbxURL` or `baseGlbURL`.

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
