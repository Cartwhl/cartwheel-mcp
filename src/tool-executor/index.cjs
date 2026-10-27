const Ajv = require('ajv');
const { randomUUID } = require('node:crypto');
const { keyPose } = require('./swing-edit-constraints.cjs');
const { gameDefinitions, validateGameArguments } = require('./game-tools.cjs');
const { sceneDefinitions } = require('./scene-tools.cjs');
const { characterDefinitions, validateCharacterBatchArguments } = require('./character-tools.cjs');
const { boundedInput } = require('./input-contract.cjs');
const { outputSchemas, projectToolOutput, safeAsset, JSON_LIMIT, withinJSONLimit } = require('./output-contract.cjs');
const { ResponseTooLargeError, SceneListTooLargeError } = require('./response-errors.cjs');
const definitions = [...require('./tools.json'), ...gameDefinitions, ...sceneDefinitions, ...characterDefinitions]
  .map(tool => ({ ...tool, inputSchema: boundedInput(tool.inputSchema, tool.name),
    ...(outputSchemas[tool.name] ? { outputSchema: outputSchemas[tool.name] } : {}) }));
const origins = Object.freeze({ staging: 'https://external-mogen-staging.api.getcartwheel.com', production: 'https://external-mogen.api.getcartwheel.com' });
const ajv = new Ajv({ strict: false, strictNumbers: true, validateFormats: false });
const validators = new Map(definitions.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));
class ToolInputError extends Error {
  constructor(message, details) { super(message); this.details = details; }
}
function toolRequest(name, args = {}) {
  if (!withinJSONLimit({ operation: name, arguments: args })) throw new ToolInputError('Invalid tool arguments');
  const tool = definitions.find(item => item.name === name);
  if (!tool) throw new ToolInputError('Unknown Cartwheel tool');
  const validate = validators.get(name);
  if (!validate(args)) throw new ToolInputError('Invalid tool arguments', validate.errors);
  try { validateGameArguments(name, args); validateCharacterBatchArguments(name, args); } catch (error) { throw new ToolInputError(error.message); }
  let path = tool.path;
  const parameters = tool.parameters ?? [];
  for (const param of parameters.filter(p => p.location === 'path')) {
    const value = args[param.name];
    if (!(typeof value === 'string' || Number.isInteger(value)) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(String(value))) throw new ToolInputError(`Invalid ${param.name}`);
    path = path.replace(`{${param.name}}`, encodeURIComponent(value));
  }
  const query = new URLSearchParams();
  for (const param of parameters.filter(p => p.location === 'query')) {
    const value = args[param.name];
    if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) query.append(param.name, String(item));
  }
  return { tool, args, path: path ? `${path}${query.size ? `?${query}` : ''}` : undefined,
    body: Object.fromEntries(Object.entries(args).filter(([key]) => !parameters.some(p => p.name === key))) };
}
const longOperations = new Set(['loop_motion', 'stitch_motions', 'set_scene_character', 'prepare_character_generation', 'submit_character_generation']);
function isProcessingTool(name, args = {}) {
  if (name === 'get_motion') return args.characterID !== undefined;
  return definitions.find(tool => tool.name === name)?.annotations.readOnlyHint === false;
}
// Transport injection is backend-owned, never an input argument. One timeout budget
// covers preflight checks and execution; redirects are forbidden in both transports.
async function executeTool(name, args, { apiKey, environment = 'production', fetchImpl = globalThis.fetch,
  requestJSON, timeoutMs = name === 'get_motion' && isProcessingTool(name, args) ? 35000 : 30000,
  signal, createdByUser, specialHandler } = {}) {
  if (!apiKey?.trim()) throw new Error('CARTWHEEL_API_KEY is required');
  const base = origins[environment];
  if (!base) throw new Error('Explicit staging or production environment required');
  const request = toolRequest(name, args);
  const { tool, path, body } = request;
  const idempotencyKey = name === 'generate_character_batch' ? (args.idempotencyKey ?? randomUUID()) : undefined;
  if (idempotencyKey) delete body.idempotencyKey;
  const limit = longOperations.has(name) ? Math.max(timeoutMs, 240000) : timeoutMs;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, limit);
  const deadline = Date.now() + limit;
  const api = async (path, method = 'GET', body) => {
    if (controller.signal.aborted || Date.now() >= deadline) throw new Error('Request deadline exceeded');
    const url = new URL(path, base);
    if (url.origin !== base || !String(path).startsWith('/') || String(path).startsWith('//')) throw new Error('Invalid API target');
    const writing = ['POST', 'PUT'].includes(method);
    const init = { method, headers: { 'x-api-key': apiKey, Accept: 'application/json', ...(writing ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      ...(writing ? { body: JSON.stringify({ ...(body ?? {}), ...(createdByUser ? { createdByUser } : {}) }) } : {}), redirect: 'error', signal: controller.signal };
    if (requestJSON) return requestJSON(url.href, init, Math.max(1, deadline - Date.now()));
    const response = await fetchImpl(url, init);
    if (!response.ok) {
      const error = new Error('Cartwheel API request failed');
      error.status = response.status;
      if (response.status === 429) error.retryAfter = response.headers.get('retry-after');
      throw error;
    }
    if (response.status === 204) return { status: 204 };
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > JSON_LIMIT) throw new ResponseTooLargeError();
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { void reader.cancel().catch(() => {}); }
  };
  try {
    if (tool.handler) {
      if (!specialHandler) throw new ToolInputError('This tool requires a local handler');
      return await specialHandler(request, { api, signal: controller.signal });
    }
    if (name === 'set_scene_character') {
      const scene = await api(`/scenes/${encodeURIComponent(args.sceneID)}`);
      const target = scene.objects?.[args.referenceName];
      if (!target) throw new ToolInputError('The requested reference does not exist in this scene. No character was changed.');
      if (target.objectID === args.objectID) return scene;
      if (!Array.isArray(target.timeline) || target.timeline.some(item => typeof item.jobID !== 'string' || !item.jobID.trim())) throw new ToolInputError('Scene timeline is incomplete. No character was changed.');
      const fields = ['jobID', 'generationType', 'variationNumber', 'outputNumber', 'title', 'trimStart', 'trimEnd', 'stitchStartDelay', 'stitchEndDelay', 'staticHands', 'appliedMotionEditJobID'];
      const timeline = target.timeline.map(item => Object.fromEntries(fields.filter(key => item[key] !== undefined).map(key => [key, item[key]])));
      return await api(path, tool.method, { objectID: args.objectID, timeline });
    }
    if (['get_motion_edit', 'apply_motion_edit'].includes(name)) {
      const history = await api(path.replace(/\/[^/]+(?:\/apply)?$/, ''));
      const job = history.jobs?.find(j => j.jobID === args.jobID);
      if (!job) throw new ToolInputError('Job was not found in this scene slot’s accessible edit history. No job was applied.');
      if (name === 'apply_motion_edit' && job.status !== 'COMPLETED') throw new ToolInputError('Only a completed edit can be applied.');
    }
    const response = await api(path, tool.method, body);
    if (name === 'get_character' && response.characterID !== args.characterID) throw new ToolInputError('The API did not return the requested character. No replacement character was accepted. Check the character ID and project access.');
    const output = projectToolOutput(name, response, [apiKey]);
    return idempotencyKey ? { ...output, idempotencyKey } : output;
  } catch (error) {
    if (name === 'list_scenes' && error instanceof ResponseTooLargeError) throw new SceneListTooLargeError(args);
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
module.exports = { ...require('./video-import.cjs'), definitions, origins, ToolInputError, toolRequest, executeTool, keyPose,
  isProcessingTool, projectToolOutput, safeAsset, JSON_LIMIT, withinJSONLimit, ResponseTooLargeError, SceneListTooLargeError };
