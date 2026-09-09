import { keyPose } from './hermes-constraints.mjs';
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const id = description => ({ type: 'string', minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$', description });
const sceneID = id('Scene ID returned by create_scene or list_scenes.');
const referenceName = id('Exact existing object reference from get_scene.');
const references = { type: 'array', items: referenceName, minItems: 1, maxItems: 32, uniqueItems: true };
const axis = { enum: ['X', 'Y', 'Z', '-X', '-Y', '-Z'] };
const exportSettings = object({
  exportType: { enum: ['bvh', 'glb', 'fbx-blender', 'fbx-maya', 'fbx-unreal', 'fbx-roblox'] },
  forward: axis, up: axis,
  frameRate: { enum: [2, 12, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 120, 144, 240] },
  frameStepSize: { type: 'integer', minimum: 1, maximum: 10 },
  includeMesh: { type: 'boolean' }, moveInPlace: { type: 'boolean' },
  handPose: { enum: ['default', 'claw', 'curled', 'fist', 'fist_clenched', 'fist_relaxed', 'gripping', 'love_you', 'open_loose', 'open_tight', 'peace', 'pointing', 'pointing_cool', 'relaxed', 'rock', 'splay', 'thumbs_up'] },
}, ['exportType', 'forward', 'up', 'frameRate', 'frameStepSize']);
function tool(name, method, path, description, properties, required, parameters, destructiveHint = false) {
  return { name, method, path, description, parameters, inputSchema: object(properties, required), annotations: { readOnlyHint: method === 'GET', destructiveHint, idempotentHint: method === 'GET' || name === 'save_key_poses', openWorldHint: true } };
}
const parameter = (name, location = 'path') => ({ name, location });
export const sceneDefinitions = [
  tool('set_scene_character', 'POST', '/scenes/{sceneID}/{referenceName}',
    'Retarget an existing scene object onto an accessible character for Hermes editing and export. Choose the character with list_characters/get_character. The MCP checks the reference exists and skips an already-matching character. Inspect get_scene afterward; submit once. Prefer an isolated review scene.',
    { sceneID, referenceName, objectID: id('Accessible target character ID, for example the MHR ID returned by list_characters.') }, ['sceneID', 'referenceName', 'objectID'], [parameter('sceneID'), parameter('referenceName')], true),
  tool('save_key_poses', 'PUT', '/scenes/{sceneID}/objects/{referenceName}/{timelineIndex}/keyPoses',
    'Save Hermes editor pose state without running generation. Replaces this slot’s complete saved pose list; an empty list clears it. Inspect get_scene to read back the saved state. This does not apply or regenerate animation.',
    { sceneID, referenceName, timelineIndex: { type: 'integer', minimum: 0, maximum: 1000 }, keyPoses: { type: 'array', items: keyPose, minItems: 0, maxItems: 300 } }, ['sceneID', 'referenceName', 'timelineIndex', 'keyPoses'], ['sceneID', 'referenceName', 'timelineIndex'].map(name => parameter(name)), true),
  tool('export_scene', 'POST', '/exports/scenes/{sceneID}',
    'Export the current scene performances, including reviewed and applied Hermes edits, on each scene object’s character. Choose characters before exporting. Runs export processing; submit once, then poll get_scene_exports. An unapplied edit is not included. Keep moveInPlace false while measuring travel.',
    { sceneID, objectReferenceNamesToExport: references, exportSettings }, ['sceneID', 'exportSettings'], [parameter('sceneID')]),
  tool('get_scene_exports', 'GET', '/exports/scenes/{sceneID}',
    'Read latest scene export status and authorized download URLs. Poll after export_scene; does not start another export. Inspect every requested object’s status before downloading. Signed URLs expire and must remain private.',
    { sceneID, objectReferenceNames: references }, ['sceneID'], [parameter('sceneID'), parameter('objectReferenceNames', 'query')]),
];
