import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { definitions, executeTool, origins, projectToolOutput, JSON_LIMIT, isProcessingTool, toolRequest } from '@cartwhl/mcp-server/tool-executor';
import { definitions as localDefinitions } from '../src/server.mjs';

test('stable CJS and ESM executor export shares the local catalog and preserves deep imports', async () => {
  const require = createRequire(import.meta.url);
  assert.equal(require('@cartwhl/mcp-server/tool-executor').executeTool, executeTool);
  assert.equal((await import('@cartwhl/mcp-server/src/server.mjs')).definitions, definitions);
  assert.equal(require('@cartwhl/mcp-server/src/tool-executor/index.cjs').definitions, definitions);
  assert.equal(require('@cartwhl/mcp-server/src/tools.json'), require('@cartwhl/mcp-server/src/tool-executor/tools.json'));
  assert.equal(localDefinitions, definitions);
  assert.equal(definitions.length, 32);
});

test('canonical retarget classification, output safety and transport byte bounds are shared', async () => {
  const args = { motionID: 'motion:1', characterID: 'character:1', bodyIndex: 1, fps: 23.976, downloadType: 'bvh' };
  assert.equal(isProcessingTool('get_motion', { motionID: args.motionID }), false);
  assert.equal(isProcessingTool('get_motion', args), true);
  assert.equal(definitions.find(tool => tool.name === 'get_motion').annotations.readOnlyHint, false);
  let calls = 0;
  const asset = 'https://assets.getcartwheel.com/retarget.bvh?signature=private';
  const output = await executeTool('get_motion', args, { apiKey: 'SECRET', requestJSON: async (url, init, remaining) => {
    calls++;
    assert.equal(new URL(url).pathname, '/motion/motion%3A1');
    assert.equal(new URL(url).searchParams.get('characterID'), args.characterID);
    assert.equal(new URL(url).searchParams.get('bodyIndex'), '1');
    assert.ok(remaining > 30000 && remaining <= 35000);
    return { bvhURL: asset, durationSeconds: 3.5, apiKey: 'SECRET', rigType: 'axel', bvhRigType: 'axel', title: 'preview', previewOutputs: [] };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(output, { bvhURL: asset, durationSeconds: 3.5 });
  for (const value of [{ bvhURL: asset + '&key=SECRET' }, { status: 'Bearer private' }]) {
    assert.throws(() => projectToolOutput('get_motion', value, ['SECRET']), /Credential reflection/);
  }
  assert.deepEqual(projectToolOutput('get_motion', { bvhURL: 'https://evil.example/file', bvhURLs: [asset, 'http://assets.getcartwheel.com/file', null] }),
    { bvhURLs: [asset, null, null] });
  await assert.rejects(executeTool('get_motion', { motionID: 'm1' }, { apiKey: 'SECRET',
    fetchImpl: async () => new Response(' '.repeat(JSON_LIMIT + 1)) }), /Response too large/);
  assert.throws(() => toolRequest('get_motion', { motionID: 'm1', characterID: '../escape' }));
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
        return Response.json({ sceneID: 'scene-1', objects: {} });
      },
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(executeTool('list_characters', {}, { apiKey: 'secret', environment: 'https://evil.example' }));
});

test('character pagination preserves pending null assets and the explicit terminal token', async () => {
  const pending = { jobID: 'pending-1', characterName: 'Pending', uploadStatus: 'PENDING', fileExtension: null,
    characterFileURL: null, thumbnailURL: null, configURL: null, tempConfigURL: null };
  const pages = [{ characters: [pending], nextToken: 'page-2' }, { characters: [], nextToken: null }];
  let calls = 0;
  let nextToken;
  do {
    const expected = pages[calls];
    const page = await executeTool('list_characters', nextToken ? { nextToken } : {}, { apiKey: 'SECRET', fetchImpl: async url => {
      assert.equal(url.searchParams.get('nextToken'), nextToken ?? null);
      calls++;
      return Response.json(expected);
    } });
    assert.deepEqual(page, expected);
    nextToken = page.nextToken;
  } while (nextToken);
  assert.equal(calls, 2);
  const unsafe = projectToolOutput('list_characters', { characters: [{ ...pending, characterFileURL: 'https://evil.example/mesh' }], nextToken: null });
  assert.deepEqual(unsafe.characters, [pending]);
  assert.throws(() => projectToolOutput('list_characters', { characters: [{ ...pending, characterName: 'SECRET' }] }, ['SECRET']), /Credential reflection/);
});

test('public API response fields survive typed projection while nested metadata and unsafe URLs do not', () => {
  const url = 'https://assets.getcartwheel.com/file?signature=private';
  const listing = { jobID: 'motion-1', title: 'Duet', cameraJsonURL: url, cwmsURL: url,
    faceURLs: [null, { bvhURL: url, jsonURL: url }],
    actorOutputs: [{ outputIndex: 1, targetID: 'actor-2', kind: 'person', actorLabel: 'Second actor', selectionRevision: 2 }],
    outputs: [null, { actorIndex: 1, bvhURL: url, mhrIdentityJsonURL: url }],
    export_urls: [null, url], export_filenames: [null, 'actor-2.fbx'], bvh_urls: [null, url] };
  const samples = {
    list_motions: { items: [listing] },
    list_batch_motions: { items: [{ ...listing, variations: [listing] }] },
    get_motion: { motionID: 'motion-1', sourceBvhURL: url, errorMessage: 'Motion still processing' },
    search_motions: { items: [], categoryInformation: [{ category: 'Locomotion', docCount: 4,
      subcategories: [{ subcategory: 'Walking', docCount: 4, tags: [{ tag: 'slow', docCount: 2 }] }] }] },
    get_character: { characterID: 'character-1', characterFileURL: null, characterFbxURL: null, baseFbxURL: null,
      baseGlbURL: null, referenceImageURL: url, thumbnailURL: null, rotationOffsets: { head: [0, 0, 0] } },
    get_batch: { batchID: 'batch-1', status: 'IN_PROGRESS', batchName: 'Duet', downloadURL: null,
      exportSettings: { characterID: 'character-1', includeMesh: true, moveInPlace: 'false' },
      modelProperties: { comicModel: 'comic4', numPeople: 2 }, numPeopleByMediaID: { 'media-1': 2 } },
  };
  for (const [name, sample] of Object.entries(samples)) {
    assert.deepEqual(projectToolOutput(name, { ...sample, createdBy: 'private-creator', apiKey: 'SECRET' }), sample, name);
  }
  const dirty = structuredClone(listing);
  dirty.actorOutputs[0].apiKey = 'SECRET';
  dirty.outputs[1].bvh = 'private/storage/key';
  dirty.faceURLs[1].jsonURL = 'https://evil.example/face.json';
  assert.throws(() => projectToolOutput('list_motions', { items: [dirty] }), /Invalid asset URL/);
  dirty.faceURLs[1].jsonURL = url;
  assert.deepEqual(projectToolOutput('list_motions', { items: [dirty] }), samples.list_motions);
  assert.throws(() => projectToolOutput('search_motions', { items: [], categoryInformation: [
    { category: 'Locomotion', subcategories: [{ tags: [{ tag: 'SECRET' }] }] },
  ] }, ['SECRET']), /Credential reflection/);
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
