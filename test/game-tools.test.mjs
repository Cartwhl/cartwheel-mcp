import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.mjs';
import { assumptions, fixture } from './fixtures/bvh.mjs';
const slot = { sceneID: 'scene-test', referenceName: 'character', timelineIndex: 0 };
const unpack = r => JSON.parse(r.content[0].text);
async function connect(t, fetchImpl) {
  const server = createServer({ apiKey: 'private-test-key', fetchImpl });
  const client = new Client({ name: 'game-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test('scene creation and modern path editing send only body fields to the exact public route', async t => {
  const calls = [];
  const client = await connect(t, async (url, options) => { calls.push({ url, options }); return Response.json({ jobID: 'edit-1' }); });
  await client.callTool({ name: 'create_scene', arguments: { sceneName: 'Game', motions: [{ motionID: 'motion-1' }] } });
  const constraints = [{ type: 'root2d', frame_indices: [0, 59], smooth_root_2d: [[0, 0], [1, 2]], global_root_heading: [[1, 0], [0, 1]] }];
  const response = await client.callTool({ name: 'edit_motion', arguments: { ...slot, prompt: 'Walk confidently', duration: 3, constraints } });
  assert.equal(response.isError, false);
  assert.equal(calls[0].url.pathname, '/scenes');
  assert.equal(calls[1].url.pathname, '/scenes/scene-test/objects/character/0/motionEdits');
  assert.deepEqual(JSON.parse(calls[1].options.body), { prompt: 'Walk confidently', duration: 3, constraints });
});

test('invalid editor constraints and hidden nested fields never reach a service', async t => {
  const client = await connect(t, async () => assert.fail('No request expected'));
  const base = { ...slot, prompt: 'Walk' };
  for (const args of [{ ...slot }, { ...base, timelineIndex: -1 }, { ...base, referenceName: '../other' }, { ...base, callbackURL: 'https://bad.example' },
    { ...base, constraints: [{ type: 'root2d', frame_indices: [0, 5], smooth_root_2d: [[0, 0]], global_root_heading: [[1, 0], [1, 0]] }] },
    { ...base, constraints: [{ type: 'root2d', frame_indices: [5, 0], smooth_root_2d: [[0, 0], [0, 0]], global_root_heading: [[1, 0], [1, 0]] }] },
    { ...base, keyPoses: [{ frame: 0, localJointRot: [[0, 0, 0]], rootPosition: [0, 1, 0], callbackURL: 'https://bad.example' }] },
  ]) assert.equal((await client.callTool({ name: 'edit_motion', arguments: args })).isError, true);
  assert.equal((await client.callTool({ name: 'loop_motion', arguments: { motionID: 'm', trimMode: 'frames', trimStart: 1.1 } })).isError, true);
  assert.equal((await client.callTool({ name: 'stitch_motions', arguments: { motionIDs: ['m'] } })).isError, true);
});

test('jobs are checked against their scene slot before reading or applying; unfinished jobs cannot apply', async t => {
  const calls = [];
  let jobs = [{ jobID: 'edit-1', status: 'GENERATING' }];
  const client = await connect(t, async (url, options) => { calls.push([url.pathname, options.method]); return Response.json(url.pathname.endsWith('/motionEdits') ? { jobs } : { applied: true }); });
  assert.equal((await client.callTool({ name: 'get_motion_edit', arguments: { ...slot, jobID: 'other-slot' } })).isError, true);
  assert.equal((await client.callTool({ name: 'apply_motion_edit', arguments: { ...slot, jobID: 'edit-1' } })).isError, true);
  assert.ok(calls.every(([path, method]) => path.endsWith('/motionEdits') && method === 'GET'));
  jobs = [{ jobID: 'edit-1', status: 'COMPLETED' }];
  assert.equal((await client.callTool({ name: 'apply_motion_edit', arguments: { ...slot, jobID: 'edit-1' } })).isError, false);
  assert.deepEqual(calls.at(-1), ['/scenes/scene-test/objects/character/0/motionEdits/edit-1/apply', 'POST']);
});

test('loop and stitch failures remain uncertain and never automatically resubmit', async t => {
  let count = 0;
  const client = await connect(t, async () => { count++; throw Error('private-test-key signed-url'); });
  for (const [name, args] of [['loop_motion', { motionID: 'm' }], ['stitch_motions', { motionIDs: ['a', 'b'] }]]) {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, true); assert.match(unpack(r).guidance, /before resubmitting/); assert.doesNotMatch(JSON.stringify(r), /private-test-key|signed-url/);
  }
  assert.equal(count, 2);
});

test('MCP analysis fetches a fresh authorized BVH, sends no key to storage, and returns useful metadata', async t => {
  const calls = [];
  const client = await connect(t, async (url, options) => {
    calls.push({ url, options });
    return url.hostname.startsWith('external-mogen.') ? Response.json({ bvhURL: 'https://cartwheel-mogen-resources.s3.us-east-1.amazonaws.com/motion.bvh?signature=private' }) : new Response(fixture());
  });
  const r = await client.callTool({ name: 'analyze_motion', arguments: { motionID: 'm', characterID: 'char-test', fps: 30, ...assumptions } });
  assert.equal(r.isError, false);
  assert.equal(unpack(r).rootMotion.referenceSpeedMetersPerSecond, 1);
  assert.equal(calls[0].options.headers['x-api-key'], 'private-test-key');
  assert.equal(calls[0].url.searchParams.get('fps'), '30');
  assert.equal(calls[0].url.searchParams.get('characterID'), 'char-test');
  assert.equal(calls[1].options.headers['x-api-key'], undefined);
  assert.equal(calls[1].options.redirect, 'error');
  assert.doesNotMatch(JSON.stringify(r), /signature=|private-test-key/);
});

test('analysis never fetches arbitrary asset hosts or discloses credentials', async t => {
  let asset = 'http://127.0.0.1/private', count = 0;
  const client = await connect(t, async () => { count++; return Response.json({ bvhURL: asset }); });
  for (const url of ['http://127.0.0.1/private', 'https://attacker.example/a.bvh', 'https://cartwheel-mogen-resources.s3.us-east-1.amazonaws.com.attacker.example/a.bvh', 'https://cartwheel-mogen-resources.s3.us-east-1.amazonaws.com:444/a.bvh']) {
    asset = url;
    assert.equal((await client.callTool({ name: 'analyze_motion', arguments: { motionID: 'm', ...assumptions } })).isError, true);
  }
  assert.equal(count, 4);
});
