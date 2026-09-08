import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnimationMixer, Euler, LoopOnce, Matrix4, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { bindMHRCorrectives, readMHRCorrectives } from '../examples/game/mhr-rig.mjs';
import { remapJointFrames } from '../examples/game/rest-pose.mjs';

test('MHR full-body deformation matches official dense model poses and clones keep separate buffers', async () => {
  const bytes = readFileSync(new URL('../examples/game/assets/character.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const recipe = readMHRCorrectives(JSON.parse(readFileSync(new URL('../examples/game/assets/mhr-correctives.json', import.meta.url))));
  const golden = JSON.parse(readFileSync(new URL('fixtures/mhr-poses.json', import.meta.url)));
  const a = clone(gltf.scene), b = clone(gltf.scene), updateA = bindMHRCorrectives(a, recipe), updateB = bindMHRCorrectives(b, recipe);
  const surface = root => { let found; root.traverse(o => { if (o.isSkinnedMesh) found ??= o.geometry.attributes.position.array; }); return found; };
  const base = surface(gltf.scene), restB = surface(b).slice();
  for (const { vertex, position } of golden.identitySamples) for (let k = 0; k < 3; k++) assert.ok(Math.abs(base[vertex * 3 + k] - position[k]) < 1e-6, `native identity ${vertex}/${k}`);
  // Check actual skinning, not just unskinned positions or matching bone names.
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    for (let i = 0; i < mesh.skeleton.bones.length; i++) {
      const matrix = new Matrix4().multiplyMatrices(mesh.skeleton.bones[i].matrixWorld, mesh.skeleton.boneInverses[i]);
      assert.ok(Math.max(...matrix.elements.map((v, k) => Math.abs(v - (k % 5 === 0 ? 1 : 0)))) < 1e-5, `inverse bind: ${mesh.skeleton.bones[i].name}`);
    }
    for (const { vertex, position } of golden.identitySamples) assert.ok(mesh.getVertexPosition(vertex, new Vector3()).distanceTo(new Vector3(...position)) < 1e-5, `rest skin ${vertex}`);
  });
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

test('MHR shoulder frames follow source anatomy in real clips while arm rotations and lower body remain intact', async () => {
  const asset = name => readFileSync(new URL(`../examples/game/assets/${name}`, import.meta.url));
  const bytes = asset('character.glb');
  const model = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
  const reference = JSON.parse(asset('swing-mhr-reference.json'));
  const golden = JSON.parse(readFileSync(new URL('fixtures/mhr-shoulders.json', import.meta.url)));
  let largestDirectionError = 0;
  for (const name of ['idle', 'walk', 'run', 'signal']) {
    const raw = new BVHLoader().parse(asset(`${name}.bvh`).toString()).clip;
    const fixed = raw.clone();
    remapJointFrames(fixed, model, reference.joints);
    for (const track of raw.tracks) if (!/^[lr]_(clavicle|uparm)\.quaternion$/.test(track.name)) assert.deepEqual(fixed.tracks.find(t => t.name === track.name).values, track.values);
    const avatars = [clone(model), clone(model)];
    const mixers = [raw, fixed].map((clip, i) => {
      const mixer = new AnimationMixer(avatars[i]), action = mixer.clipAction(clip);
      action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play(); return mixer;
    });
    for (const pose of golden.cases.filter(c => c.clip === name)) {
      mixers.forEach(m => m.setTime(pose.frame * .033333)); avatars.forEach(a => a.updateMatrixWorld(true));
      for (const side of ['l', 'r']) {
        const position = (a, n) => a.getObjectByName(n).getWorldPosition(new Vector3());
        const direction = position(avatars[1], `${side}_uparm`).sub(position(avatars[1], `${side}_clavicle`)).normalize();
        const error = direction.angleTo(new Vector3(...pose.directions[side]));
        largestDirectionError = Math.max(largestDirectionError, error);
        assert.ok(error < Math.PI / 180, `${name}/${pose.frame}/${side}: shoulder direction error ${error * 180 / Math.PI} degrees`);
        for (const joint of ['uparm', 'lowarm', 'wrist', 'uparm_twist0_proc', 'lowleg', 'talocrural']) {
          const rotations = avatars.map(a => a.getObjectByName(`${side}_${joint}`).getWorldQuaternion(new Quaternion()).normalize());
          assert.ok(rotations[0].angleTo(rotations[1]) < 1e-5, `world arm/leg orientation: ${joint}`);
        }
        for (const joint of ['upleg', 'lowleg', 'talocrural']) assert.ok(position(avatars[0], `${side}_${joint}`).distanceTo(position(avatars[1], `${side}_${joint}`)) < 1e-6);
      }
    }
  }
  assert.ok(largestDirectionError < Math.PI / 180);
  const invalid = clone(model); invalid.getObjectByName('l_clavicle').quaternion.identity();
  const clip = new BVHLoader().parse(asset('idle.bvh').toString()).clip;
  assert.throws(() => remapJointFrames(clip, invalid, reference.joints), /Rest-frame contract changed/);
});
