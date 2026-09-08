import { createHash } from 'node:crypto';
import { AnimationMixer, LoopOnce, Vector3, Matrix4 } from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

export const MAX_BVH_BYTES = 24 * 1024 * 1024;
export class MotionInputError extends Error {}
const requireInput = (condition, message) => { if (!condition) throw new MotionInputError(message); };
const round = n => Math.round(n * 1e6) / 1e6;
const average = a => a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;
const hash = data => createHash('sha256').update(data).digest('hex');

// Validate the bounded, line-oriented BVH grammar before passing it to Three's
// loader. Rotation orders and forward kinematics remain Three's responsibility.
export function inspectBVH(text) {
  requireInput(typeof text === 'string' && Buffer.byteLength(text) <= MAX_BVH_BYTES, 'BVH exceeds the 24 MiB analysis limit.');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let cursor = 0, channelCount = 0, nodeCount = 0;
  const joints = [], names = new Set();
  const take = () => { requireInput(cursor < lines.length, 'Incomplete BVH.'); return lines[cursor++]; };
  const values = (tokens, count) => tokens.length === count && tokens.every(n => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(n) && Number.isFinite(Number(n)) && Math.abs(Number(n)) <= 1e7);
  function node(parent = null, depth = 0, isRoot = false) {
    requireInput(depth <= 64 && joints.length < 256 && ++nodeCount <= 512, 'BVH hierarchy exceeds the analysis limit.');
    const declaration = take();
    const end = declaration === 'End Site';
    const match = /^(ROOT|JOINT) ([A-Za-z0-9_:-]+)$/.exec(declaration);
    requireInput(end ? !isRoot : match && (isRoot ? match[1] === 'ROOT' : match[1] === 'JOINT'), 'Unsupported BVH joint declaration or name.');
    requireInput(take() === '{', 'BVH joint is missing its opening brace.');
    const offset = take().split(/\s+/);
    requireInput(offset.shift() === 'OFFSET' && values(offset, 3), 'Invalid BVH offset.');
    let joint;
    if (!end) {
      requireInput(match[2].length <= 160 && !names.has(match[2]), 'BVH joint names must be unique and at most 160 characters.');
      names.add(match[2]);
      const channels = take().split(/\s+/);
      const label = channels.shift(), count = Number(channels.shift());
      requireInput(label === 'CHANNELS' && [3, 6].includes(count) && channels.length === count && new Set(channels).size === count && channels.every(c => /^[XYZ](position|rotation)$/.test(c)), 'Unsupported BVH channels.');
      requireInput(['Xrotation', 'Yrotation', 'Zrotation'].every(c => channels.includes(c)), 'BVH joints must include all three rotation channels.');
      joint = { name: match[2], parent, offset: offset.map(Number), channels, channelOffset: channelCount };
      joints.push(joint);
      channelCount += count;
    }
    while (lines[cursor] !== '}') {
      requireInput(!end, 'End Site cannot contain children.');
      node(joint.name, depth + 1);
    }
    take();
  }
  requireInput(take() === 'HIERARCHY', 'Expected a BVH HIERARCHY.');
  node(null, 0, true);
  requireInput(joints[0].channels.length === 6, 'BVH root must include translation channels.');
  const hierarchy = lines.slice(0, cursor).join('\n');
  requireInput(take() === 'MOTION', 'Expected BVH MOTION data.');
  const frameMatch = /^Frames:\s*(\d+)$/.exec(take());
  const timeMatch = /^Frame Time:\s*([\d.eE+-]+)$/.exec(take());
  const frameCount = Number(frameMatch?.[1]), frameTime = Number(timeMatch?.[1]);
  requireInput(frameCount >= 2 && frameCount <= 7200 && frameTime >= 1 / 240 - 1e-7 && frameTime <= .5, 'BVH must have 2–7200 frames at 2–240 fps.');
  requireInput(frameCount * nodeCount <= 500_000, 'BVH exceeds the 500,000 bone-sample analysis limit; use a shorter export.');
  requireInput(lines.length - cursor === frameCount, 'BVH frame count does not match its data.');
  const rows = lines.slice(cursor).map(line => {
    const tokens = line.split(/\s+/);
    requireInput(values(tokens, channelCount), 'BVH frame has invalid or missing channel values.');
    return tokens.map(Number);
  });
  return { hierarchy, joints, rows, frameTime, frameCount, channelCount };
}

function intervals(mask) {
  const ranges = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    const startFrame = i;
    while (i + 1 < mask.length && mask[i + 1]) i++;
    ranges.push({ startFrame, endFrame: i + 1 });
  }
  return ranges;
}
function contactMask(positions, dt, ground, height, speed) {
  let active = false;
  const speeds = positions.map((p, i) => {
    const a = Math.max(0, i - 1), b = Math.min(positions.length - 1, i + 1);
    return positions[a].distanceTo(positions[b]) / ((b - a) * dt);
  });
  const mask = positions.map((p, i) => {
    active = p.y - ground <= height * (active ? 1.35 : 1) && speeds[i] <= speed * (active ? 1.35 : 1);
    return active;
  });
  // Reject contacts shorter than 60 ms; thresholds are time-based at every fps.
  for (const { startFrame, endFrame } of intervals(mask)) {
    if ((endFrame - startFrame) * dt < .06) mask.fill(false, startFrame, endFrame);
  }
  return { mask, speeds };
}

/** Analyze original travel; trim and optionally remove horizontal root travel.
 * Frame selections are AFTER optional setup removal. Authored event frames are
 * source BVH indices and are remapped once, alongside the sample data.
 */
export function prepareMotion(text, options) {
  const {
    units, upAxis, positionConvention, leftFootJoint, rightFootJoint, groundHeight,
    contactHeight = .10, contactSpeed = .25, setupFrame = 'keep',
    startFrame = 0, rootMotion = 'preserve', authoredEvents = [],
  } = options;
  requireInput(['meters', 'centimeters'].includes(units) && ['Y', 'Z'].includes(upAxis), 'Declare source units (meters/centimeters) and upAxis (Y/Z).');
  requireInput(['offset_relative', 'absolute_local'].includes(positionConvention), 'Declare whether position channels add to OFFSET (offset_relative) or replace it (absolute_local).');
  requireInput(Number.isFinite(groundHeight) && Number.isFinite(contactHeight) && contactHeight > 0 && Number.isFinite(contactSpeed) && contactSpeed > 0, 'Declare finite ground height and positive contact thresholds in meters and meters/second.');
  requireInput(['keep', 'remove_verified_rest'].includes(setupFrame) && ['preserve', 'in_place'].includes(rootMotion), 'Unsupported setup-frame or root-motion policy.');
  requireInput(leftFootJoint !== rightFootJoint, 'Left and right foot joints must differ.');
  const source = inspectBVH(text), { joints, frameTime: dt } = source;
  const motionRoot = joints.find(j => j.name === (options.rootJoint ?? joints[0].name));
  requireInput(motionRoot, 'Selected rootJoint is not in the BVH.');
  requireInput(rootMotion !== 'in_place' || motionRoot.channels.length === 6, 'In-place preparation requires translation channels on the selected rootJoint.');
  for (const name of [leftFootJoint, rightFootJoint]) requireInput(joints.some(j => j.name === name), `Foot joint not found. Available joints: ${joints.map(j => j.name).join(', ')}`);
  const scale = units === 'centimeters' ? .01 : 1;
  const metric = v => (upAxis === 'Y' ? v.clone() : new Vector3(v.x, v.z, -v.y)).multiplyScalar(scale);
  const angleFromRest = value => Math.abs(((value % 360) + 540) % 360 - 180);
  const firstFrameAtRest = joints.slice(1).every(j => j.channels.every((c, i) => !c.endsWith('rotation') || angleFromRest(source.rows[0][j.channelOffset + i]) < .001));
  requireInput(setupFrame === 'keep' || firstFrameAtRest, 'Refusing to remove frame 0: its non-root rotations are not at rest. Inspect the clip and use explicit trimming instead.');
  const setupOffset = setupFrame === 'remove_verified_rest' ? 1 : 0;
  const endFrame = options.endFrame ?? source.frameCount - setupOffset;
  requireInput(Number.isInteger(startFrame) && Number.isInteger(endFrame) && startFrame >= 0 && endFrame <= source.frameCount - setupOffset && endFrame - startFrame >= 2, 'Select at least two frames within the clip; endFrame is exclusive after setup removal.');
  const sourceOffset = setupOffset + startFrame;
  const rows = source.rows.slice(sourceOffset, setupOffset + endFrame).map(row => [...row]);
  if (positionConvention === 'absolute_local') for (const row of rows) for (const j of joints) {
    for (const [axis, component] of [['X', 0], ['Y', 1], ['Z', 2]]) {
      const index = j.channels.indexOf(`${axis}position`);
      if (index >= 0) row[j.channelOffset + index] -= j.offset[component];
    }
  }
  const serialize = data => `${source.hierarchy}\nMOTION\nFrames: ${data.length}\nFrame Time: ${dt}\n${data.map(row => row.join(' ')).join('\n')}\n`;
  const parsed = new BVHLoader().parse(serialize(rows));
  const root = parsed.skeleton.bones[0], mixer = new AnimationMixer(root);
  const action = mixer.clipAction(parsed.clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const boneMap = new Map(parsed.skeleton.bones.filter(b => b.name !== 'ENDSITE').map(b => [b.name, b]));
  const left = [], right = [], roots = [], corrections = [], point = new Vector3();
  const rootBone = boneMap.get(motionRoot.name);
  let firstRootWorld;
  let firstRotations;
  for (let i = 0; i < rows.length; i++) {
    // Last key times are float32 in Three; clamp to the actual last key.
    mixer.setTime(Math.min(i * dt, parsed.clip.duration));
    root.updateMatrixWorld(true);
    const rootWorld = rootBone.getWorldPosition(point).clone();
    firstRootWorld ??= rootWorld.clone();
    roots.push(metric(rootWorld));
    const inPlaceWorld = rootWorld.clone();
    inPlaceWorld.x = firstRootWorld.x;
    if (upAxis === 'Y') inPlaceWorld.z = firstRootWorld.z;
    else inPlaceWorld.y = firstRootWorld.y;
    const parentInverse = rootBone.parent ? new Matrix4().copy(rootBone.parent.matrixWorld).invert() : new Matrix4();
    corrections.push(inPlaceWorld.applyMatrix4(parentInverse).sub(rootBone.position));
    left.push(metric(boneMap.get(leftFootJoint).getWorldPosition(point)));
    right.push(metric(boneMap.get(rightFootJoint).getWorldPosition(point)));
    if (!i) firstRotations = joints.map(j => boneMap.get(j.name).quaternion.clone());
  }
  const seamAngles = joints.map((j, i) => ({ joint: j.name, degrees: round(firstRotations[i].angleTo(boneMap.get(j.name).quaternion) * 180 / Math.PI) })).sort((a, b) => b.degrees - a.degrees);
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  const n = rows.length, sampleSpan = (n - 1) * dt;
  const path = [0];
  for (let i = 1; i < n; i++) path.push(path[i - 1] + Math.hypot(roots[i].x - roots[i - 1].x, roots[i].z - roots[i - 1].z));
  const travelSpeed = path.at(-1) / sampleSpan;
  const contacts = {}, masks = {}, events = [];
  for (const [side, positions, joint] of [['left', left, leftFootJoint], ['right', right, rightFootJoint]]) {
    const { mask, speeds } = contactMask(positions, dt, groundHeight, contactHeight, contactSpeed);
    masks[side] = mask;
    contacts[side] = intervals(mask).map(({ startFrame: a, endFrame: b }) => ({
      startFrame: a, endFrame: b, startSeconds: round(a * dt), endSeconds: round(b * dt),
      joint, meanSpeedMetersPerSecond: round(average(speeds.slice(a, b))),
      minimumHeightMeters: round(Math.min(...positions.slice(a, b).map(p => p.y - groundHeight))),
      beginsBeforeClip: a === 0, continuesAfterClip: b === n,
    }));
    for (const c of contacts[side]) if (c.startFrame > 0) events.push({ name: 'foot_contact', foot: side, frame: c.startFrame, seconds: c.startSeconds, source: 'kinematic_heuristic' });
  }
  const flights = intervals(left.map((p, i) => !masks.left[i] && !masks.right[i] && p.y > groundHeight + contactHeight && right[i].y > groundHeight + contactHeight))
    .filter(r => (r.endFrame - r.startFrame) * dt >= .06)
    .map(r => ({ ...r, startSeconds: round(r.startFrame * dt), endSeconds: round(r.endFrame * dt), source: 'kinematic_heuristic' }));
  for (const f of flights) {
    if (f.startFrame > 0) events.push({ name: 'flight_start_candidate', frame: f.startFrame, seconds: f.startSeconds, source: 'kinematic_heuristic' });
    if (f.endFrame < n) events.push({ name: 'flight_end_candidate', frame: f.endFrame, seconds: f.endSeconds, source: 'kinematic_heuristic' });
  }
  requireInput(Array.isArray(authoredEvents) && authoredEvents.length <= 1000, 'authoredEvents must contain at most 1000 events.');
  let droppedAuthoredEvents = 0;
  for (const e of authoredEvents) {
    requireInput(typeof e.name === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(e.name) && Number.isInteger(e.frame) && e.frame >= 0 && e.frame < source.frameCount, 'Authored events need a short name and a valid source frame index.');
    const frame = e.frame - sourceOffset;
    if (frame >= 0 && frame < n) events.push({ name: e.name, frame, seconds: round(frame * dt), source: 'authored' });
    else droppedAuthoredEvents++;
  }
  const strides = {};
  for (const side of ['left', 'right']) {
    const starts = contacts[side].filter(c => !c.beginsBeforeClip).map(c => c.startFrame);
    const opposite = contacts[side === 'left' ? 'right' : 'left'];
    const cycles = starts.slice(1).map((b, i) => {
      const a = starts[i], oppositeStarts = opposite.filter(c => c.startFrame > a && c.startFrame < b).length;
      return { startFrame: a, endFrame: b, seconds: round((b - a) * dt), distanceMeters: round(path[b] - path[a]),
        alternating: oppositeStarts === 1,
        ...((oppositeStarts !== 1) ? { warning: 'Expected one opposite-foot contact start; this may be a split/missed contact or non-alternating motion.' } : {}),
      };
    });
    const alternating = cycles.filter(c => c.alternating);
    strides[side] = { cycles, meanSeconds: average(alternating.map(c => c.seconds)), meanDistanceMeters: travelSpeed > .01 ? average(alternating.map(c => c.distanceMeters)) : null,
      summaryUses: 'Only candidate cycles containing exactly one opposite-foot contact start; still requires visual review.' };
  }
  if (rootMotion === 'in_place') for (let i = 0; i < n; i++) {
    for (const [axis, value] of ['X', 'Y', 'Z'].map((axis, component) => [axis, corrections[i].getComponent(component)])) {
      rows[i][motionRoot.channelOffset + motionRoot.channels.indexOf(`${axis}position`)] += value;
    }
  }
  const identity = joints.map(j => ({ name: j.name, parent: j.parent, offsetMetersYUp: metric(new Vector3(...j.offset)).toArray().map(round) }));
  const delta = roots.at(-1).clone().sub(roots[0]);
  const velocity = i => roots[i + 1].clone().sub(roots[i]).divideScalar(dt);
  const metadata = {
    schemaVersion: 1,
    source: { sha256: hash(text), frameCount: source.frameCount, units, upAxis, positionConvention },
    skeleton: { id: `sha256:${hash(JSON.stringify(identity))}`, rootJoint: joints[0].name, jointCount: joints.length, joints: joints.map(j => j.name), identityIncludes: 'joint names, parents, rest offsets normalized to meters/Y-up' },
    timing: { fps: round(1 / dt), frameCount: n, sampleSpanSeconds: round(sampleSpan), frameSequenceDurationSeconds: round(n * dt), frameIndexing: 'zero-based; endFrame exclusive', sourceFrameOffset: sourceOffset },
    setupFrame: { policy: setupFrame, firstFrameNonRootRotationsAtRest: firstFrameAtRest, removedFrames: setupOffset, verification: 'Non-root rotation channels within 0.001 degrees of rest. Removal requires explicit caller identification of an extra setup frame.' },
    preparation: { startFrame, endFrame, rootMotion, positionConvention: 'offset_relative', droppedAuthoredEvents },
    rootMotion: { rootJoint: motionRoot.name, measuredBeforeInPlaceRemoval: true, displacementMetersYUp: delta.toArray().map(round), horizontalPathMeters: round(path.at(-1)), referenceSpeedMetersPerSecond: travelSpeed > .01 ? round(travelSpeed) : null, measurementSpanSeconds: round(sampleSpan) },
    contacts: { source: 'kinematic_heuristic', method: 'World joint height and 3D speed; 1.35x release hysteresis; 60ms minimum interval.', confidence: 'uncalibrated; inspect visually', assumptions: { leftFootJoint, rightFootJoint, groundHeightMeters: groundHeight, contactHeightMeters: contactHeight, contactSpeedMetersPerSecond: contactSpeed }, ...contacts },
    strides: { source: 'kinematic_heuristic', ...strides }, flightCandidates: flights,
    loopSeam: { source: 'measured_sample_endpoints', maximumJointAngleDegrees: seamAngles[0].degrees, worstJoints: seamAngles.slice(0, 5), rootVelocityMismatchMetersPerSecond: round(velocity(0).distanceTo(velocity(n - 2))), rootTranslationWrapMeters: round(delta.length()), note: 'Traveling root displacement can be intentional. Endpoint metrics do not certify a seamless loop or contacts across the wrap.' },
    events: events.sort((a, b) => a.frame - b.frame),
    warnings: [
      ...(travelSpeed <= .01 ? ['No measurable horizontal travel: reference speed and stride distance are unavailable. In-place clips cannot recover original travel or world-contact speed.'] : []),
      ...(setupFrame === 'keep' && firstFrameAtRest ? ['Frame 0 has rest rotations. It was preserved; explicitly identify an extra setup frame before removing it.'] : []),
      ...(Math.min(...left.map(p => p.y), ...right.map(p => p.y)) < groundHeight - .05 ? ['Foot joint passes more than 5cm below the declared ground; review units, joint choice, floor height and motion.'] : []),
      ...(['left', 'right'].some(side => strides[side].cycles.some(c => !c.alternating)) ? ['Some contact intervals do not form alternating strides. They are excluded from stride averages. Do not drive playback timing directly from inferred contact starts.'] : []),
      'Inferred contacts and flight candidates are not authored impact, damage, recovery or interruption events.',
    ],
  };
  const bvh = serialize(rows);
  metadata.preparation.outputSha256 = hash(bvh);
  return { metadata, bvh };
}
