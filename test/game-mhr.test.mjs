import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Euler, Quaternion } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { bindMHRCorrectives, readMHRCorrectives } from '../examples/game/mhr-rig.mjs';

test('MHR knees match independent released-model reference poses and clones keep separate deformation buffers', async () => {
  const bytes = readFileSync(new URL('../examples/game/assets/character.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const recipe = readMHRCorrectives(JSON.parse(readFileSync(new URL('../examples/game/assets/mhr-correctives.json', import.meta.url))));
  const golden = JSON.parse(readFileSync(new URL('fixtures/mhr-knees.json', import.meta.url)));
  const a = clone(gltf.scene), b = clone(gltf.scene), updateA = bindMHRCorrectives(a, recipe), updateB = bindMHRCorrectives(b, recipe);
  const surface = root => { let found; root.traverse(o => { if (o.isSkinnedMesh) found ??= o.geometry.attributes.position.array; }); return found; };
  const base = surface(gltf.scene), restB = surface(b).slice();
  for (const { vertex, position } of golden.identitySamples) for (let k = 0; k < 3; k++) assert.ok(Math.abs(base[vertex * 3 + k] - position[k]) < 1e-6, `native identity ${vertex}/${k}`);
  assert.ok(Math.max(...updateA()) < 1e-5); updateB();
  for (const entry of golden.cases) {
    for (const bone of recipe.bones) a.getObjectByName(bone.name).quaternion.fromArray(bone.rest);
    for (const [name, angles] of Object.entries(entry.rotationsXYZ)) a.getObjectByName(name).quaternion.multiply(new Quaternion().setFromEuler(new Euler(...angles, 'XYZ')));
    const weights = updateA(), positions = surface(a);
    assert.ok(Math.abs(Math.max(...weights) - entry.maximumActivation) < 2e-5);
    for (const { vertex, delta } of entry.samples) for (let k = 0; k < 3; k++) assert.ok(Math.abs(positions[vertex * 3 + k] - base[vertex * 3 + k] - delta[k]) < 2e-6, `${vertex}/${k}`);
    assert.deepEqual(surface(b), restB);
  }
});
