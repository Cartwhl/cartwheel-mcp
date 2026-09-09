const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const id = description => ({ type: 'string', minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$', description });
const text = (description, maxLength) => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S', description });
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export const characterDefinitions = [
  {
    name: 'prepare_character_generation', method: 'POST', path: '/characters/generate/prepare',
    description: 'Prepare a new 3D character from exactly one text prompt or uploaded reference-image mediaID. Consumes character-generation credits at this step. For images, create_media_upload and PUT the image bytes first (png, jpg, jpeg, webp). Returns a jobID for submit_character_generation; this is not a completed character or an image preview. Submit preparation once. Read cartwheel://workflows/characters for the complete flow.',
    inputSchema: { ...object({
      prompt: text('Describe the character and its visual style. Choose this or mediaID, not both.', 4000),
      mediaID: id('Accessible reference-image ID returned by create_media_upload, after its bytes have been uploaded.'),
    }), oneOf: [{ required: ['prompt'] }, { required: ['mediaID'] }] },
    annotations: write,
    failureGuidance: 'Preparation may have consumed credits even if no jobID was returned. Do not automatically repeat it. A prepared job is not yet a character in list_characters; preserve any returned jobID for submit_character_generation.',
  },
  {
    name: 'submit_character_generation', method: 'POST', path: '/characters/generate/submit',
    description: 'Start 3D character generation using a jobID from prepare_character_generation. The prepared prompt/image determines appearance; prompt here is only display metadata. This request includes image generation and may take several minutes before returning a characterID. Submit once, then poll get_character. Wait for uploadStatus COMPLETE and usable assets; generatedStatus 3D_CONVERT_COMPLETE alone is not rig completion.',
    inputSchema: object({
      jobID: id('Exact jobID returned by prepare_character_generation. It becomes the characterID.'),
      characterName: text('Optional display name for the character.', 100),
      prompt: text('Optional display description. Does not change the appearance already prepared.', 4000),
    }, ['jobID']),
    annotations: write,
    failureGuidance: 'Generation may have been accepted. Do not resubmit automatically. Poll get_character using the prepared jobID as characterID and inspect list_characters. A missing character immediately after a timeout does not prove generation failed.',
  },
  {
    name: 'create_character_upload', method: 'POST', path: '/characters/upload',
    description: 'Create a character upload slot and return signed model/config/optional thumbnail PUT URLs. This does not read or upload files and does not start rigging. The client uploads the selected model bytes without an API key header, then calls submit_character_upload. A rig config is optional: unrigged meshes are auto-rigged and existing rigs are auto-detected. Keep signed URLs private.',
    inputSchema: object({
      fileExtension: { enum: ['fbx', 'glb', 'gltf', 'ma', 'mb', 'obj', 'mjcf'], description: 'Model format, lowercase without a dot. mjcf uses a MuJoCo ZIP bundle. Prefer self-contained files with embedded dependencies.' },
      characterName: text('Optional character name.', 200),
      characterDescription: text('Optional character description.', 1000),
      thumbnailExtension: { enum: ['png', 'jpg', 'webm'], description: 'Request a matching thumbnail upload slot only when uploading a thumbnail.' },
    }, ['fileExtension']),
    annotations: write,
    failureGuidance: 'An upload slot may have been created. Do not automatically create another. Inspect list_characters to recover the character ID; slot creation alone does not upload bytes or start auto-rigging.',
  },
  {
    name: 'submit_character_upload', method: 'POST', path: '/characters/{characterID}/submit',
    description: 'Process a character after the model bytes and any optional config/thumbnail have finished uploading. Auto-rigs an unrigged mesh or detects an existing rig; a supplied saved config seeds the mapping. Returns processing status. Poll get_character until COMPLETE or a failure/validation state. Download baseFbxURL/baseGlbURL for the rigged result: characterFileURL may still be the original unrigged upload. Sequential repeat submissions return the current status.',
    parameters: [{ name: 'characterID', location: 'path' }],
    inputSchema: object({ characterID: id('Exact characterID returned by create_character_upload, after the model bytes have been uploaded.') }, ['characterID']),
    annotations: { ...write, idempotentHint: true },
    failureGuidance: 'Check get_character for this characterID before another submission. PENDING can mean the model bytes were not uploaded; do not recreate the character slot. FAILED, ADJUSTMENT_FAILED or NEEDS_VALIDATION require inspection rather than repeated submission.',
  },
];
