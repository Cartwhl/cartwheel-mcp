// Only documented public API operations and reviewed constraint shapes belong here.
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = (description, maxLength = 160) => ({ type: 'string', minLength: 1, maxLength, description });
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const array = (items, minItems = 1, maxItems = 300) => ({ type: 'array', items, minItems, maxItems });
const vector = n => array(number(-10000, 10000), n, n);
const frames = array(integer(0, 7199));
const keyPose = object({
  id: string('Optional pose label.'), frame: integer(0, 7199),
  localJointRot: array(vector(3), 1, 256), rootPosition: vector(3), smoothRoot2d: vector(2),
}, ['frame', 'localJointRot', 'rootPosition', 'smoothRoot2d']);
const keyPoses = { ...array(keyPose), description: 'Source-compatible pose snapshots. Zero-based frames at the unresampled scene BVH cadence. localJointRot is axis-angle radians in Three BVHLoader skeleton.bones order INCLUDING End Sites. rootPosition and smoothRoot2d use the scene BVH native position units. Use the bundled sample-poses helper on that exact source, not a game-rig export.' };
const root2d = object({
  type: { const: 'root2d' }, frame_indices: frames,
  smooth_root_2d: array(vector(2)), global_root_heading: array(vector(2)),
}, ['type', 'frame_indices', 'smooth_root_2d']);
const fullbody = object({
  type: { const: 'fullbody' }, frame_indices: frames,
  local_joints_rot: array(array(vector(3), 1, 256)), root_positions: array(vector(3)), smooth_root_2d: array(vector(2)),
}, ['type', 'frame_indices', 'local_joints_rot', 'root_positions', 'smooth_root_2d']);
const editProperties = {
  prompt: string('Creative direction, separate from the constraints.', 4000), duration: number(1, 10),
  sampler: { enum: ['ddim', 'dpm_solver_v3'] }, seed: integer(0, 2147483647),
  constraints: { ...array({ oneOf: [root2d, fullbody] }, 1, 32), description: 'Timed root waypoints use world X/Z meters and optional heading pairs [cos(yaw), sin(yaw)] in the editor coordinate system. Inline fullbody positions are meters, rotations are axis-angle radians in the exact scene BVH bone order. Arrays match increasing frame_indices. Combine root2d and fullbody constraints here; do not also supply keyPoses, which overrides constraints upstream.' },
  keyPoses,
};
const target = {
  sceneID: string('Scene ID from create_scene or list_scenes.'),
  referenceName: string('Exact object reference name returned by get_scene.'),
  timelineIndex: integer(0, 1000),
};
const targetPath = '/scenes/{sceneID}/objects/{referenceName}/{timelineIndex}/motionEdits';
const pathParameters = Object.keys(target).map(name => ({ name, location: 'path' }));
const sampling = { numSamples: integer(1, 32), numSteps: integer(20, 100), overlapSegments: integer(0, 2) };
const trimMode = { enum: ['duration', 'frames'], description: 'duration means seconds; frames means source frame indices.' };
function api(name, method, path, description, properties, required, parameters = [], guidance) {
  return { name, method, path, description, inputSchema: object(properties, required), parameters,
    annotations: { readOnlyHint: method === 'GET', destructiveHint: name === 'apply_motion_edit', idempotentHint: method === 'GET', openWorldHint: true },
    ...(guidance ? { failureGuidance: guidance } : {}) };
}
const editGuidance = 'Do not automatically resubmit. Inspect list_motion_edits for this scene slot; the edit may have been accepted.';

export const gameDefinitions = [
  api('create_scene', 'POST', '/scenes', 'Create a motion scene from accessible motion IDs so its performances can be edited through MCP. Each motion creates an object reference. Inspect the returned objects with get_scene before editing. Submit once.', {
    sceneName: string('Scene name.', 100),
    motions: array(object({ motionID: string('Accessible motion ID.'), variationNumber: integer(0, 100), outputNumber: integer(0, 3), title: string('Optional motion title.') }, ['motionID']), 1, 32),
  }, ['sceneName', 'motions'], [], 'The scene may have been created. Check list_scenes before submitting again.'),
  api('loop_motion', 'POST', '/motion/loop', 'Trim and make an existing motion loop. This runs model processing and creates a new motion; submit once. Returns motionID and a BVH URL when complete. It is separate from the loop option on new generation. Does not guarantee beat alignment.', {
    motionID: string('Completed motion ID.'), trimStart: number(0, 100000), trimEnd: number(0, 100000), trimMode,
    moveInPlace: { type: 'boolean', description: 'Set false when measuring original travel speed and stride distance.' }, ...sampling,
  }, ['motionID'], [], 'Loop processing may have completed. Check list_motions for its result before resubmitting.'),
  api('stitch_motions', 'POST', '/motion/stitch', 'Trim and blend two completed motions in the supplied order. Creates a new motion and returns its motionID/BVH. Submit once; review the transition and contacts before gameplay use.', {
    motionIDs: array(string('Completed motion ID.'), 2, 2),
    motion1TrimStart: number(0, 100000), motion1TrimEnd: number(0, 100000), motion2TrimStart: number(0, 100000), motion2TrimEnd: number(0, 100000),
    blendSettings: object({ trimMode, ...sampling }),
  }, ['motionIDs'], [], 'Stitch processing may have completed. Check list_motions for its result before resubmitting.'),
  api('edit_motion', 'POST', targetPath, 'Submit a Motion Editor regeneration using a prompt, root path, and/or compatible pose constraints. Runs model processing. Returns a jobID; poll get_motion_edit, inspect the output, then explicitly apply_motion_edit if wanted. Constraints target the source editor skeleton, not an arbitrary game rig.', {
    ...target, ...editProperties,
  }, Object.keys(target), pathParameters, editGuidance),
  api('edit_key_poses', 'POST', targetPath.replace('motionEdits', 'keyPoseEdits'), 'Regenerate an existing scene performance around explicit compatible key poses. Consumes credits. Source motion determines duration. Submit once, poll get_motion_edit, and review before apply_motion_edit.', {
    ...target, keyPoses, prompt: editProperties.prompt, sampler: editProperties.sampler, seed: editProperties.seed,
  }, [...Object.keys(target), 'keyPoses'], pathParameters, editGuidance),
  api('list_motion_edits', 'GET', targetPath, 'List the edit history for one scene object timeline slot. Use this to recover a submitted job after an uncertain response.', target, Object.keys(target), pathParameters),
  api('get_motion_edit', 'GET', `${targetPath}/{jobID}`, 'Check an edit job. A completed job returns outputBvhURL and available pose information. Reading status does not regenerate motion or apply it.', {
    ...target, jobID: string('Motion Editor job ID.'),
  }, [...Object.keys(target), 'jobID'], [...pathParameters, { name: 'jobID', location: 'path' }]),
  api('apply_motion_edit', 'POST', `${targetPath}/{jobID}/apply`, 'Apply a reviewed, completed edit to its existing scene timeline slot. Replaces that slot’s motion. The MCP checks that the job belongs to the supplied slot before applying it.', {
    ...target, jobID: string('Completed, reviewed Motion Editor job ID.'),
  }, [...Object.keys(target), 'jobID'], [...pathParameters, { name: 'jobID', location: 'path' }], 'Application may have succeeded. Check get_scene before applying again.'),
  {
    name: 'analyze_motion', handler: 'analyze_motion',
    description: 'Read a motion BVH from Cartwheel and return frame/setup-pose diagnostics, skeleton identity, foot-contact intervals, travel speed, stride measurements, inferred flight events and loop-seam metrics. Does not modify or generate a motion. Analyze traveling motion before removing root travel. Joint mapping, units and ground assumptions must match the export. Use the bundled game preparation helper to apply reviewed trimming and save metadata next to clips.',
    inputSchema: object({
      motionID: string('Accessible motion ID.'), characterID: string('Optional accessible character for a compatible BVH retarget.'), bodyIndex: integer(0, 3),
      fps: { type: 'number', enum: [2, 12, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 120, 144, 240], description: 'Requires characterID. Match the local retarget export cadence when specifying frame trims. Otherwise follows get_motion defaults (60 fps for retargeting).' },
      units: { enum: ['meters', 'centimeters'] }, upAxis: { enum: ['Y', 'Z'] },
      positionConvention: { enum: ['offset_relative', 'absolute_local'], description: 'Declare whether position channels add to OFFSET (standard BVH) or replace it (Cartwheel native retarget exports). The preparation helper normalizes output to offset_relative; do not guess from height alone.' },
      rootJoint: string('Joint whose world travel drives gameplay, usually the hips/pelvis. Defaults to the hierarchy root; select the moving hips when an armature wrapper is above them.'),
      leftFootJoint: string('Exact left ankle/foot joint name.'), rightFootJoint: string('Exact right ankle/foot joint name.'),
      groundHeight: number(-1000, 1000), contactHeight: number(0.001, 1), contactSpeed: number(0.001, 5),
      setupFrame: { enum: ['keep', 'remove_verified_rest'], description: 'Default keep. Remove only when you have identified an extra setup frame; the helper verifies that its non-root rotation channels are at rest. Never inferred automatically.' },
      startFrame: integer(0, 7199), endFrame: integer(1, 7200),
    }, ['motionID', 'units', 'upAxis', 'positionConvention', 'leftFootJoint', 'rightFootJoint', 'groundHeight']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

export function validateGameArguments(name, args) {
  const increasing = values => values.every((n, i) => !i || n > values[i - 1]);
  const trim = (start, end, mode) => {
    if (start !== undefined && end !== undefined && end <= start) throw new Error('Trim end must be greater than trim start.');
    if (mode === 'frames' && [start, end].some(v => v !== undefined && !Number.isInteger(v))) throw new Error('Frame trims must use integer indices.');
  };
  if (name === 'loop_motion') trim(args.trimStart, args.trimEnd, args.trimMode);
  if (name === 'stitch_motions') for (const n of [1, 2]) trim(args[`motion${n}TrimStart`], args[`motion${n}TrimEnd`], args.blendSettings?.trimMode);
  if (name === 'analyze_motion') {
    if (args.bodyIndex > 0 && !args.characterID) throw new Error('bodyIndex requires characterID for per-person retargeting.');
    if (args.fps !== undefined && !args.characterID) throw new Error('fps requires characterID to select a retarget cadence.');
    if (args.leftFootJoint === args.rightFootJoint) throw new Error('Left and right foot joints must be distinct.');
    trim(args.startFrame, args.endFrame, 'frames');
  }
  if (!['edit_motion', 'edit_key_poses'].includes(name)) return;
  if (!args.prompt?.trim() && !args.constraints?.length && !args.keyPoses?.length) throw new Error('Provide a prompt, constraints or key poses.');
  if (args.keyPoses?.length && args.constraints?.length) throw new Error('keyPoses overrides inline constraints upstream. Combine root2d and fullbody in constraints, or submit keyPoses alone.');
  if (args.keyPoses) {
    if (!increasing(args.keyPoses.map(k => k.frame))) throw new Error('Key pose frames must be strictly increasing.');
    if (args.keyPoses.some(k => k.localJointRot.length !== args.keyPoses[0].localJointRot.length)) throw new Error('Key poses must use the same skeleton.');
  }
  for (const c of args.constraints || []) {
    if (!increasing(c.frame_indices)) throw new Error('Constraint frames must be strictly increasing.');
    for (const key of ['smooth_root_2d', 'global_root_heading', 'local_joints_rot', 'root_positions']) {
      if (c[key] && c[key].length !== c.frame_indices.length) throw new Error('Constraint arrays must have one entry per frame.');
    }
    if (c.local_joints_rot?.some(rot => rot.length !== c.local_joints_rot[0].length)) throw new Error('Full-body constraints must use one skeleton.');
    if (c.global_root_heading?.some(([x, z]) => Math.abs(Math.hypot(x, z) - 1) > .01)) throw new Error('Root headings must be unit [cos(yaw), sin(yaw)] pairs.');
  }
}
