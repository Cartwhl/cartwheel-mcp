import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { definitions, executeTool, origins } from '@cartwhl/mcp-server/tool-executor';
import { definitions as localDefinitions } from '../src/server.mjs';

test('stable CJS and ESM executor export shares the local catalog and preserves deep imports', async () => {
  const require = createRequire(import.meta.url);
  assert.equal(require('@cartwhl/mcp-server/tool-executor').executeTool, executeTool);
  assert.equal((await import('@cartwhl/mcp-server/src/server.mjs')).definitions, definitions);
  assert.equal(require('@cartwhl/mcp-server/src/tool-executor/index.cjs').definitions, definitions);
  assert.equal(localDefinitions, definitions);
  assert.equal(definitions.length, 32);
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
    apiKey: 'SECRET', timeoutMs: 1000, requestJSON: async (url, init, budget) => {
      budgets.push(budget); assert.equal(init.redirect, 'error');
      if (budgets.length === 1) { await new Promise(resolve => setTimeout(resolve, 15)); return { jobs: [{ jobID: 'edit-1' }] }; }
      return { jobID: 'edit-1', status: 'COMPLETED' };
    },
  });
  assert.equal(budgets.length, 2); assert.ok(budgets[1] < budgets[0]);
});
