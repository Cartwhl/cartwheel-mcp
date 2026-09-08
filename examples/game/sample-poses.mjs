#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { AnimationMixer, LoopOnce } from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { inspectBVH } from '../../src/motion-analysis.mjs';

export function samplePoses(text, frames, positionConvention) {
  if (!['offset_relative', 'absolute_local'].includes(positionConvention)) throw Error('Declare --positions offset_relative or absolute_local.');
  const source = inspectBVH(text);
  if (!Array.isArray(frames) || !frames.length || frames.length > 300 || frames.some((f, i) => !Number.isInteger(f) || f < 0 || f >= source.frameCount || (i && f <= frames[i - 1]))) throw Error('Use strictly increasing source frame indices within the BVH.');
  if (source.joints.slice(1).some(j => j.channels.length !== 3)) throw Error('Use the native Y-up scene BVH with one translating root, not an export with armature wrappers.');
  const parsed = new BVHLoader().parse(text), root = parsed.skeleton.bones[0];
  const mixer = new AnimationMixer(root), action = mixer.clipAction(parsed.clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true; action.play();
  const keyPoses = frames.map(frame => {
    mixer.setTime(Math.min(frame * source.frameTime, parsed.clip.duration));
    const localJointRot = parsed.skeleton.bones.map(b => {
      const q = b.quaternion.clone().normalize(); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      const halfSine = Math.hypot(q.x, q.y, q.z), angle = 2 * Math.atan2(halfSine, q.w);
      return halfSine < 1e-8 ? [0, 0, 0] : [q.x, q.y, q.z].map(v => v * angle / halfSine);
    });
    const rootPosition = ['X', 'Y', 'Z'].map((axis, i) => source.rows[frame][source.joints[0].channels.indexOf(`${axis}position`)] + (positionConvention === 'offset_relative' ? source.joints[0].offset[i] : 0));
    return { frame, localJointRot, rootPosition, smoothRoot2d: [rootPosition[0], rootPosition[2]] };
  });
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  return { source: { sha256: createHash('sha256').update(text).digest('hex'), frameCount: source.frameCount, fps: 1 / source.frameTime, positionConvention, jointOrder: parsed.skeleton.bones.map(b => b.name), positions: 'native source BVH units; Y-up required' }, keyPoses };
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string' }, frames: { type: 'string' }, positions: { type: 'string' }, out: { type: 'string' } } });
  if (!values.input || !values.frames || !values.out) throw Error('Usage: node sample-poses.mjs --input scene-source.bvh --frames 24,60 --positions offset_relative --out poses.json');
  const data = samplePoses(await readFile(values.input, 'utf8'), values.frames.split(',').map(Number), values.positions);
  await writeFile(values.out, `${JSON.stringify(data, null, 2)}\n`);
  console.log(JSON.stringify({ out: values.out, frames: data.keyPoses.map(k => k.frame), bonesIncludingEndSites: data.source.jointOrder.length, fps: data.source.fps }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
