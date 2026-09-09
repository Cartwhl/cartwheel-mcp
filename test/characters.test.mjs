import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.mjs';
import { uploadAsset } from '../examples/characters/upload-asset.mjs';

const unpack = response => JSON.parse(response.content[0].text);
const assetURL = file => `https://cartwheel-mogen-resources.s3.us-east-1.amazonaws.com/test/${file}?X-Amz-Signature=test-only`;
async function connect(t, fetchImpl, options = {}) {
  const server = createServer({ apiKey: 'private-project-key', fetchImpl, ...options });
  const client = new Client({ name: 'character-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
async function fixture(t, name, bytes = Buffer.from('selected asset bytes')) {
  const directory = await mkdtemp(join(tmpdir(), 'cartwheel-character-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
}

test('character generation follows prepare, submit, and both processing statuses without another generation', async t => {
  const calls = [];
  const statuses = [
    { uploadStatus: 'PENDING', generatedStatus: '3D_CONVERT_QUEUED' },
    { uploadStatus: 'AUTORIGGING_IN_PROGRESS', generatedStatus: '3D_CONVERT_COMPLETE' },
    { uploadStatus: 'COMPLETE', generatedStatus: '3D_CONVERT_COMPLETE', characterFileURL: assetURL('generated.fbx'), configURL: assetURL('config.json') },
  ];
  const prompt = 'A friendly humanoid forest courier with a quilted jacket';
  const client = await connect(t, async (url, options) => {
    calls.push(url.pathname);
    assert.equal(url.origin, 'https://external-mogen.api.getcartwheel.com');
    assert.equal(options.headers['x-api-key'], 'private-project-key');
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/characters/generate/prepare') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { prompt });
      return Response.json({ jobID: 'character-gen-courier' });
    }
    if (url.pathname === '/characters/generate/submit') {
      assert.deepEqual(JSON.parse(options.body), { jobID: 'character-gen-courier', characterName: 'Courier' });
      return Response.json({ characterID: 'character-gen-courier', uploadStatus: 'PENDING' }, { status: 202 });
    }
    assert.equal(url.pathname, '/characters/character-gen-courier');
    assert.equal(options.method, 'GET');
    return Response.json({ characterID: 'character-gen-courier', ...statuses.shift() });
  });
  const { jobID } = unpack(await client.callTool({ name: 'prepare_character_generation', arguments: { prompt } }));
  const { characterID } = unpack(await client.callTool({ name: 'submit_character_generation', arguments: { jobID, characterName: 'Courier' } }));
  const results = [];
  for (let i = 0; i < 3; i++) results.push(unpack(await client.callTool({ name: 'get_character', arguments: { characterID } })));
  assert.equal(results[1].generatedStatus, '3D_CONVERT_COMPLETE');
  assert.equal(results[1].uploadStatus, 'AUTORIGGING_IN_PROGRESS');
  assert.equal(results[2].characterFileURL, assetURL('generated.fbx'));
  assert.deepEqual(calls.slice(0, 2), ['/characters/generate/prepare', '/characters/generate/submit']);
  assert.equal(calls.length, 5);
});

test('image-reference creation uploads the selected media bytes before preparation', async t => {
  const filePath = await fixture(t, 'reference.webp');
  const slot = { mediaID: 'media-reference', extension: 'webp', mediaUploadURL: assetURL('reference.webp') };
  let uploaded = false;
  const client = await connect(t, async (url, options) => {
    if (url.pathname === '/media/upload') {
      assert.deepEqual(JSON.parse(options.body), { media: [{ extension: 'webp', name: 'Courier reference' }] });
      return Response.json({ mediaUploads: [slot] });
    }
    assert.ok(uploaded);
    assert.equal(url.pathname, '/characters/generate/prepare');
    assert.deepEqual(JSON.parse(options.body), { mediaID: slot.mediaID });
    return Response.json({ jobID: 'character-gen-from-image' });
  });
  const response = unpack(await client.callTool({ name: 'create_media_upload', arguments: { media: [{ extension: 'webp', name: 'Courier reference' }] } }));
  await uploadAsset({ kind: 'image', filePath, upload: response.mediaUploads[0], fetchImpl: async (url, options) => {
    assert.equal(url.href, slot.mediaUploadURL);
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['Content-Type'], 'image/webp');
    assert.equal(options.headers['x-api-key'], undefined);
    for await (const _ of options.body) { /* consume the selected file */ }
    uploaded = true;
    return new Response(null, { status: 200 });
  } });
  assert.equal(unpack(await client.callTool({ name: 'prepare_character_generation', arguments: { mediaID: slot.mediaID } })).jobID, 'character-gen-from-image');
});

test('auto-rigging needs model bytes but no config, and preserves native rigged deliverables', async t => {
  const filePath = await fixture(t, 'courier.glb');
  const slot = { characterID: 'char-upload-courier', fileExtension: 'glb', characterFileUploadURL: assetURL('original.glb'), configUploadURL: assetURL('config.json') };
  let uploaded = false, submitted = false;
  const client = await connect(t, async (url, options) => {
    if (url.pathname === '/characters/upload') {
      assert.deepEqual(JSON.parse(options.body), { fileExtension: 'glb', characterName: 'Courier' });
      return Response.json(slot);
    }
    if (url.pathname.endsWith('/submit')) {
      assert.equal(url.pathname, '/characters/char-upload-courier/submit');
      assert.deepEqual(JSON.parse(options.body), {});
      if (!uploaded) return new Response('Upload mesh first', { status: 400 });
      submitted = true;
      return Response.json({ characterID: slot.characterID, uploadStatus: 'AUTORIGGING_IN_PROGRESS' }, { status: 202 });
    }
    assert.ok(submitted);
    return Response.json({ characterID: slot.characterID, uploadStatus: 'COMPLETE', characterFileURL: assetURL('original.glb'), baseFbxURL: assetURL('base.fbx'), baseGlbURL: assetURL('base.glb'), configURL: assetURL('config.json') });
  });
  const upload = unpack(await client.callTool({ name: 'create_character_upload', arguments: { fileExtension: 'glb', characterName: 'Courier' } }));
  const args = { characterID: upload.characterID };
  assert.equal((await client.callTool({ name: 'submit_character_upload', arguments: args })).isError, true);
  await uploadAsset({ kind: 'character', filePath, upload, fetchImpl: async (url, options) => {
    assert.equal(url.href, upload.characterFileUploadURL);
    assert.equal(options.headers['x-api-key'], undefined);
    for await (const _ of options.body) { /* finish upload before submission */ }
    uploaded = true;
    return new Response(null, { status: 200 });
  } });
  assert.equal(unpack(await client.callTool({ name: 'submit_character_upload', arguments: args })).uploadStatus, 'AUTORIGGING_IN_PROGRESS');
  const character = unpack(await client.callTool({ name: 'get_character', arguments: args }));
  assert.equal(character.baseGlbURL, assetURL('base.glb'));
  assert.equal(character.baseFbxURL, assetURL('base.fbx'));
  assert.notEqual(character.characterFileURL, character.baseGlbURL);
});

test('character requests reject ambiguous inputs, unsupported formats and identity or storage overrides before transmission', async t => {
  const client = await connect(t, async () => assert.fail('Invalid input must not reach the API'));
  for (const [name, args] of [
    ['prepare_character_generation', {}],
    ['prepare_character_generation', { prompt: 'A courier', mediaID: 'media-1' }],
    ['prepare_character_generation', { prompt: ' \n ' }],
    ['prepare_character_generation', { prompt: 'a'.repeat(4001) }],
    ['prepare_character_generation', { mediaID: 'https://other.example/reference.png' }],
    ['prepare_character_generation', { prompt: 'A courier', characterName: 'Ignored upstream' }],
    ['prepare_character_generation', { prompt: 'A courier', createdByUser: 'other' }],
    ['submit_character_generation', { jobID: 'job-1', callbackURL: 'https://other.example' }],
    ['submit_character_generation', { jobID: '../other' }],
    ['create_character_upload', { fileExtension: 'zip' }],
    ['create_character_upload', { fileExtension: 'glb', thumbnailExtension: 'exe' }],
    ['create_character_upload', { fileExtension: 'glb', characterName: 'a'.repeat(201) }],
    ['create_character_upload', { fileExtension: 'glb', characterDescription: 'a'.repeat(1001) }],
    ['create_character_upload', { fileExtension: 'glb', s3Key: 'foreign-object' }],
    ['submit_character_upload', { characterID: 'x/../other' }],
    ['submit_character_upload', { characterID: 'char-1', uploadStatus: 'COMPLETE' }],
    ['submit_character_upload', { characterID: 'char-1', configURL: 'https://other.example' }],
  ]) assert.equal((await client.callTool({ name, arguments: args })).isError, true, `${name}: ${JSON.stringify(args)}`);
});

test('failed character operations stay visible and an API fallback character is rejected', async t => {
  const statuses = ['FAILED', 'ADJUSTMENT_FAILED', 'NEEDS_VALIDATION'];
  const client = await connect(t, async () => Response.json(statuses.length
    ? { characterID: 'char-upload-requested', uploadStatus: statuses.shift() }
    : { characterID: 'char-upload-Axel', uploadStatus: 'COMPLETE', baseGlbURL: assetURL('wrong-character.glb') }));
  for (const expected of ['FAILED', 'ADJUSTMENT_FAILED', 'NEEDS_VALIDATION']) {
    assert.equal(unpack(await client.callTool({ name: 'get_character', arguments: { characterID: 'char-upload-requested' } })).uploadStatus, expected);
  }
  const mismatch = await client.callTool({ name: 'get_character', arguments: { characterID: 'char-upload-requested' } });
  assert.equal(mismatch.isError, true);
  assert.match(unpack(mismatch).error, /requested character/);
  assert.doesNotMatch(JSON.stringify(mismatch), /wrong-character|X-Amz/);
});

test('ambiguous character mutations never retry or leak diagnostics and give operation-specific recovery', async t => {
  let count = 0;
  const client = await connect(t, async () => { count++; throw new Error('private-project-key signed-url-secret'); });
  const cases = [
    ['prepare_character_generation', { prompt: 'A courier' }, /consumed credits/],
    ['submit_character_generation', { jobID: 'character-gen-courier' }, /prepared jobID as characterID/],
    ['create_character_upload', { fileExtension: 'fbx' }, /slot may have been created/],
    ['submit_character_upload', { characterID: 'char-upload-courier' }, /get_character/],
  ];
  for (const [name, args, guidance] of cases) {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, true);
    assert.match(unpack(response).guidance, guidance);
    assert.doesNotMatch(JSON.stringify(response), /private-project-key|signed-url-secret/);
  }
  assert.equal(count, cases.length);
});

test('character preparation and submission allow synchronous model work beyond the normal request timeout', async t => {
  const client = await connect(t, async (_url, options) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(options.signal.aborted, false);
    return Response.json({ jobID: 'character-gen-courier' });
  }, { timeoutMs: 1 });
  for (const [name, args] of [['prepare_character_generation', { prompt: 'A courier' }], ['submit_character_generation', { jobID: 'character-gen-courier' }]]) {
    assert.equal((await client.callTool({ name, arguments: args })).isError, false);
  }
});

test('model, MJCF bundle, saved config and thumbnail uploads stream to their specific slots without credentials', async t => {
  const bytes = Buffer.from('explicitly selected asset bytes');
  const slot = { characterID: 'char-upload-test', fileExtension: 'fbx', characterFileUploadURL: assetURL('original.fbx'), configUploadURL: assetURL('config.json'), thumbnailUploadURL: assetURL('thumbnail.png') };
  for (const [kind, filename, upload, field, contentType] of [
    ['character', 'model.fbx', slot, 'characterFileUploadURL', 'application/octet-stream'],
    ['character', 'robot.zip', { ...slot, fileExtension: 'mjcf', characterFileUploadURL: assetURL('robot.zip') }, 'characterFileUploadURL', 'application/zip'],
    ['config', 'config.json', slot, 'configUploadURL', 'application/json'],
    ['thumbnail', 'thumbnail.png', slot, 'thumbnailUploadURL', 'image/png'],
  ]) {
    const filePath = await fixture(t, filename, bytes);
    const result = await uploadAsset({ kind, filePath, upload, fetchImpl: async (url, options) => {
      assert.equal(url.href, upload[field]);
      assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'PUT');
      assert.deepEqual(options.headers, { 'Content-Type': contentType, 'Content-Length': String(bytes.length) });
      const chunks = [];
      for await (const chunk of options.body) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), bytes);
      return new Response(null, { status: 200 });
    } });
    assert.deepEqual(result, { characterID: slot.characterID, kind, uploaded: true, bytes: bytes.length });
  }
});

test('upload helper rejects foreign destinations, unsigned URLs, absent slots, extension mismatches and empty files', async t => {
  const filePath = await fixture(t, 'model.glb');
  const slot = { characterID: 'char-upload-test', fileExtension: 'glb', characterFileUploadURL: assetURL('original.glb') };
  const fetchImpl = async () => assert.fail('Must not send file bytes');
  for (const characterFileUploadURL of [
    'https://attacker.example/model.glb?X-Amz-Signature=x',
    'http://cartwheel-mogen-resources.s3.amazonaws.com/x?X-Amz-Signature=x',
    'https://cartwheel-mogen-resources.s3.amazonaws.com/x',
    'https://cartwheel-mogen-resources.s3.amazonaws.com/x?X-Amz-Signature=',
    'https://user:password@cartwheel-mogen-resources.s3.amazonaws.com/x?X-Amz-Signature=x',
    'https://cartwheel-mogen-resources.s3.amazonaws.com:444/x?X-Amz-Signature=x',
    `${assetURL('original.glb')}#fragment`,
  ]) await assert.rejects(uploadAsset({ kind: 'character', filePath, upload: { ...slot, characterFileUploadURL }, fetchImpl }), /signed upload URL/);
  await assert.rejects(uploadAsset({ kind: 'character', filePath, upload: { ...slot, fileExtension: 'fbx' }, fetchImpl }), /format and asset ID/);
  await assert.rejects(uploadAsset({ kind: 'config', filePath: await fixture(t, 'config.json'), upload: slot, fetchImpl }), /missing a valid URL/);
  await assert.rejects(uploadAsset({ kind: 'character', filePath: await fixture(t, 'empty.glb', Buffer.alloc(0)), upload: slot, fetchImpl }), /nonempty/);
  await assert.rejects(uploadAsset({ kind: 'thumbnail', filePath: await fixture(t, 'thumb.jpg'), upload: { ...slot, thumbnailUploadURL: assetURL('thumb.png') }, fetchImpl }), /thumbnail extension/);
});

test('upload HTTP and transport failures are redacted and never retried', async t => {
  const filePath = await fixture(t, 'model.glb');
  const upload = { characterID: 'char-upload-test', fileExtension: 'glb', characterFileUploadURL: assetURL('original.glb') };
  let count = 0;
  for (const fail of [() => new Response('private storage diagnostics', { status: 403 }), () => { throw new Error(`private ${upload.characterFileUploadURL}`); }]) {
    await assert.rejects(uploadAsset({ kind: 'character', filePath, upload, fetchImpl: async () => { count++; return fail(); } }), error => {
      assert.match(error.message, /Asset upload failed/);
      assert.doesNotMatch(error.message, /private|https|X-Amz/);
      return true;
    });
  }
  assert.equal(count, 2);
});
