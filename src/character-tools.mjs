const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const id = description => ({ type: 'string', minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$', description });
const text = (description, maxLength) => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S', description });
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const numVariations = { type: 'integer', minimum: 1, maximum: 25, description: 'Number of final characters from this row. Defaults to 1; the batch total cannot exceed 25.' };

export const characterDefinitions = [
  {
    name: 'generate_character_batch', method: 'POST', path: '/characters/generate/batch',
    description: 'Submit one asynchronous batch of characters from text prompts or uploaded reference images. Each job contains prompt or mediaID, never both. For images, create_media_upload and PUT the bytes first. Returns a batchID; check get_batch, then list_batch_characters and get_character. Image preparation and rigging consume credits. Submit once, then poll rather than submitting again.',
    inputSchema: object({
      batchName: text('Optional batch name.', 100),
      jobs: { type: 'array', minItems: 1, maxItems: 25, items: { oneOf: [
        object({
          prompt: text('Describe the character and visual style.', 4000),
          characterName: text('Optional character name.', 100),
          numVariations,
        }, ['prompt']),
        object({
          mediaID: id('Accessible reference-image ID after its bytes have been uploaded.'),
          referenceImageMode: { enum: ['INSPIRATION', 'DIRECT'], description: 'INSPIRATION generates a new image (default); DIRECT uses the uploaded image unchanged and supports one character.' },
          characterName: text('Optional character name.', 100),
          numVariations,
        }, ['mediaID']),
      ] } },
      idempotencyKey: text('Optional key to reuse with the exact same jobs and batchName after an uncertain submission. A new submission needs a new key.', 128),
    }, ['jobs']),
    annotations: write,
    failureGuidance: 'The batch may have been accepted or charged. Do not submit a new request automatically. Retry only with the same idempotencyKey and unchanged body, or inspect the existing batch if its ID was returned.',
  },
  {
    name: 'list_batch_characters', method: 'GET', path: '/characters/batches/{batchID}',
    description: 'List generated characters and individual failures for a character batch. Follow nextToken until every page has been read, then use get_character for each returned characterID and wait for uploadStatus COMPLETE before using its rigged assets.',
    parameters: [
      { name: 'batchID', location: 'path' },
      { name: 'limit', location: 'query' },
      { name: 'nextToken', location: 'query' },
    ],
    inputSchema: object({
      batchID: id('The batch-character-* ID returned by generate_character_batch.'),
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      nextToken: text('Pagination token from the previous page.', 4096),
    }, ['batchID']),
    annotations: read,
  },
  {
    name: 'prepare_character_generation', method: 'POST', path: '/characters/generate/prepare',
    description: 'LEGACY single-character flow. Prefer generate_character_batch for new characters. Prepare one character from exactly one text prompt or uploaded reference-image mediaID. Consumes character-generation credits. For images, create_media_upload and PUT the bytes first (png, jpg, jpeg, webp). Returns a jobID for submit_character_generation; it is not a completed character or preview. Submit preparation once.',
    inputSchema: { ...object({
      prompt: text('Describe the character and its visual style. Choose this or mediaID, not both.', 4000),
      mediaID: id('Accessible reference-image ID returned by create_media_upload, after its bytes have been uploaded.'),
    }), oneOf: [{ required: ['prompt'] }, { required: ['mediaID'] }] },
    annotations: write,
    failureGuidance: 'Legacy preparation may have consumed credits even if no jobID was returned. Do not automatically repeat it. Preserve any returned jobID for submit_character_generation.',
  },
  {
    name: 'submit_character_generation', method: 'POST', path: '/characters/generate/submit',
    description: 'LEGACY single-character flow. Submit a jobID from prepare_character_generation. The prepared prompt/image determines appearance; prompt here is display metadata only. This can take several minutes before returning a characterID. Submit once, then poll get_character until uploadStatus COMPLETE and usable assets; generatedStatus 3D_CONVERT_COMPLETE alone is not rig completion. Prefer generate_character_batch for new characters.',
    inputSchema: object({
      jobID: id('Exact jobID returned by prepare_character_generation. It becomes the characterID.'),
      characterName: text('Optional display name for the character.', 100),
      prompt: text('Optional display description. Does not change the appearance already prepared.', 4000),
    }, ['jobID']),
    annotations: write,
    failureGuidance: 'Legacy generation may have been accepted. Do not resubmit automatically. Poll get_character using the prepared jobID as characterID and inspect list_characters. A missing character immediately after a timeout does not prove generation failed.',
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

export function validateCharacterBatchArguments(name, args) {
  if (name !== 'generate_character_batch') return;
  const total = args.jobs.reduce((count, job) => count + (job.numVariations ?? 1), 0);
  if (total > 25) throw new Error('A character batch can request at most 25 final characters.');
  if (args.jobs.some(job => job.referenceImageMode === 'DIRECT' && (job.numVariations ?? 1) !== 1)) {
    throw new Error('DIRECT reference images support exactly one character per job.');
  }
}
