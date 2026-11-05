import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer, definitions } from '../src/server.mjs';
import { invokeViewer, viewerTool, viewerResourceUri, viewerResource, supportsViewerApp } from '../src/viewer.mjs';
import { previewsTool, previewsResourceUri } from '../src/previews.mjs';

async function connect(t, fetchImpl, capabilities = {}) {
  const server = createServer({ apiKey: 'test-secret', fetchImpl });
  const client = new Client({ name: 'test', version: '1' }, { capabilities });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
const unpack = response => JSON.parse(response.content[0].text);
const generation = {
  prompts: ['A person waving hello.\n\tThen take a bow.\r\nPause.'], requestedModel: 'swing',
  exportSettings: { characterID: 'char-test', exportType: 'bvh', forward: 'Z', up: 'Y', frameRate: 30, frameStepSize: 1 },
};

test('local MCP returns safe scene-list size guidance without retrying', async t => {
  let calls = 0;
  const client = await connect(t, async () => { calls++; return new Response(' '.repeat(1024 * 1024 + 1)); });
  for (const limit of [20, 1]) {
    const response = await client.callTool({ name: 'list_scenes', arguments: { limit } });
    assert.equal(response.isError, true);
    const failure = unpack(response);
    assert.equal(failure.code, 'scene_list_too_large');
    assert.equal(failure.suggestedLimit, limit === 20 ? 10 : undefined);
    assert.equal(failure.retryable, false);
    assert.doesNotMatch(JSON.stringify(response), /test-secret|https?:/);
  }
  assert.equal(calls, 2);
});

test('MCP discovery, authenticated pagination and path encoding', async t => {
  const calls = [];
  const client = await connect(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ items: [], nextToken: 'next' });
  });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 35);
  assert.equal(tools.find(tool => tool.name === 'generate_motion').annotations.readOnlyHint, false);
  const response = await client.callTool({ name: 'list_motions', arguments: { limit: 10, nextToken: 'a+b/=', sortAscending: false } });
  assert.equal(unpack(response).nextToken, 'next');
  assert.equal(calls[0].url.searchParams.get('nextToken'), 'a+b/=');
  assert.equal(calls[0].url.searchParams.get('sortAscending'), 'false');
  assert.equal(calls[0].options.headers['x-api-key'], 'test-secret');
  assert.equal(calls[0].options.redirect, 'error');
  await client.callTool({ name: 'get_motion', arguments: { motionID: 'mogen-job-example:123' } });
  assert.equal(calls[1].url.pathname, '/motion/mogen-job-example%3A123');
});

test('get_account is discovered and calls the API once without exposing API-key metadata', async t => {
  const calls = [];
  const client = await connect(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ planType: 'team', currentCredits: -0.5, allowedNumBatches: 2,
      allowedNumBatchSize: 8, apiKey: { projectKeyID: 'private-id', projectKeyLast4Digits: '1234', organizationID: 'private-org' } });
  });
  const tool = (await client.listTools()).tools.find(item => item.name === 'get_account');
  assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, required: [], additionalProperties: false });
  const result = await client.callTool({ name: 'get_account', arguments: {} });
  assert.equal(result.isError, false);
  assert.deepEqual(unpack(result), { planType: 'team', currentCredits: -0.5, allowedNumBatches: 2, allowedNumBatchSize: 8 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/account');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers['x-api-key'], 'test-secret');
  assert.doesNotMatch(JSON.stringify(result), /private-id|1234|private-org/);
});

test('generation submits the API body once and returns its batch ID', async t => {
  let count = 0;
  const client = await connect(t, async (url, options) => {
    count++;
    assert.equal(url.pathname, '/motion/fromText');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), generation);
    return Response.json({ batchID: 'batch-1', status: 'pending' }, { status: 202 });
  });
  assert.equal(unpack(await client.callTool({ name: 'generate_motion', arguments: generation })).batchID, 'batch-1');
  assert.equal(count, 1);
});

test('invalid arguments and unknown tools never reach the API', async t => {
  const client = await connect(t, async () => { assert.fail('Must not call API'); });
  for (const [name, args] of [
    ['generate_motion', {}],
    ['generate_motion', { ...generation, requestedModel: 'invented' }],
    ['generate_motion', { ...generation, prompts: ['Wave.\nThen\u0000bow.'] }],
    ['generate_motion', { ...generation, exportSettings: { characterID: 'x' } }],
    ['list_motions', { limit: 101 }],
    ['list_motions', { url: 'https://other.example' }],
    ['list_batch_motions', { batchID: 'batch-1' }],
    ['get_motion', { motionID: '..' }],
    ['get_motion', { motionID: 'x/../serviceID' }],
    ['generate_motion', { ...generation, createdByUser: 'other-user' }],
    ['delete_scene', {}],
  ]) assert.equal((await client.callTool({ name, arguments: args })).isError, true);
});

test('upstream failures are redacted and generation is not retried', async t => {
  let count = 0;
  const client = await connect(t, async () => {
    count++;
    return new Response('test-secret private diagnostic', { status: 429, headers: { 'retry-after': '30' } });
  });
  const response = await client.callTool({ name: 'generate_motion', arguments: generation });
  assert.equal(response.isError, true);
  assert.equal(unpack(response).retryAfter, '30');
  assert.equal(JSON.stringify(response).includes('test-secret'), false);
  assert.equal(count, 1);
});

test('network errors report uncertainty without leaking secrets', async t => {
  const client = await connect(t, async () => { throw new Error('test-secret'); });
  const response = await client.callTool({ name: 'generate_motion', arguments: generation });
  assert.equal(response.isError, true);
  assert.match(unpack(response).guidance, /may have been accepted/);
  assert.equal(JSON.stringify(response).includes('test-secret'), false);
});

test('startup requires a key', () => {
  assert.throws(() => createServer({}), /API_KEY/);

});

const capture = {
  mediaIDs: ['media-1'], comicModel: 'comic4', numPeople: 2, facialCapture: true,
  exportSettings: { ...generation.exportSettings, exportType: 'fbx-blender', moveInPlace: false },
};

test('Comic 4 upload preparation, capture, and retrieval preserve every actor and face slot', async t => {
  const calls = [];
  const outputs = {
    motionID: 'motion-1', bvhURL: 'https://assets.getcartwheel.com/primary.bvh',
    bvhURLs: ['https://assets.getcartwheel.com/a.bvh', 'https://assets.getcartwheel.com/b.bvh'],
    exportURLs: [null, 'https://assets.getcartwheel.com/b.fbx'], exportFilenames: [null, 'b.fbx'],
    faceURLs: [{ bvhURL: 'https://assets.getcartwheel.com/a-face.fbx' }, { bvhURL: 'https://assets.getcartwheel.com/b-face.fbx' }],
    mhrBvhURLs: [null, 'https://assets.getcartwheel.com/b-mhr.bvh'],
    mhrIdentityJsonURLs: [null, 'https://assets.getcartwheel.com/b-identity.json'],
    cameraFbxURL: 'https://assets.getcartwheel.com/camera.fbx', sourceVideoMediaID: 'media-1',
  };
  const client = await connect(t, async (url, options) => {
    calls.push({ url, options });
    if (url.pathname === '/media/upload') return Response.json({ mediaUploads: [{ mediaID: 'media-1', extension: 'mp4', mediaUploadURL: 'https://assets.example/upload' }] });
    if (url.pathname === '/motion/fromVideo') {
      assert.deepEqual(JSON.parse(options.body), capture);
      return Response.json({ batchID: 'batch-comic-1' }, { status: 202 });
    }
    if (url.pathname === '/motions/batch-comic-1') return Response.json({ items:[outputs] });
    if (url.pathname === '/motion/motion-1') return Response.json({ motionID:'motion-1',status:'COMPLETED',bvhURL:outputs.bvhURL });
    if (url.pathname === '/media/media-1') return Response.json({ mediaID: 'media-1', downloadURL: 'https://assets.example/source.mp4' });
    assert.fail(`Unexpected route ${url.pathname}`);
  });
  const media = { media: [{ name: 'Duet', extension: 'mp4', duration: 8, resolution: '1920x1080' }] };
  assert.equal(unpack(await client.callTool({ name: 'create_media_upload', arguments: media })).mediaUploads[0].mediaID, 'media-1');
  assert.deepEqual(JSON.parse(calls[0].options.body), media);
  assert.equal(unpack(await client.callTool({ name: 'generate_motion_from_video', arguments: capture })).batchID, 'batch-comic-1');
  assert.deepEqual(unpack(await client.callTool({ name: 'list_batch_motions', arguments: { batchID: 'batch-comic-1',limit:10 } })).items, [outputs]);
  assert.equal(unpack(await client.callTool({ name: 'get_motion', arguments: { motionID: 'motion-1' } })).bvhURL, outputs.bvhURL);
  assert.equal(unpack(await client.callTool({ name: 'get_media', arguments: { mediaID: 'media-1' } })).mediaID, 'media-1');
  assert.equal(calls.filter(c => c.url.pathname === '/motion/fromVideo').length, 1);
  assert.ok(calls.every(c => c.url.origin === 'https://external-mogen.api.getcartwheel.com'));
});

test('Comic 4 rejects unsupported models, invalid actor counts, hidden fields and static face overrides', async t => {
  const client = await connect(t, async () => assert.fail('Invalid requests must not be sent'));
  const { comicModel, ...missingModel } = capture;
  for (const arguments_ of [missingModel, { ...capture, comicModel: 'comic3' },
    { ...capture, mediaIDs: [] }, { ...capture, mediaIDs: ['media-1', 'media-1'] },
    { ...capture, numPeople: 0 }, { ...capture, numPeople: 5 }, { ...capture, numPeople: 1.5 },
    { ...capture, createdByUser: 'someone-else' }, { ...capture, subscribers: ['person@example.com'] },
    { ...capture, callbackURL: 'https://example.com' },
    { ...capture, exportSettings: { ...capture.exportSettings, faceExpression: 'smile' } },
    { ...capture, exportSettings: { ...capture.exportSettings, frameStepSize: 0 } },
  ]) assert.equal((await client.callTool({ name: 'generate_motion_from_video', arguments: arguments_ })).isError, true);
  for (const media of [[], [{ name: 'x', extension: 'exe' }], [{ name: 'x', extension: 'mp4', duration: 31 }],
    [{ name: 'x', extension: 'mp4', s3Key: 'other-project' }]]) {
    assert.equal((await client.callTool({ name: 'create_media_upload', arguments: { media } })).isError, true);
  }
  assert.equal((await client.callTool({ name: 'get_media', arguments: { mediaID: '../other' } })).isError, true);
});

test('ambiguous Comic 4 failures do not resubmit or disclose diagnostics', async t => {
  let calls = 0;
  const client = await connect(t, async () => { calls++; throw new Error('test-secret signed-private-url'); });
  const response = await client.callTool({ name: 'generate_motion_from_video', arguments: capture });
  assert.equal(response.isError, true);
  assert.match(unpack(response).guidance, /may have been accepted/);
  assert.doesNotMatch(JSON.stringify(response), /test-secret|signed-private-url/);
  assert.equal(calls, 1);
});

test('per-person retargeting selects the requested actor and requires a target character', async t => {
  let calls = 0;
  const client = await connect(t, async url => {
    calls++;
    assert.equal(url.searchParams.get('bodyIndex'), '1');
    assert.equal(url.searchParams.get('characterID'), 'char-second');
    assert.equal(url.searchParams.get('downloadType'), 'gltf');
    return Response.json({ gltfURL: 'https://assets.example/second.glb' });
  });
  assert.equal((await client.callTool({ name:'get_motion', arguments:{motionID:'motion-1',bodyIndex:1} })).isError, true);
  assert.equal((await client.callTool({ name:'get_motion', arguments:{motionID:'motion-1',characterID:'char-second',bodyIndex:-1} })).isError, true);
  assert.equal((await client.callTool({ name:'get_motion', arguments:{motionID:'motion-1',characterID:'char-second',bodyIndex:1,downloadType:'gltf'} })).isError, false);
  assert.equal(calls,1);
});

test('real stdio process completes MCP initialization and discovery', async t => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))],
    env: { CARTWHEEL_API_KEY: 'test-only-never-sent' }, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-test', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), [...definitions.map(tool => tool.name), viewerTool.name, previewsTool.name]);
  assert.equal((await client.listPrompts()).prompts[0].name, 'grounded_blender_scene');
  assert.match((await client.readResource({ uri: 'cartwheel://workflows/blender' })).contents[0].text, /Gaussian/);
  assert.equal((await client.callTool({ name: viewerTool.name })).structuredContent.previewUrl,
    'https://app.getcartwheel.com/asset-viewer.html#characterName=MHR');
});

test('local viewer negotiates MCP Apps and otherwise returns a private expiring link through the same tool', async t => {
  const glb = 'https://bucket.s3.amazonaws.com/character.glb?X-Amz-Signature=private-glb';
  const bvh = 'https://bucket.s3.amazonaws.com/motion.bvh?X-Amz-Signature=private-bvh';
  for (const app of [false, true]) {
    const calls = [];
    const client = await connect(t, async (url, options) => {
      calls.push(url);
      assert.equal(url.origin, 'https://external-mogen.api.getcartwheel.com');
      assert.equal(options.headers['x-api-key'], 'test-secret');
      return Response.json(url.pathname.includes('/characters/')
        ? { characterID: 'character-1', characterName: 'Character', uploadStatus: 'COMPLETE', baseGlbURL: glb }
        : { motionID: 'motion-1', status: 'COMPLETED', bvhURL: bvh });
    }, app ? { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } : {});
    const tool = (await client.listTools()).tools.find(tool => tool.name === viewerTool.name);
    assert.deepEqual(tool, viewerTool);
    assert.equal(tool.securitySchemes, undefined);
    const resource = (await client.readResource({ uri: viewerResourceUri })).contents[0];
    assert.deepEqual(resource._meta.ui.csp.frameDomains, ['https://app.getcartwheel.com']);
    assert.equal(resource._meta['openai/ui'], undefined);
    assert.doesNotMatch(resource.text, /X-Amz-Signature|private-glb|private-bvh|app-staging/);
    const result = await client.callTool({ name: viewerTool.name, arguments: { characterID: 'character-1', motionID: 'motion-1' } });
    assert.equal(result.isError, false);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].searchParams.get('characterID'), 'character-1');
    assert.equal(calls[1].searchParams.get('downloadType'), 'bvh');
    const url = new URL(result._meta.viewerUrl);
    assert.equal(url.origin, 'https://app.getcartwheel.com');
    assert.equal(url.search, '');
    const fragment = new URLSearchParams(url.hash.slice(1));
    assert.equal(fragment.get('meshUrl'), glb);
    assert.equal(fragment.get('bvhUrl'), bvh);
    assert.equal(fragment.get('retargetedMotion'), 'true');
    if (app) {
      assert.equal(result.structuredContent.previewUrl, undefined);
      assert.doesNotMatch(JSON.stringify([result.content, result.structuredContent]), /https:|Signature/);
    } else {
      assert.equal(result.structuredContent.previewUrl, url.href);
      assert.ok(result.content[0].text.includes(url.href));
      assert.match(result.content[0].text, /Private, expiring/);
    }
    assert.equal((await client.callTool({ name: viewerTool.name, arguments: { meshUrl: glb } })).isError, true);
    assert.equal(calls.length, 2);
  }
  assert.equal(supportsViewerApp({ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html'] } } }), false);
  assert.equal(supportsViewerApp({ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: 'text/html;profile=mcp-app' } } }), false);
  assert.throws(() => viewerResource('https://evil.example'), /Viewer unavailable/);
});

const captureArgs = { batchID: 'batch-capture', motionID: 'motion-capture' };
const captureBatch = { batchID: captureArgs.batchID, status: 'COMPLETED', numPeopleByMediaID: { 'media-1': 2 } };
const captureMotion = { jobID: captureArgs.motionID, status: 'COMPLETED', sourceVideoMediaID: 'media-1',
  bvhURL: 'https://bucket.s3.amazonaws.com/body0.bvh',
  mhrBvhURLs: [0, 1].map(i => `https://bucket.s3.amazonaws.com/original-${i}.bvh?Signature=private`),
  mhrIdentityJsonURLs: [0, 1].map(i => `https://resources.getcartwheel.com/identity-${i}.json?Signature=private`) };

test('local capture preview resolves the exact paginated job and all original indexed pairs without processing', async t => {
  for (const app of [false, true]) {
    const calls = [];
    const client = await connect(t, async (url, options) => {
      calls.push(url);
      assert.equal(options.method, 'GET');
      assert.equal(url.searchParams.has('characterID'), false);
      if (url.pathname === '/batch/batch-capture') return Response.json(captureBatch);
      assert.equal(url.pathname, '/motions/batch-capture');
      assert.equal(url.searchParams.get('limit'), '10');
      return Response.json(url.searchParams.get('nextToken') === 'next-page'
        ? { items: [captureMotion] } : { items: [{ ...captureMotion, jobID: 'another-motion' }], nextToken: 'next-page' });
    }, app ? { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } : {});
    const result = await client.callTool({ name: viewerTool.name, arguments: captureArgs });
    assert.equal(result.isError, false);
    assert.equal(calls.length, 3);
    assert.equal(result.structuredContent.actorCount, 2);
    assert.deepEqual(result.structuredContent.actorIDs, ['capture-0', 'capture-1']);
    assert.equal(result.structuredContent.characterID, 'char-upload-MHR');
    const url = new URL(result._meta.viewerUrl), fragment = new URLSearchParams(url.hash.slice(1));
    assert.deepEqual([...fragment.keys()], ['actors']);
    assert.deepEqual(JSON.parse(fragment.get('actors')), [0, 1].map(index => ({ actorId: `capture-${index}`,
      bvhUrl: captureMotion.mhrBvhURLs[index], identityUrl: captureMotion.mhrIdentityJsonURLs[index],
      characterName: 'MHR', motionName: captureArgs.motionID, retargetedMotion: false })));
    if (app) assert.doesNotMatch(JSON.stringify([result.content, result.structuredContent]), /https:|Signature|private/);
    else assert.equal(result.structuredContent.previewUrl, url.href);
  }
});

test('capture preview fails atomically for missing, unsafe, incomplete or ambiguous actor outputs', async () => {
  const cases = [
    { mhrBvhURLs: undefined }, { mhrIdentityJsonURLs: undefined },
    { mhrBvhURLs: [null, captureMotion.mhrBvhURLs[1]] },
    { mhrIdentityJsonURLs: [captureMotion.mhrIdentityJsonURLs[0], null] },
    { mhrBvhURLs: [captureMotion.mhrBvhURLs[0]] }, { mhrIdentityJsonURLs: [] },
    ...['', 'https://evil.example/private', 'https://app.getcartwheel.com/private',
      'https://bucket.s3.amazonaws.com/x#fragment', 'https://bucket.s3.amazonaws.com/x\n',
      'https://user:pass@bucket.s3.amazonaws.com/x', 'http://bucket.s3.amazonaws.com/x']
      .map(value => ({ mhrBvhURLs: [captureMotion.mhrBvhURLs[0], value] })),
    { status: 'FAILED' }, { status: 'GENERATING' }, { jobID: 'wrong' },
    { motionID: 'conflicting' }, { sourceVideoMediaID: 'unknown' }, { variations: [{}, {}] },
    { mhrBvhURLs: Array(5).fill(captureMotion.mhrBvhURLs[0]) },
    { mhrBvhURLs: captureMotion.mhrBvhURLs.map(url => url + 'x'.repeat(17000)) },
  ];
  for (const patch of cases) {
    const calls = [];
    const result = await invokeViewer(captureArgs, { invokeTool: async (name, args) => {
      calls.push([name, args]);
      return { structuredContent: name === 'get_batch' ? captureBatch : { items: [{ ...captureMotion, ...patch }] } };
    } });
    assert.equal(result.structuredContent.status, 'assets_unavailable', JSON.stringify(patch));
    assert.equal(result._meta, undefined);
    assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify(result), /https:|Signature|body0|pass@/);
  }
  for (const batch of [{ ...captureBatch, status: 'IN_PROGRESS' }, { ...captureBatch, batchID: 'wrong' },
    { ...captureBatch, numPeopleByMediaID: undefined },
    ...[0, 1, 3, 5, 1.5].map(count => ({ ...captureBatch, numPeopleByMediaID: { 'media-1': count } }))]) {
    const result = await invokeViewer(captureArgs, { invokeTool: async name => ({ structuredContent:
      name === 'get_batch' ? batch : { items: [captureMotion] } }) });
    assert.equal(result.structuredContent.status, 'assets_unavailable');
  }
});

test('capture preview accepts one through four complete actors and enforces the encoded fragment ceiling', async () => {
  for (const count of [1, 4]) {
    const motion = { ...captureMotion,
      mhrBvhURLs: Array.from({ length: count }, (_, i) => `https://bucket.s3.amazonaws.com/${i}.bvh`),
      mhrIdentityJsonURLs: Array.from({ length: count }, (_, i) => `https://bucket.s3.amazonaws.com/${i}.json`) };
    const invoke = async () => invokeViewer(captureArgs, { invokeTool: async name => ({ structuredContent:
      name === 'get_batch' ? { ...captureBatch, numPeopleByMediaID: { 'media-1': count } } : { items: [motion] } }) });
    const result = await invoke();
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.actorCount, count);
    const baseLength = new URL(result._meta.viewerUrl).hash.length;
    motion.mhrBvhURLs[0] += 'x'.repeat(32768 - baseLength);
    assert.equal(new URL((await invoke())._meta.viewerUrl).hash.length, 32768);
    motion.mhrBvhURLs[0] += 'x';
    const tooLong = await invoke();
    assert.equal(tooLong.structuredContent.status, 'assets_unavailable');
    assert.equal(tooLong._meta, undefined);
  }
});

test('capture input is strict before API access and pagination is bounded without retries', async () => {
  for (const args of [{ batchID: 'batch-capture' }, { ...captureArgs, characterID: 'char-upload-MHR' },
    { ...captureArgs, actors: [] }, { ...captureArgs, bvhUrl: captureMotion.bvhURL },
    { ...captureArgs, batchID: '../bad' }, { ...captureArgs, motionID: 'x'.repeat(257) },
    { ...captureArgs, batchID: 'batch-capture\n' }]) {
    const result = await invokeViewer(args, { invokeTool: () => assert.fail('Invalid input cannot fetch') });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).code, 'invalid_request');
  }
  for (const repeat of [false, true]) {
    let pages = 0;
    const result = await invokeViewer(captureArgs, { invokeTool: async name => ({ structuredContent:
      name === 'get_batch' ? captureBatch : { items: [], nextToken: repeat ? 'same-token' : `page-${++pages}` } }) });
    assert.equal(result.structuredContent.status, 'assets_unavailable');
    if (!repeat) assert.equal(pages, 10);
  }
  const failure = { isError: true, content: [{ type: 'text', text: 'upstream failed' }] };
  let calls = 0;
  assert.equal(await invokeViewer(captureArgs, { invokeTool: async () => { calls++; return failure; } }), failure);
  assert.equal(calls, 1);
});

test('preview presentation is discoverable without API calls and keeps media in UI-only metadata', async t => {
  const client = await connect(t, async () => assert.fail('Presenting existing previews must not call the API'));
  assert.deepEqual((await client.listTools()).tools.find(tool => tool.name === previewsTool.name), previewsTool);
  const items = Array.from({ length: 10 }, (_, i) => ({ title: `Walk ${i + 1}`, motionID: `motion-${i + 1}`,
    media: { type: 'video', url: `https://resources.getcartwheel.com/previews/${i}.mp4?signature=private` } }));
  const response = await client.callTool({ name: previewsTool.name, arguments: { items } });
  assert.equal(response.isError, false);
  assert.equal(response.structuredContent.items.length, 10);
  assert.equal(response._meta.previewItems[9].motionID, 'motion-10');
  assert.equal(response._meta.previewItems[9].media.url, items[9].media.url);
  assert.doesNotMatch(JSON.stringify([response.content, response.structuredContent]), /https:|signature=private/);
  const resource = (await client.readResource({ uri: previewsResourceUri })).contents[0];
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(resource._meta.ui.csp.frameDomains, ['https://app.getcartwheel.com']);
  assert.doesNotMatch(resource.text, /signature=private|test-secret/);
});
