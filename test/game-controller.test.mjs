import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MovementController, SignalClock, eventsBetween, gaitProfile, timeAtPhase, orbitIntent } from '../examples/game/controller.mjs';
import { samplePoses } from '../examples/game/sample-poses.mjs';
import { prepareMotion, inspectBVH } from '../src/motion-analysis.mjs';
import { assumptions, fixture } from './fixtures/bvh.mjs';
import { AnimationClip, VectorKeyframeTrack, QuaternionKeyframeTrack, Quaternion, Vector3, Bone, Group, AnimationMixer } from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { cycleClip, centerRootMotion, splitBodyClip } from '../examples/game/playback.mjs';
import { prepareFile } from '../examples/game/prepare-game.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const profile = { distance: 1, offset: 0, period: 1 };
const intent = { x: 1, z: 0, speed: 2, walkSpeed: 1, runSpeed: 2 };
test('blocked motion stops the locomotion clock; diagonal input has no speed boost', () => {
  const c = new MovementController(profile, profile);
  for (let i = 0; i < 150; i++) c.step(1 / 60, intent, .2);
  assert.equal(c.x, .2); assert.equal(c.speed, 0);
  const phase = c.phase; for (let i = 0; i < 30; i++) c.step(1 / 60, intent, .2);
  assert.equal(c.phase, phase);
  const straight = new MovementController(profile, profile), diagonal = new MovementController(profile, profile);
  for (let i = 0; i < 60; i++) { straight.step(1 / 60, intent); diagonal.step(1 / 60, { ...intent, z: 1 }); }
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - straight.x) < 1e-9);
});

test('a frame-rate change preserves traveled distance and approximate phase', () => {
  const final = fps => { const c = new MovementController(profile, profile); for (let i = 0; i < 2 * fps; i++) c.step(1 / fps, intent); return c; };
  assert.ok(Math.abs(final(30).phase - final(120).phase) < .03);
});

test('the run preview maintains running speed after settling onto its orbit', () => {
  const c = new MovementController(profile, profile); c.z = 1.1;
  for (let i = 0; i < 1200; i++) c.step(1 / 60, { ...intent, ...orbitIntent(c.x, c.z) });
  assert.ok(c.speed > 1.95);
  assert.ok(Math.abs(Math.hypot(c.x, c.z - 1.1) - 2) < .15);
});

test('interruption prevents future authored events, fades the held pose, and supports restart', () => {
  const event = { name: 'signal', seconds: 1, source: 'authored' };
  const clock = new SignalClock(2, [event]);
  assert.equal(clock.start(), true); assert.deepEqual(clock.step(.5), []); assert.equal(clock.start(), false);
  clock.interrupt(); assert.deepEqual(clock.step(1), []); assert.ok(clock.weight < .01);
  assert.equal(clock.start(), true); assert.deepEqual(clock.step(1.1), [event]); assert.deepEqual(clock.step(.1), []);
  assert.deepEqual(eventsBetween([event], 1.9, 3.1, 2, true), [event]);
});

test('reviewed gait clocks stay constant across every contact and cycle wrap', () => {
  for (const name of ['walk', 'run']) {
    const m = JSON.parse(readFileSync(new URL(`../examples/game/assets/${name}.motion.json`, import.meta.url), 'utf8'));
    const p = gaitProfile(m);
    for (let i = 0; i < 2400; i++) assert.ok(Math.abs(timeAtPhase(p, (i + 1) / 120) - timeAtPhase(p, i / 120) - p.period / 120) < 1e-12);
    assert.throws(() => gaitProfile({ ...m, playbackCycle: { ...m.playbackCycle, sourceSha256: 'changed' } }), /reviewed cycle/);
    const text = readFileSync(new URL(`../examples/game/assets/${name}.bvh`, import.meta.url), 'utf8');
    const parsed = prepareMotion(text, { units: m.source.units, upAxis: m.source.upAxis, positionConvention: 'offset_relative', rootJoint: 'root', leftFootJoint: 'l_talocrural', rightFootJoint: 'r_talocrural', groundHeight: 0 }).metadata;
    assert.equal(parsed.source.sha256, m.preparation.outputSha256);
    assert.equal(parsed.skeleton.id, m.skeleton.id);
    assert.ok(parsed.rootMotion.referenceSpeedMetersPerSecond > 1);
    assert.ok(m.rootMotion.referenceSpeedMetersPerSecond > 1);
    const bvh = new BVHLoader().parse(text), source = bvh.clip, c = m.playbackCycle;
    const distance = centerRootMotion(source, bvh.skeleton.getBoneByName('root'), c.startFrame / m.timing.fps, c.endFrame / m.timing.fps);
    assert.ok(Math.abs(distance - p.distance) < .0001);
    const clip = cycleClip(source, c, m.timing.fps);
    assert.equal(clip.duration, p.period);
    for (const t of clip.tracks) {
      const size = t.getValueSize(); assert.deepEqual(t.values.slice(0, size), t.values.slice(-size));
      assert.ok(Math.abs(t.times.at(-1) - clip.duration) < 1e-6);
      assert.ok(t.values.every(Number.isFinite));
    }
  }
});

test('cycle preparation measures the reviewed interval after trimming and rejects missing seam context', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cartwheel-cycle-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'source.bvh'); await writeFile(source, fixture({ setup: true }));
  const options = { ...assumptions, setupFrame: 'remove_verified_rest', startFrame: 5, endFrame: 90, rootMotion: 'preserve', reviewedCycle: { startFrame: 4, endFrame: 28, phaseFrame: 16, blendFrames: 3 } };
  const m = await prepareFile(source, options, join(dir, 'prepared'));
  assert.equal(m.timing.sourceFrameOffset, 6); assert.equal(m.timing.frameCount, 85);
  assert.ok(Math.abs(m.playbackCycle.distanceMeters - .8) < 1e-6);
  assert.equal(m.playbackCycle.sourceSha256, m.source.sha256);
  assert.ok(gaitProfile(m).distance > 0);
  await assert.rejects(() => prepareFile(source, { ...options, reviewedCycle: { ...options.reviewedCycle, startFrame: 1 } }, join(dir, 'bad')), /both sides/);
});

test('crowd steering does not chase targets or reverse heading while orbiting', () => {
  const c = new MovementController(profile, profile); c.x = 4.3; c.z = -.8;
  let previous;
  for (let i = 0; i < 3600; i++) {
    const d = c.step(1 / 60, { ...intent, speed: 1.1, ...orbitIntent(c.x, c.z, -.8, 4.3) });
    const yaw = Math.atan2(d.dx, d.dz);
    if (i > 120) { assert.ok(c.speed > 1.09); assert.ok(Math.abs(Math.atan2(Math.sin(yaw - previous), Math.cos(yaw - previous))) * 60 < .3); }
    previous = yaw;
  }
});

test('removing cycle travel preserves hip sway and aligns facing with movement', () => {
  const rotations = Array.from({ length: 5 }, () => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).toArray()).flat();
  const clip = new AnimationClip('walk', 4, [new VectorKeyframeTrack('root.position', [0, 1, 2, 3, 4], [0, 1, 0, 1, 1.1, .1, 2, 1, 0, 3, .9, -.1, 4, 1, 0]), new QuaternionKeyframeTrack('root.quaternion', [0, 1, 2, 3, 4], rotations)]);
  const root = new Bone(); root.name = 'root';
  assert.equal(centerRootMotion(clip, root, 0, 4), 4);
  const positions = clip.tracks[0].values;
  assert.ok(Math.abs(positions[3] + .1) < 1e-6); assert.ok(Math.abs(positions[4] - 1.1) < 1e-6);
  assert.ok(new Quaternion().fromArray(clip.tracks[1].values).angleTo(new Quaternion()) < 1e-6);
});

test('bundled swing-edit gait facing agrees with forward gameplay travel after centering', () => {
  for (const name of ['walk', 'run']) {
    const bvh = new BVHLoader().parse(readFileSync(new URL(`../examples/game/assets/${name}.bvh`, import.meta.url), 'utf8'));
    const metadata = JSON.parse(readFileSync(new URL(`../examples/game/assets/${name}.motion.json`, import.meta.url)));
    const { startFrame, endFrame } = metadata.playbackCycle, fps = metadata.timing.fps;
    centerRootMotion(bvh.clip, bvh.skeleton.getBoneByName('root'), startFrame / fps, endFrame / fps);
    const group = new Group(); group.add(bvh.skeleton.bones[0]);
    const mixer = new AnimationMixer(group), action = mixer.clipAction(bvh.clip);
    action.play(); action.paused = true;
    for (let frame = startFrame; frame <= endFrame; frame++) {
      action.time = frame / fps; mixer.update(0); group.updateMatrixWorld(true);
      const left = group.getObjectByName('l_upleg').getWorldPosition(new Vector3());
      const right = group.getObjectByName('r_upleg').getWorldPosition(new Vector3());
      const facing = left.sub(right).cross(new Vector3(0, 1, 0)).normalize();
      assert.ok(facing.z > .95, `${name}/${frame}: character faces against +Z gameplay travel (${facing.z})`);
    }
  }
});

test('travel centering follows a translated, rotating parent at each animation key', () => {
  const wrapper = new Bone(); wrapper.name = 'wrapper';
  const root = new Bone(); root.name = 'root'; wrapper.add(root);
  const rotations = (name, degrees) => new QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1, 2], degrees.flatMap(d => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), d * Math.PI / 180).toArray()));
  // In world space the root moves along +X with a small sideways sway, facing +X.
  const clip = new AnimationClip('walk', 2, [
    new VectorKeyframeTrack('wrapper.position', [0, 1, 2], [2, 0, 3, 2, 0, 3, 2, 0, 3]),
    rotations('wrapper', [180, 90, 0]),
    new VectorKeyframeTrack('root.position', [0, 1, 2], [2, 1, 3, 2.9, 1.1, -1, 0, 1, -3]),
    rotations('root', [-90, 0, 90]),
  ]);
  const parentTracks = clip.tracks.slice(0, 2).map(t => t.values.slice());
  assert.ok(Math.abs(centerRootMotion(clip, root, 0, 2) - 2) < 1e-6);
  const group = new Group(); group.add(wrapper);
  const mixer = new AnimationMixer(group), action = mixer.clipAction(clip); action.play(); action.paused = true;
  for (const [frame, expected] of [[0, [0, 1, 0]], [1, [-.1, 1.1, 0]], [2, [0, 1, 0]]]) {
    action.time = frame; mixer.update(0); group.updateMatrixWorld(true);
    assert.ok(root.getWorldPosition(new Vector3()).distanceTo(new Vector3(...expected)) < 1e-6);
    assert.ok(new Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new Quaternion())).z > .99999);
  }
  for (let i = 0; i < 2; i++) assert.deepEqual(clip.tracks[i].values, parentTracks[i]);
});

test('the full-weight gesture replaces upper-body motion while legs keep locomotion', () => {
  const root = new Bone(); root.name = 'root'; const arm = new Bone(); arm.name = 'arm'; const leg = new Bone(); leg.name = 'leg'; root.add(arm, leg);
  const track = (name, angle) => { const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle).toArray(); return new QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [...q, ...q]); };
  const base = splitBodyClip(new AnimationClip('base', 1, [track('arm', .6), track('leg', .4)]), new Set(['arm']));
  const gesture = new AnimationClip('signal', 1, [track('arm', 1.2)]), mixer = new AnimationMixer(root);
  mixer.clipAction(base.lower).play(); mixer.clipAction(base.upper).play().setEffectiveWeight(0); mixer.clipAction(gesture).play(); mixer.update(.1);
  assert.ok(Math.abs(arm.quaternion.angleTo(new Quaternion()) - 1.2) < 1e-6);
  assert.ok(Math.abs(leg.quaternion.angleTo(new Quaternion()) - .4) < 1e-6);
});

test('pose snapshots preserve frame cadence and include End Sites in the native bone order', () => {
  const b = inspectBVH(fixture({ rotation: 15 }));
  const hierarchy = b.hierarchy.replace(/(JOINT (?:left|right)\n\{\nOFFSET [^\n]+\n)CHANNELS 6 Xposition Yposition Zposition/g, '$1CHANNELS 3').replace(/(CHANNELS 3 Zrotation Yrotation Xrotation)\n\}/g, '$1\nEnd Site\n{\nOFFSET 0 0 0\n}\n}');
  const rows = b.rows.map(r => [...r.slice(0, 6), ...r.slice(9, 12), ...r.slice(15, 18)]);
  const text = `${hierarchy}\nMOTION\nFrames: ${rows.length}\nFrame Time: ${b.frameTime}\n${rows.map(r => r.join(' ')).join('\n')}\n`;
  const poses = samplePoses(text, [12, 24], 'offset_relative');
  assert.deepEqual(poses.source.jointOrder, ['pelvis', 'left', 'ENDSITE', 'right', 'ENDSITE']);
  assert.equal(poses.keyPoses[0].frame, 12);
  assert.equal(poses.keyPoses[0].localJointRot.length, 5);
  assert.ok(Math.abs(poses.keyPoses[0].localJointRot[1][2] - Math.PI / 12) < 1e-6);
  assert.deepEqual(poses.keyPoses[1].rootPosition, [.8, 1, 0]);
  assert.throws(() => samplePoses(text, [24, 12], 'offset_relative'), /increasing/);
});

test('an absolute-position moving root under a rotated wrapper measures and removes world travel correctly', () => {
  const b = inspectBVH(fixture());
  const hierarchy = `HIERARCHY\nROOT wrapper\n{\nOFFSET 0 0 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\n${b.hierarchy.replace('HIERARCHY\nROOT pelvis\n{\nOFFSET 0 0 0', 'JOINT pelvis\n{\nOFFSET 0 1 0')}\n}`;
  const rows = b.rows.map(r => { const row = [...r]; row[7] -= 1; row[13] -= 1; return [0, 0, 0, 0, 90, 0, ...row]; });
  const text = `${hierarchy}\nMOTION\nFrames: ${rows.length}\nFrame Time: ${b.frameTime}\n${rows.map(r => r.join(' ')).join('\n')}\n`;
  const options = { ...assumptions, positionConvention: 'absolute_local', rootJoint: 'pelvis', rootMotion: 'in_place' };
  const prepared = prepareMotion(text, options);
  assert.deepEqual(prepared.metadata.rootMotion.displacementMetersYUp, [0, 0, -3]);
  assert.equal(prepared.metadata.rootMotion.referenceSpeedMetersPerSecond, 1);
  assert.ok(prepared.metadata.contacts.left.length > 0);
  const second = prepareMotion(prepared.bvh, { ...options, positionConvention: 'offset_relative', rootMotion: 'preserve' }).metadata;
  assert.equal(second.rootMotion.referenceSpeedMetersPerSecond, null);
});
