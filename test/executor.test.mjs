import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { definitions, executeTool, origins } from '../src/tool-executor/index.cjs';
import { hostedTools, hostedRequest, validateHostedInput, projectHostedOutput, HOSTED_JSON_LIMIT, withinJSONLimit } from '../src/tool-executor/hosted.cjs';
import { definitions as localDefinitions } from '../src/server.mjs';
import { motionTools } from '../src/hosted-motion.mjs';
import Ajv from 'ajv';
import { realisticKeyPoses, slot } from './hosted-fixtures.mjs';

test('plain CJS and ESM share the same catalog and hosted exposure is explicit', () => {
  assert.equal(createRequire(import.meta.url)('../src/tool-executor/index.cjs').executeTool, executeTool);
  assert.equal(localDefinitions, definitions);
  assert.equal(definitions.length, 30);
  assert.equal(motionTools, hostedTools);
  assert.equal(hostedTools.length, 16);
  for (const name of ['apply_motion_edit', 'edit_motion', 'edit_key_poses', 'analyze_motion', 'set_scene_character',
    'loop_motion', 'stitch_motions', 'submit_character_generation', 'create_media_upload']) {
    assert.ok(!hostedTools.some(tool => tool.name === name), name);
    assert.throws(() => hostedRequest(name, {}));
  }
  assert.equal(validateHostedInput('get_motion', { motionID: 'motion-1', characterID: 'char-1' }), false);
});

test('executor accepts only explicit fixed origins, with credentials and audit supplied by the caller', async () => {
  for (const environment of ['staging', 'production']) {
    let calls = 0;
    await executeTool('create_scene', { sceneName: 'Review', motions: [{ motionID: 'motion-1' }] }, {
      apiKey: 'SECRET', environment, createdByUser: 'user-authenticated', fetchImpl: async (url, init) => {
        calls++;
        assert.equal(url.origin, origins[environment]); assert.equal(init.redirect, 'error');
        assert.equal(init.headers['x-api-key'], 'SECRET');
        assert.equal(JSON.parse(init.body).createdByUser, 'user-authenticated');
        return Response.json({ sceneID: 'scene-1' });
      },
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(executeTool('list_characters', {}, { apiKey: 'secret', environment: 'https://evil.example' }));
});

test('edit history check and final request share a single backend deadline', async () => {
  const budgets = [];
  await executeTool('get_motion_edit', { sceneID: 'scene-1', referenceName: 'character', timelineIndex: 0, jobID: 'edit-1' }, {
    apiKey: 'SECRET', timeoutMs: 100, requestJSON: async (url, init, budget) => {
      budgets.push(budget); assert.equal(init.redirect, 'error');
      if (budgets.length === 1) { await new Promise(resolve => setTimeout(resolve, 15)); return { jobs: [{ jobID: 'edit-1' }] }; }
      return { jobID: 'edit-1', status: 'COMPLETED' };
    },
  });
  assert.equal(budgets.length, 2); assert.ok(budgets[1] < budgets[0]);
});

test('read schemas accept string hand poses and legacy key poses without weakening saves', () => {
  const { smoothRoot2d, ...pose } = realisticKeyPoses(1)[0];
  const edit = { jobID: 'edit-1', status: 'COMPLETED', keyPoses: [pose] };
  assert.deepEqual(projectHostedOutput('get_motion_edit', { ...edit, keyPoses: [{ ...pose, secret: 'private' }] }), edit);
  assert.equal(validateHostedInput('save_key_poses', { ...slot, keyPoses: [pose] }), false);
  assert.equal(validateHostedInput('save_key_poses', { ...slot, keyPoses: [{ ...pose, smoothRoot2d }] }), true);
  for (const staticHands of ['default', 'relaxed']) {
    const scene = { sceneID: slot.sceneID, objects: { character: { objectID: 'char-1', timeline: [{ staticHands, keyPoses: [pose] }] } } };
    for (const name of ['get_scene', 'create_scene']) assert.deepEqual(projectHostedOutput(name, scene), scene);
    assert.deepEqual(projectHostedOutput('list_scenes', { scenes: [scene] }), { scenes: [scene] });
  }
});

test('aggregate byte bounds constrain nested valid arguments and projected output', () => {
  const args = { ...slot, keyPoses: realisticKeyPoses(300, 256) };
  const tool = hostedTools.find(tool => tool.name === 'save_key_poses');
  assert.equal(new Ajv().compile(tool.inputSchema)(args), true); // Individual array limits all pass.
  assert.ok(Buffer.byteLength(JSON.stringify(args)) > HOSTED_JSON_LIMIT);
  assert.equal(validateHostedInput(tool.name, args), false);
  assert.throws(() => hostedRequest(tool.name, args));
  const edit = { jobID: 'edit-1', status: 'COMPLETED', keyPoses: args.keyPoses };
  assert.throws(() => projectHostedOutput('get_motion_edit', edit), /Invalid upstream data/);
  assert.throws(() => projectHostedOutput('get_motion_edit', { ...edit, keyPoses: realisticKeyPoses(301, 1) }));
  assert.equal(withinJSONLimit('x'.repeat(HOSTED_JSON_LIMIT - 2)), true);
  assert.equal(withinJSONLimit('x'.repeat(HOSTED_JSON_LIMIT - 1)), false);
});
