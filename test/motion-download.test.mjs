import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadMotionBVH } from '../src/motion-download.mjs';
import { MAX_BVH_BYTES } from '../src/motion-analysis.mjs';
const url = 'https://cartwheel-mogen-resources.s3.us-east-1.amazonaws.com/motion.bvh';

test('oversized advertised downloads cancel their body without parsing it', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(downloadMotionBVH(url, { signal: AbortSignal.timeout(1000), fetchImpl: async () => new Response(body, { headers: { 'content-length': String(MAX_BVH_BYTES + 1) } }) }), /24 MiB/);
  assert.equal(cancelled, true);
});

test('the streaming limit still applies when a server advertises a false small length', async () => {
  let cancelled = false;
  const chunk = new Uint8Array(13 * 1024 * 1024);
  const body = new ReadableStream({ pull(controller) { controller.enqueue(chunk); }, cancel() { cancelled = true; } });
  await assert.rejects(downloadMotionBVH(url, { signal: AbortSignal.timeout(1000), fetchImpl: async () => new Response(body, { headers: { 'content-length': '12' } }) }), /24 MiB/);
  assert.equal(cancelled, true);
});
