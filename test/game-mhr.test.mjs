import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnimationMixer, Euler, LoopOnce, Matrix4, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { bindMHRCorrectives, readMHRCorrectives } from '../examples/game/mhr-rig.mjs';
import { createHash } from 'node:crypto';

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

// An unmodified embedded animation is independent of the BVH preparation path.
// Matching exported joint poses does not establish visual quality or contact fidelity.
test('prepared MHR playback preserves untouched animated-export poses', async () => {
  const asset = name => readFileSync(new URL(`../examples/game/assets/${name}`, import.meta.url));
  const bytes = asset('character.glb');
  const model = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
  const baseline = JSON.parse(readFileSync(new URL('fixtures/mhr-export-baseline.json', import.meta.url)));
  for (const motion of baseline.motions) {
    const text = asset(`${motion.name}.bvh`);
    assert.equal(createHash('sha256').update(text).digest('hex'), motion.preparedSha256);
    const metadata = JSON.parse(asset(`${motion.name}.motion.json`));
    assert.equal(metadata.source.provenance.model, 'swing-edit');
    assert.ok(metadata.source.provenance.jobID.startsWith('motion-editor-job-'));
    assert.ok(metadata.source.provenance.handPose);
    const avatar = clone(model), clip = new BVHLoader().parse(text.toString()).clip;
    const mixer = new AnimationMixer(avatar), action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
    for (const pose of motion.poses) {
      mixer.setTime(pose.frame / metadata.timing.fps);
      for (const [name, expected] of Object.entries(pose.joints)) {
        const bone = avatar.getObjectByName(name);
        assert.ok(bone?.isBone, name);
        assert.ok(bone.position.distanceTo(new Vector3(...expected.position)) < 5e-6, `${motion.name}/${pose.frame}/${name}: position differs from unmodified export`);
        // Float32 translation precision depends on the traveling root magnitude.
        // Bound cross-format differences to 5 micrometers and 0.1 degrees;
        // this checks fidelity, not visual approval.
        assert.ok(bone.quaternion.clone().normalize().angleTo(new Quaternion(...expected.rotation)) < Math.PI / 1800, `${motion.name}/${pose.frame}/${name}: rotation differs from unmodified export`);
      }
    }
  }
});
