import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.mjs';
const slot = { sceneID: 'scene-test', referenceName: 'character', timelineIndex: 0 };
const pose = count => ({ frame_indices: [0, 30], local_joints_rot: [Array.from({ length: count }, () => [0, 0, 0]), Array.from({ length: count }, () => [0, 0, 0])], root_positions: [[0, 1, 0], [0, 1, 1]] });
const keyPose = { frame: 0, localJointRot: [[0, 0, 0]], rootPosition: [0, 1, 0], smoothRoot2d: [0, 0] };
const curve = () => ({ type: 'twoPassRepath', strategy: 'builtIn', recoveryMode: 'strong', repathCurve: { durationSec: 5, sourceFrameCount: 150, headingMode: 'tangent', points: [{ u: 0, x: 0, z: 0, outHandle: [0, 1] }, { u: 1, x: 1, z: 3, inHandle: [0, 3], holdFrames: 10 }] } });
async function connect(t, fetchImpl) {
  const server = createServer({ apiKey: 'secret-hermes-test', fetchImpl });
  const client = new Client({ name: 'hermes-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test('Hermes text-only generation preserves the prompt and seed without adding source anchors', async t => {
  let request;
  const client = await connect(t, async (url, options) => { request = { url, options }; return Response.json({ jobID: 'edit-one' }); });
  const result = await client.callTool({ name: 'edit_motion', arguments: { ...slot, prompt: 'A person doing a calm walk.', duration: 6, seed: 42 } });
  assert.equal(result.isError, false);
  assert.equal(request.url.pathname, '/scenes/scene-test/objects/character/0/motionEdits');
  assert.deepEqual(JSON.parse(request.options.body), { prompt: 'A person doing a calm walk.', duration: 6, seed: 42 });
});

test('Hermes mixed primitives and built-in repath retain their distinct wire contracts', async t => {
  const bodies = [];
  const client = await connect(t, async (_, options) => { bodies.push(JSON.parse(options.body)); return Response.json({ jobID: 'edit-one' }); });
  const root = { type: 'root2d', frame_indices: [0, 30], smooth_root_2d: [[0, 0], [0, 1]], global_root_heading: [[1, 0], [1, 0]] };
  for (const type of ['left-hand', 'right-hand', 'left-foot', 'right-foot', 'end-effector']) {
    const constraints = [root, { type, ...pose(30), ...(type === 'end-effector' ? { joint_names: ['LeftHand', 'Hips'] } : {}) }];
    assert.equal((await client.callTool({ name: 'edit_motion', arguments: { ...slot, constraints } })).isError, false);
    assert.deepEqual(bodies.at(-1).constraints, constraints);
  }
  const envelope = { ...curve(), trailingConstraints: [{ type: 'fullbody', ...pose(65) }] };
  assert.equal((await client.callTool({ name: 'edit_motion', arguments: { ...slot, duration: 5, constraints: [envelope] } })).isError, false);
  assert.deepEqual(bodies.at(-1).constraints, [envelope]);
  assert.equal((await client.callTool({ name: 'edit_motion', arguments: { ...slot, keyPoses: [keyPose], constraints: [curve()] } })).isError, false);
});

test('malformed, ambiguous and private Hermes controls never reach the API', async t => {
  const client = await connect(t, async () => assert.fail('Invalid input reached API'));
  const args = [
    { constraints: [{ type: 'right-hand', ...pose(127) }] },
    { constraints: [{ type: 'end-effector', ...pose(30), joint_names: ['r_wrist'] }] },
    { constraints: [{ type: 'right-hand', ...pose(30), outputURL: 'https://example.com' }] },
    { constraints: [{ type: 'right-foot', ...pose(30), root_positions: [[0, 1, 0]] }] },
    { constraints: [curve(), { type: 'fullbody', ...pose(30) }] },
    { duration: 6, constraints: [curve()] },
    { constraints: [{ ...curve(), pass1Constraints: [] }] },
    { constraints: [{ ...curve(), repathCurve: { ...curve().repathCurve, headingMode: 'original' } }] },
    { constraints: [{ ...curve(), repathCurve: { ...curve().repathCurve, points: [...curve().repathCurve.points].reverse() } }] },
    { keyPoses: [keyPose], constraints: [{ ...curve(), trailingConstraints: [{ type: 'fullbody', ...pose(30) }] }] },
    { keyPoses: [keyPose], constraints: [{ type: 'fullbody', ...pose(30) }] },
    { prompt: 'Walk', autoSwingAnchors: { frames: [0] } },
  ];
  for (const extra of args) assert.equal((await client.callTool({ name: 'edit_motion', arguments: { ...slot, ...extra } })).isError, true, JSON.stringify(extra));
});

test('saving poses sends PUT and handles the API empty response, including clearing state', async t => {
  const calls = [];
  const client = await connect(t, async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 204 }); });
  for (const keyPoses of [[keyPose], []]) {
    const result = await client.callTool({ name: 'save_key_poses', arguments: { ...slot, keyPoses } });
    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { keyPoses });
    assert.equal(calls.at(-1).options.method, 'PUT');
    assert.equal(calls.at(-1).options.headers['Content-Type'], 'application/json');
  }
});

test('character selection cannot create an accidental scene reference or mutate an already matching one', async t => {
  let objects = {}, posts = 0;
  const timeline = [{ jobID: 'motion-1', trimStart: 0.5, trimEnd: 3.5, appliedMotionEditJobID: 'edit-reviewed' }];
  const client = await connect(t, async (_, options) => { if (options.method === 'POST') { posts++; assert.deepEqual(JSON.parse(options.body), { objectID: 'char-MHR', timeline }); } return Response.json({ objects }); });
  const args = { sceneID: slot.sceneID, referenceName: slot.referenceName, objectID: 'char-MHR' };
  assert.equal((await client.callTool({ name: 'set_scene_character', arguments: args })).isError, true);
  objects = { character: { objectID: 'char-MHR', timeline: timeline.map(item => ({ ...item, s3KeyBvh: 'private-storage-key', bvhURL: 'https://example.com/signed' })) } };
  assert.equal((await client.callTool({ name: 'set_scene_character', arguments: args })).isError, false);
  assert.equal(posts, 0);
  objects.character.objectID = 'char-Axel';
  assert.equal((await client.callTool({ name: 'set_scene_character', arguments: args })).isError, false);
  assert.equal(posts, 1);
});

test('scene export uses explicit settings and polling serializes reference filters without another mutation', async t => {
  const calls = [];
  const client = await connect(t, async (url, options) => { calls.push({ url, options }); return Response.json({ exports: [] }); });
  const exportSettings = { exportType: 'glb', forward: 'Z', up: 'Y', frameRate: 30, frameStepSize: 1, moveInPlace: false, handPose: 'relaxed' };
  assert.equal((await client.callTool({ name: 'export_scene', arguments: { sceneID: slot.sceneID, objectReferenceNamesToExport: ['character'], exportSettings } })).isError, false);
  assert.deepEqual(JSON.parse(calls[0].options.body), { objectReferenceNamesToExport: ['character'], exportSettings });
  assert.equal((await client.callTool({ name: 'get_scene_exports', arguments: { sceneID: slot.sceneID, objectReferenceNames: ['character', 'character2'] } })).isError, false);
  assert.equal(calls[1].options.method, 'GET');
  assert.deepEqual(calls[1].url.searchParams.getAll('objectReferenceNames'), ['character', 'character2']);
  assert.equal((await client.callTool({ name: 'export_scene', arguments: { sceneID: slot.sceneID, exportSettings: { ...exportSettings, up: '-Z' } } })).isError, true);
  assert.equal(calls.length, 2);
});
