import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMotion, inspectBVH } from '../src/motion-analysis.mjs';
import { assumptions, fixture } from './fixtures/bvh.mjs';

test('world contacts, original travel speed, and flight are measured consistently at 24/60fps and in centimeters/Z-up', () => {
  for (const fps of [24, 60]) for (const [units, scale, upAxis] of [['meters', 1, 'Y'], ['centimeters', 100, 'Z']]) {
    const { metadata: m, bvh } = prepareMotion(fixture({ fps, scale, up: upAxis }), { ...assumptions, units, upAxis, rootMotion: 'in_place' });
    assert.ok(Math.abs(m.rootMotion.referenceSpeedMetersPerSecond - 1) < 1e-5);
    assert.equal(m.rootMotion.horizontalPathMeters, 3);
    assert.ok(m.contacts.left[0].endSeconds > 1.9 && m.contacts.left[0].endSeconds < 2.1);
    assert.equal(m.flightCandidates.length, 1);
    assert.ok(m.flightCandidates[0].startSeconds > 2 && m.flightCandidates[0].endSeconds < 2.35);
    assert.equal(inspectBVH(bvh).rows.at(-1)[0], 0);
    assert.ok(m.events.every(e => e.source === 'kinematic_heuristic'));
  }
});

test('setup frames are preserved by default, verified before removal, and source events follow trimming exactly once', () => {
  const text = fixture({ setup: true, rotation: 15 });
  assert.equal(prepareMotion(text, assumptions).metadata.timing.frameCount, 92);
  const { metadata: m } = prepareMotion(text, { ...assumptions, setupFrame: 'remove_verified_rest', startFrame: 3, endFrame: 20,
    authoredEvents: [{ name: 'impact', frame: 7 }, { name: 'discarded', frame: 2 }] });
  assert.equal(m.timing.sourceFrameOffset, 4);
  assert.equal(m.timing.frameCount, 17);
  assert.deepEqual(m.events.find(e => e.name === 'impact'), { name: 'impact', frame: 3, seconds: .1, source: 'authored' });
  assert.equal(m.preparation.droppedAuthoredEvents, 1);
  assert.throws(() => prepareMotion(fixture({ rotation: 15 }), { ...assumptions, setupFrame: 'remove_verified_rest' }), /Refusing to remove/);
});

test('malformed BVH, ambiguous feet and invalid trim ranges fail before Three parses the input', () => {
  const text = fixture();
  for (const bad of [text.replace('Frames: 91', 'Frames: 900000'), text.replace('OFFSET 0 0 0', 'OFFSET NaN 0 0'), text.replace('JOINT right', 'JOINT left'), text.replace('Zrotation', 'Wrotation'), text.slice(0, -20)]) assert.throws(() => inspectBVH(bad));
  for (const override of [{ leftFootJoint: 'missing' }, { rightFootJoint: 'left' }, { endFrame: 200 }, { startFrame: 1.5 }, { endFrame: 1 }]) assert.throws(() => prepareMotion(text, { ...assumptions, ...override }));
});

test('skeleton identity is normalized across units and measured seams are not loop certification', () => {
  const a = prepareMotion(fixture(), assumptions).metadata;
  const b = prepareMotion(fixture({ scale: 100 }), { ...assumptions, units: 'centimeters' }).metadata;
  assert.equal(a.skeleton.id, b.skeleton.id);
  assert.equal(a.loopSeam.maximumJointAngleDegrees, 0);
  assert.equal(a.loopSeam.rootTranslationWrapMeters, 3);
  assert.match(a.loopSeam.note, /do not certify/);
});

test('real bundled Cartwheel animation produces finite diagnostics without changing its setup frame', () => {
  const text = readFileSync(new URL('../examples/blender/assets/showcase_0.bvh', import.meta.url), 'utf8');
  const { metadata: m } = prepareMotion(text, { ...assumptions, leftFootJoint: 'left_ankle', rightFootJoint: 'right_ankle' });
  assert.equal(m.source.frameCount, m.timing.frameCount);
  assert.ok(Number.isFinite(m.loopSeam.maximumJointAngleDegrees));
  assert.ok(m.skeleton.jointCount > 20);
});
