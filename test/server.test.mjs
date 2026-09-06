import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer, definitions } from '../src/server.mjs';

async function connect(t, fetchImpl) {
  const server = createServer({ apiKey: 'test-secret', fetchImpl });
  const client = new Client({ name: 'test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
const unpack = response => JSON.parse(response.content[0].text);
const generation = {
  prompts: ['A person waving hello'], requestedModel: 'swing',
  exportSettings: { characterID: 'char-test', exportType: 'bvh', forward: 'Z', up: 'Y', frameRate: 30, frameStepSize: 1 },
};

test('MCP discovery, authenticated pagination and path encoding', async t => {
  const calls = [];
  const client = await connect(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ motions: [], nextToken: 'next' });
  });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 10);
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

test('generation submits the API body once and returns its batch ID', async t => {
  let count = 0;
  const client = await connect(t, async (url, options) => {
    count++;
    assert.equal(url.pathname, '/motion/fromText');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), generation);
    return Response.json({ batchID: 'batch-1' }, { status: 202 });
  });
  assert.equal(unpack(await client.callTool({ name: 'generate_motion', arguments: generation })).batchID, 'batch-1');
  assert.equal(count, 1);
});

test('invalid arguments and unknown tools never reach the API', async t => {
  const client = await connect(t, async () => { assert.fail('Must not call API'); });
  for (const [name, args] of [
    ['generate_motion', {}],
    ['generate_motion', { ...generation, requestedModel: 'invented' }],
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

test('real stdio process completes MCP initialization and discovery', async t => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))],
    env: { CARTWHEEL_API_KEY: 'test-only-never-sent' }, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-test', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), definitions.map(tool => tool.name));
  assert.equal((await client.listPrompts()).prompts[0].name, 'grounded_blender_scene');
  assert.match((await client.readResource({ uri: 'cartwheel://workflows/blender' })).contents[0].text, /Gaussian/);
});
