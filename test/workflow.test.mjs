import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.mjs';
import { workflowUri, workflowPrompt, comicWorkflowUri, comicWorkflowPrompt, gameWorkflowUri, gameWorkflowPrompt } from '../src/workflows.mjs';

async function connect(t) {
  const server = createServer({ apiKey: 'workflow-test-key', fetchImpl: async () => assert.fail('Workflow discovery must not call the API') });
  const client = new Client({ name: 'workflow-test', version: '1' });
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test('Blender workflow is discoverable and packaged files exist', async t => {
  const client = await connect(t);
  const capabilities = client.getServerCapabilities();
  assert.ok(capabilities.prompts);
  assert.ok(capabilities.resources);
  assert.match(client.getInstructions(), /grounded_blender_scene/);
  assert.deepEqual((await client.listPrompts()).prompts.map(p => p.name), [workflowPrompt,comicWorkflowPrompt,gameWorkflowPrompt]);
  assert.deepEqual((await client.listResources()).resources.map(r => r.uri), [workflowUri,comicWorkflowUri,gameWorkflowUri]);
  const response = await client.readResource({ uri: workflowUri });
  const guide = response.contents[0].text;
  for (const term of ['Gaussian', 'source ankle rotation', 'verify_motion.py', 'render_examples.py', 'Generation consumes credits']) assert.ok(guide.includes(term), term);
  const directory = guide.match(/Installed example directory: (.+)/)[1];
  for (const file of ['motion.py','verify_motion.py','render_examples.py','assets/dance_0.bvh','assets/showcase_1.bvh']) await access(`${directory}/${file}`);
  assert.equal(JSON.stringify(response).includes('workflow-test-key'), false);
});

test('Comic 4 workflow includes upload, all-actor export, facial and camera guidance', async t => {
  const client = await connect(t);
  const { contents } = await client.readResource({ uri: comicWorkflowUri });
  const guide = contents[0].text;
  for (const term of ['create_media_upload','generate_motion_from_video','faceURLs','MHR FBX','cameraFbxURL','null','coordinate frame']) assert.ok(guide.includes(term), term);
  const directory = guide.match(/Installed example directory: (.+)/)[1];
  await access(`${directory}/upload-video.mjs`);
  const prompt = await client.getPrompt({ name: comicWorkflowPrompt, arguments: { scene: 'Two actors and a new camera angle' } });
  assert.match(prompt.messages[0].content.text, /Comic 4/);
  assert.match(prompt.messages[1].content.text, /Two actors/);
});

test('Blender prompt supplies the default workflow and requested scene', async t => {
  const client = await connect(t);
  const response = await client.getPrompt({ name: workflowPrompt, arguments: { scene: 'A playful robot in a garden' } });
  assert.equal(response.messages.length, 2);
  assert.match(response.messages[0].content.text, /Gaussian/);
  assert.match(response.messages[1].content.text, /A playful robot in a garden/);
  assert.equal((await client.getPrompt({ name: workflowPrompt })).messages.length, 1);
});

test('workflow handlers reject unknown resources, prompts and arguments', async t => {
  const client = await connect(t);
  await assert.rejects(client.readResource({ uri: 'file:///etc/passwd' }), /Unknown Cartwheel resource/);
  await assert.rejects(client.getPrompt({ name: 'run_shell' }), /Unknown Cartwheel prompt/);
  await assert.rejects(client.getPrompt({ name: workflowPrompt, arguments: { command: 'anything' } }), /Unknown workflow argument/);
  await assert.rejects(client.getPrompt({ name: workflowPrompt, arguments: { scene: 'x'.repeat(4001) } }), /at most 4000/);
});

test('game workflow discovers a complete runnable example and explicit preparation contracts', async t => {
  const client = await connect(t);
  assert.match(client.getInstructions(), /game_ready_animation/);
  const { contents } = await client.readResource({ uri: gameWorkflowUri });
  const guide = contents[0].text;
  for (const term of ['create_scene','edit_motion','edit_key_poses','loop_motion','stitch_motions','analyze_motion','remove_verified_rest','positionConvention','kinematic estimates','authored','actual traveled distance']) assert.ok(guide.includes(term), term);
  const directory = guide.match(/Installed example directory: (.+)/)[1];
  for (const file of ['serve.mjs','prepare-game.mjs','sample-poses.mjs','index.html','assets/character.glb','assets/walk.bvh','assets/walk.motion.json']) await access(`${directory}/${file}`);
  assert.match((await client.getPrompt({ name: gameWorkflowPrompt, arguments: { scene: 'A game with a moving signal gesture' } })).messages[1].content.text, /moving signal/);
});
