// Explicit reviewed exposure. Adding a local definition never exposes it hosted.
const Ajv = require('ajv');
const { definitions, toolRequest } = require('./index.cjs');
const { keyPose } = require('./swing-edit-constraints.cjs');
const HOSTED_JSON_LIMIT = 1024 * 1024;
function withinJSONLimit(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= HOSTED_JSON_LIMIT; }
  catch { return false; }
}
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' }, number = { type: 'number' }, boolean = { type: 'boolean' };
const array = items => ({ type: 'array', items });
const text = maxLength => ({ type: 'string', minLength: 1, maxLength, pattern: '^(?!.*[\\x00-\\x1f\\x7f])[\\s\\S]*\\S[\\s\\S]*$' });
const identifier = { ...text(256), pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' };
const pagination = { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, nextToken: text(4096) };
const batch = object({ batchID: string, status: string, estimatedSecondsWaitTime: number,
  numTotalJobs: number, numSucceededJobs: number, numFailedJobs: number }, ['batchID', 'status']);
const assets = array({ type: ['string', 'null'] });
const motionFields = { jobID: string, status: string, variationID: number, durationSeconds: number,
  title: string, bvhURL: string, studioPreviewURL: string, bvhURLs: assets, exportURLs: assets };
const motion = object({ ...motionFields, variations: array(object(motionFields)) });
const motions = object({ items: array(motion), nextToken: string, hasMore: boolean }, ['items']);
// Persisted/API poses predate the stricter write contract: smoothRoot2d is optional.
// Reuse bounded fields, but do not change the input schema's required properties.
const outputKeyPose = { ...keyPose, required: ['frame', 'localJointRot', 'rootPosition'] };
const outputKeyPoses = { ...array(outputKeyPose), maxItems: 300 };
const timeline = object({ jobID: string, generationType: string, variationNumber: number, outputNumber: number,
  title: string, trimStart: number, trimEnd: number, stitchStartDelay: number, stitchEndDelay: number,
  staticHands: string, appliedMotionEditJobID: string, bvhURL: string, originalBvhURL: string, stitchBvhURL: string,
  keyPoses: outputKeyPoses });
const sceneObject = object({ objectID: string, referenceName: string, timeline: array(timeline) }, ['objectID', 'timeline']);
const scene = object({ sceneID: string, sceneName: string, type: string,
  objects: { type: 'object', additionalProperties: sceneObject } }, ['sceneID', 'objects']);
const edit = object({ jobID: string, status: string, operation: string, prompt: string, userKeyPoseCount: number,
  outputBvhURL: string, thumbnailUrl: string, keyPoses: outputKeyPoses }, ['jobID', 'status']);
const exportsResult = object({ exports: array(object({ exportID: string, objectID: string, objectReferenceName: string,
  requestedType: string, sceneID: string, sceneName: string, status: string })), downloadURL: string }, ['exports']);
const outputs = {
  list_characters: object({ characters: array(object({ jobID: string, characterName: string, uploadStatus: string, extension: string })), nextToken: string }, ['characters']),
  generate_motion: batch, get_batch: batch, list_batch_motions: motions,
  get_character: object({ characterID: string, characterName: string, uploadStatus: string, generatedStatus: string,
    extension: string, estimatedSecondsWaitTime: number, characterFileURL: string, baseFbxURL: string, baseGlbURL: string,
    thumbnailURL: string }, ['characterID']),
  list_scenes: object({ scenes: array(scene), nextToken: string }, ['scenes']), get_scene: scene,
  get_motion: object({ ...motionFields, motionID: string, fbxURL: string, gltfURL: string, cwmsURL: string }),
  search_motions: object({ items: array(object({ motionID: string, title: string, short: string, tags: array(string),
    categoryAndSubcategories: array(string), mp4URL: string, gifURL: string })), total: number, pageSize: number,
    hasMore: boolean, lastSort: array({ oneOf: [number, string] }) }, ['items']),
  list_motions: motions, create_scene: scene,
  list_motion_edits: object({ jobs: array(edit) }, ['jobs']), get_motion_edit: edit,
  save_key_poses: object({ status: { const: 204 } }, ['status']), export_scene: exportsResult, get_scene_exports: exportsResult,
};
const overrides = {
  list_characters: object(pagination),
  generate_motion: object({ prompt: text(2000), characterID: identifier,
    durationSeconds: { type: 'number', minimum: 3, maximum: 8, default: 5 },
    exportType: { type: 'string', enum: ['fbx-blender', 'bvh', 'glb'], default: 'fbx-blender' } }, ['prompt', 'characterID']),
  get_batch: object({ batchID: identifier }, ['batchID']),
  list_batch_motions: object({ batchID: identifier, ...pagination }, ['batchID']),
  // Character retarget downloads can run synchronous model work. Hosted is status/assets only.
  get_motion: object({ motionID: identifier }, ['motionID']),
};
// Bound the permissive legacy scalar schemas for the hosted input boundary.
function bounded(schema, key = '') {
  const { example, ...rest } = schema;
  schema = rest;
  if (schema.oneOf) return { ...schema, oneOf: schema.oneOf.map(child => bounded(child, key)) };
  if (schema.type === 'string' && !schema.enum) return { ...text(key === 'nextToken' ? 4096 : 4000), ...schema,
    maxLength: schema.maxLength ?? (key.endsWith('ID') || key === 'referenceName' ? 256 : 4000) };
  if (schema.type === 'array') return { ...schema, maxItems: schema.maxItems ?? 100, items: bounded(schema.items) };
  if (schema.type === 'object') return { ...schema, properties: Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, bounded(v, k)])) };
  return schema;
}
const securitySchemes = [{ type: 'oauth2', scopes: ['openid', 'profile'] }];
const hostedTools = Object.entries(outputs).map(([name, outputSchema]) => {
  const tool = definitions.find(tool => tool.name === name);
  let inputSchema = overrides[name] ?? bounded(tool.inputSchema);
  if (['list_scenes', 'list_motions'].includes(name)) inputSchema = object({ ...pagination, sortAscending: boolean });
  const writing = !tool.annotations.readOnlyHint;
  const description = name === 'get_motion' ? 'Read motion status and existing asset URLs. Hosted retrieval does not retarget characters or start model processing.' : name === 'generate_motion'
    ? 'Submit one asynchronous Swing motion generation. Consumes existing Cartwheel credits/balance with no separate ChatGPT spending limit. Requires explicit paid consent and a connected key; OIDC scopes alone do not authorize payment. Returns a batch, not completed motion. Never automatically retry: inspect Cartwheel batch history after an uncertain outcome.'
    : tool.description + (writing ? ' Never automatically retry after an uncertain response; inspect scene state or export status first.' : '');
  return { name, description, inputSchema, outputSchema, securitySchemes, _meta: { securitySchemes },
    annotations: { ...tool.annotations, destructiveHint: name === 'generate_motion' || tool.annotations.destructiveHint, openWorldHint: false } };
});
const ajv = new Ajv({ strict: false, validateFormats: false });
const validators = new Map(hostedTools.map(tool => [tool.name, { input: ajv.compile(tool.inputSchema), output: ajv.compile(tool.outputSchema), tool }]));
function validateHostedInput(name, args) {
  return withinJSONLimit({ operation: name, arguments: args }) && validators.get(name)?.input(args) === true;
}
function hostedRequest(name, args) {
  if (!validateHostedInput(name, args)) throw new Error('Invalid connector request');
  let local = { ...args };
  if (name === 'generate_motion') local = {
    prompts: [args.prompt], requestedModel: 'swing', swingProperties: { duration: args.durationSeconds ?? 5, cfgScale: 7.5 }, loop: false,
    exportSettings: { characterID: args.characterID, exportType: args.exportType ?? 'fbx-blender', forward: 'Z', up: 'Y', frameRate: 30,
      frameStepSize: 1, includeMesh: true, moveInPlace: false, handPose: 'relaxed', faceExpression: 'Default' },
  };
  if (['list_characters', 'list_batch_motions', 'list_scenes', 'list_motions'].includes(name)) local.limit ??= 20;
  return toolRequest(name, local);
}
function safeAsset(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'getcartwheel.com' || url.hostname.endsWith('.getcartwheel.com') || url.hostname.endsWith('.amazonaws.com'));
  } catch { return false; }
}
function project(value, schema, field = '') {
  if (schema.type === 'object') {
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
function projectHostedOutput(name, value) {
  const validator = validators.get(name);
  if (!validator) throw new Error('Unsupported operation');
  // Preserve the original backend's pending-motion contract: optional malformed
  // numbers/URLs are omitted, not coerced or allowed to break the entire read.
  const normalizeMotion = (item, nested = false) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid upstream data');
    const result = { ...item };
    for (const field of ['variationID', 'durationSeconds']) {
      if (!Number.isSafeInteger(result[field]) || result[field] < (field === 'variationID' ? 0 : 1)) delete result[field];
    }
    for (const field of ['bvhURL', 'studioPreviewURL', 'fbxURL', 'gltfURL', 'cwmsURL']) {
      if (!safeAsset(result[field])) delete result[field];
    }
    if (!nested && Array.isArray(result.variations)) result.variations = result.variations.map(item => normalizeMotion(item, true));
    return result;
  };
  if (['list_batch_motions', 'list_motions'].includes(name) && Array.isArray(value?.items)) {
    value = { ...value, items: value.items.map(item => normalizeMotion(item)) };
  }
  if (name === 'get_motion') value = normalizeMotion(value);
  const output = project(value, validator.tool.outputSchema);
  if (!withinJSONLimit(output) || !validator.output(output)) throw new Error('Invalid upstream data');
  return output;
}
module.exports = { hostedTools, validateHostedInput, hostedRequest, projectHostedOutput, safeAsset, HOSTED_JSON_LIMIT, withinJSONLimit };
