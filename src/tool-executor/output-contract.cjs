const Ajv = require('ajv');
const { keyPose } = require('./swing-edit-constraints.cjs');
const { ResponseTooLargeError } = require('./response-errors.cjs');
const JSON_LIMIT = 1024 * 1024;
function withinJSONLimit(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= JSON_LIMIT; }
  catch { return false; }
}
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' }, number = { type: 'number' }, boolean = { type: 'boolean' };
const nullableString = { type: ['string', 'null'] };
const array = items => ({ type: 'array', items });
const rotationOffsets = object(Object.fromEntries(['head', 'left_ankle', 'right_ankle', 'left_collar', 'right_collar',
  'left_hip', 'right_hip', 'left_shoulder', 'right_shoulder', 'neck']
  .map(bone => [bone, { ...array(number), minItems: 3, maxItems: 3 }])));
// Batch records may serialize boolean export options as strings; submit responses use booleans.
const exportBoolean = { oneOf: [boolean, string] };
const batchExportSettings = object({ characterID: string, exportType: string, forward: string, up: string,
  frameRate: number, frameStepSize: number, moveInPlace: exportBoolean, includeMesh: exportBoolean,
  keyframeCleaning: string, faceExpression: string, handID: string, handPose: string,
  ikFeet: exportBoolean, ikHands: exportBoolean, rotationOffsets, skeletonTemplate: string, trimValues: string, skinHex: string });
const batch = object({ batchID: string, status: string, estimatedSecondsWaitTime: number,
  batchName: string, rejectedReason: string, type: string, model: string, loop: boolean, requestedDuration: number, createdAt: string,
  exportSettings: batchExportSettings, numPeopleByMediaID: { type: 'object', additionalProperties: number },
  modelProperties: object({ comicModel: string, facialCapture: boolean, footPlanting: boolean, qualityPreset: string,
    numPeople: number, duration: number, cfgScale: number }),
  downloadURL: nullableString, thumbnailURL: nullableString, batchZipExportStatus: string, batchZipFileCount: number,
  numTotalJobs: number, numSucceededJobs: number, numFailedJobs: number }, ['batchID', 'status']);
const assets = array(nullableString);
// Public signed outputs and stable actor identities; raw storage paths/creator metadata stay private.
const actorIdentity = object({ outputIndex: { type: 'integer', minimum: 0 }, targetID: string,
  kind: { const: 'person' }, actorLabel: string, selectionID: string, selectionRevision: number });
const actorOutput = object({ actorIndex: { type: 'integer', minimum: 0 }, bvhURL: string,
  mhrBvhURL: string, mhrIdentityJsonURL: string, mhrFbxURL: string, exportURL: string, exportFilename: string });
const motionFields = { jobID: string, motionID: string, status: string, errorMessage: string,
  variationID: number, durationSeconds: number, createdAt: string, lastUpdatedAt: string,
  bvhURL: string, cwmsURL: string, studioPreviewURL: string, bvhURLs: assets, bvh_urls: assets,
  exportURLs: assets, export_urls: assets, exportFilenames: array(nullableString), export_filenames: array(nullableString),
  faceURLs: array({ ...object({ bvhURL: string, jsonURL: string }), type: ['object', 'null'] }),
  mhrBvhURLs: assets, mhrIdentityJsonURLs: assets, cameraFbxURL: string, cameraJsonURL: string, sourceVideoMediaID: string,
  actorOutputs: array(actorIdentity), outputs: array({ ...actorOutput, type: ['object', 'null'] }) };
// Titles are established listing data, not preview rig metadata on get_motion.
const listingFields = { ...motionFields, title: string };
const motion = object({ ...listingFields, variations: array(object(listingFields)) });
const motions = object({ items: array(motion), nextToken: string, hasMore: boolean }, ['items']);
// Persisted native skeleton snapshots are not swing-edit write inputs. The bundled
// MHR skin has 127 joints (183 with leaf End Sites), not a universal persisted
// skeleton maximum. Use a bounded 512-entry read ceiling for larger saved rigs;
// retain the 256-entry write ceiling and the aggregate 1 MiB response protection.
const outputKeyPose = { ...keyPose, properties: { ...keyPose.properties,
  localJointRot: { ...keyPose.properties.localJointRot, maxItems: 512 },
}, required: ['frame', 'localJointRot', 'rootPosition'] };
const outputKeyPoses = { ...array(outputKeyPose), maxItems: 300 };
const timeline = object({ jobID: string, generationType: string, variationNumber: number, outputNumber: number,
  title: string, trimStart: number, trimEnd: number, stitchStartDelay: number, stitchEndDelay: number,
  staticHands: string, appliedMotionEditJobID: string, bvhURL: string, originalBvhURL: string, stitchBvhURL: string,
  keyPoses: outputKeyPoses });
const sceneObject = object({ objectID: string, referenceName: string, timeline: array(timeline) }, ['objectID', 'timeline']);
const scene = object({ sceneID: string, sceneName: string, type: string,
  objects: { type: 'object', additionalProperties: sceneObject } }, ['sceneID', 'objects']);
const pendingSceneRetarget = object({ jobID: { ...string, minLength: 1 }, status: { const: 'PROCESSING' } }, ['jobID', 'status']);
const edit = object({ jobID: string, status: string, operation: string, prompt: string, userKeyPoseCount: number,
  outputBvhURL: string, thumbnailUrl: string, keyPoses: outputKeyPoses }, ['jobID', 'status']);
const exportsResult = object({ exports: array(object({ exportID: string, objectID: string, objectReferenceName: string,
  requestedType: string, sceneID: string, sceneName: string, status: string })), downloadURL: string }, ['exports']);
const characterFields = { jobID: string, characterID: string, characterName: string, uploadStatus: string, generatedStatus: string,
  characterDescription: string, errorMessage: string, createdAt: string,
  fileExtension: nullableString, extension: string, estimatedSecondsWaitTime: number, characterFileURL: nullableString,
  characterFbxURL: nullableString, baseFbxURL: nullableString, baseGlbURL: nullableString, thumbnailURL: nullableString,
  configURL: nullableString, tempConfigURL: nullableString, referenceImageURL: nullableString, meshURL: nullableString,
  markerAdjustmentEligible: boolean, mappingAdjustmentEligible: boolean, rotationOffsets };
const categoryInformation = array(object({ category: string, docCount: number,
  subcategories: array(object({ subcategory: string, docCount: number,
    tags: array(object({ tag: string, docCount: number })) })) }));
const outputSchemas = {
  get_account: object({ planType: string, currentCredits: number,
    allowedNumBatches: { type: 'integer' }, allowedNumBatchSize: { type: 'integer' } },
  ['planType', 'currentCredits', 'allowedNumBatches', 'allowedNumBatchSize']),
  list_characters: object({ characters: array(object(characterFields)), nextToken: nullableString }, ['characters']),
  generate_motion: batch, get_batch: batch, list_batch_motions: motions,
  get_character: object(characterFields, ['characterID']),
  list_scenes: object({ scenes: array(scene), nextToken: string }, ['scenes']), get_scene: scene,
  set_scene_character: { type: 'object', oneOf: [scene, pendingSceneRetarget] }, apply_motion_edit: scene,
  get_motion: object({ ...motionFields, motionID: string, sourceBvhURL: string, fbxURL: string, gltfURL: string }),
  search_motions: object({ items: array(object({ motionID: string, title: string, short: string, tags: array(string),
    categoryAndSubcategories: array(string), mp4URL: string, gifURL: string })), total: number, pageSize: number,
    categoryInformation, hasMore: boolean, lastSort: array({ oneOf: [number, string] }) }, ['items']),
  list_motions: motions, create_scene: scene,
  list_motion_edits: object({ jobs: array(edit) }, ['jobs']), get_motion_edit: edit,
  save_key_poses: object({ status: { const: 204 } }, ['status']), export_scene: exportsResult, get_scene_exports: exportsResult,
};
const ajv = new Ajv({ strict: false, strictNumbers: true, validateFormats: false });
const validators = new Map(Object.entries(outputSchemas).map(([name, schema]) => [name, ajv.compile(schema)]));
function safeAsset(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'getcartwheel.com' || url.hostname.endsWith('.getcartwheel.com') || url.hostname.endsWith('.amazonaws.com'));
  } catch { return false; }
}
function project(value, schema, field = '') {
  if (value === null && Array.isArray(schema.type) && schema.type.includes('null')) return null;
  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid upstream data');
    if (!schema.properties) return Object.fromEntries(Object.entries(value).map(([key, v]) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(key)) throw new Error('Invalid reference');
      return [key, project(v, schema.additionalProperties)];
    }));
    return Object.fromEntries(Object.entries(schema.properties).filter(([key]) => Object.hasOwn(value, key))
      .map(([key, child]) => [key, project(value[key], child, key)]));
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error('Invalid upstream data');
    return value.map(item => project(item, schema.items, field));
  }
  if (/urls?$/i.test(field) && (value === null || !safeAsset(value))) {
    if (Array.isArray(schema.type) && schema.type.includes('null')) return null;
    throw new Error('Invalid asset URL');
  }
  return value;
}
function assertSafeOutput(value, secrets) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw new Error('Invalid upstream data'); }
  if (typeof serialized !== 'string') throw new Error('Invalid upstream data');
  if (Buffer.byteLength(serialized, 'utf8') > JSON_LIMIT) throw new ResponseTooLargeError();
  if (/Bearer\s/i.test(serialized) || secrets.some(secret => secret && serialized.includes(secret))) throw new Error('Credential reflection');
}
function projectToolOutput(name, value, secrets = []) {
  const schema = outputSchemas[name];
  const normalizeMotion = (item, nested = false) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid upstream data');
    const result = { ...item };
    for (const field of ['variationID', 'durationSeconds']) {
      if (!Number.isFinite(result[field]) || result[field] < (field === 'variationID' ? 0 : Number.MIN_VALUE) ||
        (field === 'variationID' && !Number.isSafeInteger(result[field]))) delete result[field];
    }
    for (const field of ['bvhURL', 'sourceBvhURL', 'studioPreviewURL', 'fbxURL', 'gltfURL', 'cwmsURL', 'cameraFbxURL', 'cameraJsonURL']) {
      if (!safeAsset(result[field])) delete result[field];
    }
    if (!nested && Array.isArray(result.variations)) result.variations = result.variations.map(item => normalizeMotion(item, true));
    return result;
  };
  if (['list_batch_motions', 'list_motions'].includes(name) && Array.isArray(value?.items)) {
    value = { ...value, items: value.items.map(item => normalizeMotion(item)) };
  }
  if (name === 'get_motion') value = normalizeMotion(value);
  // MJCF character changes return an accepted retarget job rather than a scene.
  const projectionSchema = name === 'set_scene_character'
    ? (value?.status === 'PROCESSING' ? pendingSceneRetarget : scene) : schema;
  const output = projectionSchema ? project(value, projectionSchema) : value;
  if (schema && !validators.get(name)(output)) throw new Error('Invalid upstream data');
  assertSafeOutput(output, secrets);
  return output;
}
module.exports = { outputSchemas, projectToolOutput, safeAsset, JSON_LIMIT, withinJSONLimit };
