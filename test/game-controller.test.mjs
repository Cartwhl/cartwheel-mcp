import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MovementController, SignalClock, eventsBetween, gaitProfile, timeAtPhase, orbitIntent } from '../examples/game/controller.mjs';
import { samplePoses } from '../examples/game/sample-poses.mjs';
import { prepareMotion, inspectBVH } from '../src/motion-analysis.mjs';
import { assumptions, fixture } from './fixtures/bvh.mjs';

const profile = { distance: 1, starts: [0, 1], period: 2 };
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

test('bundled gait metadata aligns both clips on left contact and hashes their prepared BVHs', () => {
  for (const name of ['walk', 'run']) {
    const m = JSON.parse(readFileSync(new URL(`../examples/game/assets/${name}.motion.json`, import.meta.url), 'utf8'));
    const p = gaitProfile(m);
    assert.equal(timeAtPhase(p, 0), m.contacts.left.find(c => !c.beginsBeforeClip).startSeconds);
    assert.ok(timeAtPhase(p, p.starts.length) > p.period);
    const text = readFileSync(new URL(`../examples/game/assets/${name}.bvh`, import.meta.url), 'utf8');
    const parsed = prepareMotion(text, { units: m.source.units, upAxis: m.source.upAxis, positionConvention: 'offset_relative', leftFootJoint: 'left_ankle', rightFootJoint: 'right_ankle', groundHeight: 0 }).metadata;
    assert.equal(parsed.source.sha256, m.preparation.outputSha256);
    assert.equal(parsed.skeleton.id, m.skeleton.id);
    assert.equal(parsed.rootMotion.referenceSpeedMetersPerSecond, null);
    assert.ok(m.rootMotion.referenceSpeedMetersPerSecond > 1);
  }
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
