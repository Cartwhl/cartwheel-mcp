// Reviewed swing-edit constraint wire formats. No worker URLs or arbitrary JSON payloads.
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const array = (items, minItems = 1, maxItems = 300) => ({ type: 'array', items, minItems, maxItems });
const vector = n => array(number(-10000, 10000), n, n);
const frameIndices = array(integer(0, 7199));
const rotations = array(array(vector(3), 1, 256));
const poseProperties = { frame_indices: frameIndices, local_joints_rot: rotations, root_positions: array(vector(3)), smooth_root_2d: array(vector(2)) };

export const keyPose = object({
  id: { type: 'string', minLength: 1, maxLength: 160 }, frame: integer(0, 7199),
  localJointRot: array(vector(3), 1, 256), rootPosition: vector(3), smoothRoot2d: vector(2), pathProgress: number(0, 1),
}, ['frame', 'localJointRot', 'rootPosition', 'smoothRoot2d']);
export const keyPoses = { ...array(keyPose), description: 'swing-edit pose snapshots at zero-based frames of the exact scene BVH. localJointRot is axis-angle radians in Three BVHLoader bone order INCLUDING End Sites. Positions use native scene BVH units. pathProgress optionally locates a repath pose by normalized arc length. Use sample-poses.mjs; do not use a separately exported game rig.' };

const root2d = object({ type: { const: 'root2d' }, frame_indices: frameIndices, smooth_root_2d: array(vector(2)), global_root_heading: array(vector(2)) }, ['type', 'frame_indices', 'smooth_root_2d']);
const fullbody = object({ type: { const: 'fullbody' }, ...poseProperties }, ['type', 'frame_indices', 'local_joints_rot', 'root_positions']);
const effectors = ['left-hand', 'right-hand', 'left-foot', 'right-foot'].map(type => object({ type: { const: type }, ...poseProperties }, ['type', 'frame_indices', 'local_joints_rot', 'root_positions']));
const endEffector = object({ type: { const: 'end-effector' }, ...poseProperties, joint_names: { ...array({ enum: ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Hips'] }, 1, 5), uniqueItems: true } }, ['type', 'frame_indices', 'local_joints_rot', 'root_positions', 'joint_names']);
const primitive = { oneOf: [root2d, fullbody, ...effectors, endEffector] };
const point = object({ id: { type: 'string', minLength: 1, maxLength: 160 }, u: number(0, 1), x: number(-10000, 10000), z: number(-10000, 10000), holdFrames: integer(0, 7199), inHandle: vector(2), outHandle: vector(2) }, ['u', 'x', 'z']);
const repath = object({
  type: { const: 'twoPassRepath' }, strategy: { const: 'builtIn' }, recoveryMode: { const: 'strong' },
  repathCurve: object({
    durationSec: number(1, 10), sourceFrameCount: integer(2, 7200), headingMode: { enum: ['tangent', 'original'] },
    sourceHeadings: array(object({ u: number(0, 1), heading: number(-10000, 10000) }, ['u', 'heading']), 0, 7200),
    points: array(point, 2, 300),
  }, ['durationSec', 'sourceFrameCount', 'headingMode', 'points']),
  trailingConstraints: array({ oneOf: [fullbody, ...effectors, endEffector] }, 0, 32),
  preserveMotionDetail: { type: 'boolean' },
}, ['type', 'strategy', 'recoveryMode', 'repathCurve']);
export const constraints = {
  ...array({ oneOf: [...primitive.oneOf, repath] }, 1, 32),
  description: 'swing-edit root2d, fullbody, hand/foot or selected end-effector controls; or one builtIn twoPassRepath curve envelope. Inline positions are world meters, rotations axis-angle radians. Fullbody supports scene-source bone order; hand/foot/end-effector rotations REQUIRE swing-edit SOMA-30 or SOMA-77 order (no MHR/Axel name remap). Frames use original scene cadence. See cartwheel://workflows/swing-edit for contracts and curve handles.',
};

const increasing = values => values.every((v, i) => !i || v > values[i - 1]);
export function validateSwingEditArguments(args, { allowEmptyPoses = false } = {}) {
  if (!allowEmptyPoses && !args.prompt?.trim() && !args.constraints?.length && !args.keyPoses?.length) throw Error('Provide a prompt, constraints or key poses.');
  const curves = (args.constraints || []).filter(c => c.type === 'twoPassRepath');
  if (curves.length && args.constraints.length !== 1) throw Error('twoPassRepath must be the sole constraints envelope; place additional pose/effector constraints in trailingConstraints.');
  if (args.keyPoses?.length && args.constraints?.length && !curves.length) throw Error('keyPoses overrides inline constraints upstream. Combine root2d and fullbody in constraints, or use keyPoses with one twoPassRepath envelope.');
  if (args.keyPoses) {
    if (!increasing(args.keyPoses.map(k => k.frame))) throw Error('Key pose frames must be strictly increasing.');
    if (args.keyPoses.some(k => k.localJointRot.length !== args.keyPoses[0].localJointRot.length)) throw Error('Key poses must use the same skeleton.');
  }
  for (const c of args.constraints || []) {
    if (c.type === 'twoPassRepath') {
      const curve = c.repathCurve;
      if (!increasing(curve.points.map(p => p.u)) || curve.points[0].u !== 0 || curve.points.at(-1).u !== 1) throw Error('Repath points must increase from u=0 to u=1.');
      if (args.duration !== undefined && Math.abs(args.duration - curve.durationSec) > 1e-6) throw Error('duration must match repathCurve.durationSec.');
      if (curve.headingMode === 'original' && !curve.sourceHeadings?.length) throw Error('Original heading mode requires sourceHeadings; use tangent to face along the path.');
      if (curve.sourceHeadings && !increasing(curve.sourceHeadings.map(h => h.u))) throw Error('Source heading samples must have increasing u values.');
      if (args.keyPoses?.length && c.trailingConstraints?.some(t => t.type === 'fullbody')) throw Error('Use keyPoses or trailing fullbody stamps, not both.');
      for (const trailing of c.trailingConstraints || []) validatePrimitive(trailing);
    } else validatePrimitive(c);
  }
}

function validatePrimitive(c) {
  if (!increasing(c.frame_indices)) throw Error('Constraint frames must be strictly increasing.');
  for (const key of ['smooth_root_2d', 'global_root_heading', 'local_joints_rot', 'root_positions']) if (c[key] && c[key].length !== c.frame_indices.length) throw Error('Constraint arrays must have one entry per frame.');
  if (c.local_joints_rot?.some(rot => rot.length !== c.local_joints_rot[0].length)) throw Error('Pose constraints must use one skeleton.');
  if (!['fullbody', 'root2d'].includes(c.type) && ![30, 77].includes(c.local_joints_rot[0].length)) throw Error('Hand, foot and end-effector constraints require swing-edit SOMA-30 or SOMA-77 joint order; source MHR/Axel snapshots are not remapped for these types.');
  if (c.global_root_heading?.some(([x, z]) => Math.abs(Math.hypot(x, z) - 1) > .01)) throw Error('Root headings must be unit [cos(yaw), sin(yaw)] pairs.');
}
