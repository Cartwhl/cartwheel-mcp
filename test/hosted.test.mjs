import test from 'node:test';
import { credential, credentialTransport, fakeCredentials, extensionArguments, extensionOutputs, realisticKeyPoses, slot } from './hosted-fixtures.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import Ajv from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHostedServer, createTokenVerifier, hostedConfig } from '../src/hosted-server.mjs';
import { invokeHostedMotion as invokeMotion, motionTools } from '../src/hosted-motion.mjs';
import { HOSTED_JSON_LIMIT } from '../src/tool-executor/hosted.cjs';

const env = {
  MCP_PUBLIC_URL: 'https://mcp.example/mcp',
  STYTCH_ISSUER: 'https://auth.example',
  STYTCH_PROJECT_ID: 'project-test-00000000-0000-0000-0000-000000000001',
  STYTCH_CLIENT_ID: 'connected-app-test-00000000-0000-0000-0000-000000000002',
};
const config = hostedConfig(env);
const claudeID = 'connected-app-test-00000000-0000-0000-0000-000000000003';
const keys = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const jwks = createLocalJWKSet({ keys: [jwk] });
const now = () => Math.floor(Date.now() / 1000);
const invokeHostedMotion = (config, name, args, token, challenge, deps = {}) => invokeMotion(config, name, args, token, challenge,
  { ...deps, credentials: fakeCredentials, fetch: credentialTransport(deps.fetch, deps.credentialFetch) });
const token = (claims = {}, header = {}, key = keys.privateKey) => new SignJWT({
  iss: config.issuer, aud: [config.projectId, config.resource], sub: 'user-test-alice',
  exp: now() + 300, iat: now() - 1, nbf: now() - 1, jti: 'token-one',
  client_id: config.clientId, scope: 'openid profile', ...claims,
}).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'test-key', ...header }).sign(key);

// Model HTTPS termination preserving the public Host over a real loopback socket.
// Node fetch may override Host; node:http deliberately lets this fixture set it.
function proxyFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      method: options.method, signal: options.signal,
      headers: Object.fromEntries(new Headers(options.headers)),
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), {
        status: res.statusCode, headers: res.headers,
      })));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

async function start(t, options = {}, serverConfig = config) {
  const server = createHostedServer(serverConfig, { jwks, ...options, credentials: fakeCredentials,
    fetch: credentialTransport(options.fetch, options.credentialFetch) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    url: new URL(`${base}/mcp`),
    request: (path = '/mcp', options = {}) => proxyFetch(`${base}${path}`, {
      ...options, headers: { Host: config.host, ...options.headers },
    }),
  };
}

async function connect(t, url, accessToken) {
  const transport = new StreamableHTTPClientTransport(url, { fetch: proxyFetch, requestInit: {
    headers: { Host: config.host, Authorization: `Bearer ${accessToken}` },
  } });
  const client = new Client({ name: 'hosted-test', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  return client;
}

test('config requires explicit canonical URLs and pre-registration; loopback only for HTTP development', () => {
  assert.equal(config.listenHost, '127.0.0.1');
  assert.equal(config.port, 3001);
  for (const name of ['MCP_PUBLIC_URL', 'STYTCH_ISSUER', 'STYTCH_PROJECT_ID', 'STYTCH_CLIENT_ID']) {
    assert.throws(() => hostedConfig({ ...env, [name]: undefined }), undefined, name);
  }
  for (const url of ['http://mcp.example/mcp', 'https://mcp.example', 'https://mcp.example/mcp/',
    'https://mcp.example/mcp?q=x', 'https://mcp.example/mcp#x', 'https://user:secret@mcp.example/mcp']) {
    assert.throws(() => hostedConfig({ ...env, MCP_PUBLIC_URL: url }), undefined, url);
  }
  for (const url of ['http://localhost:3000', 'stytch.com/project-test-123', 'https://auth.example/', 'https://auth.example/path']) {
    assert.throws(() => hostedConfig({ ...env, STYTCH_ISSUER: url }), undefined, url);
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(hostedConfig({ ...env, MCP_PUBLIC_URL: `http://${host}:3001/mcp` }).host, `${host}:3001`);
  }
  for (const port of ['0', '-1', '65536', '1.2', 'no']) assert.throws(() => hostedConfig({ ...env, PORT: port }));
  assert.throws(() => hostedConfig({ ...env, MCP_ALLOWED_ORIGINS: '*' }));
  assert.throws(() => hostedConfig({ ...env, MCP_ALLOWED_ORIGINS: 'https://chatgpt.com/' }));
});

test('optional Claude accepts only its configured ID, preserves profile identity and forwards its original token', async t => {
  const two = hostedConfig({ ...motionEnv, MCP_CLAUDE_CLIENT_ID: claudeID });
  const verify = createTokenVerifier(two, jwks);
  const claudeToken = await token({ client_id: claudeID });
  assert.deepEqual(await verify(claudeToken), await verify(await token()));
  await assert.rejects(createTokenVerifier(config, jwks)(claudeToken));
  await assert.rejects(verify(await token({ client_id: 'connected-app-test-unregistered' })));
  for (const id of [env.STYTCH_CLIENT_ID, 'connected-app-live-aaaa', 'arbitrary']) {
    assert.throws(() => hostedConfig({ ...env, MCP_CLAUDE_CLIENT_ID: id }));
  }
  const calls = [];
  const { url } = await start(t, { credentialFetch: async (_url, options) => {
    calls.push(options); return Response.json(credential());
  }, fetch: async () => Response.json({ characters: [] }) }, two);
  const client = await connect(t, url, claudeToken);
  assert.equal((await client.callTool({ name: 'list_characters' })).isError, false);
  assert.equal(calls[0].headers['x-cartwheel-oauth-token'], claudeToken);
  assert.match(calls[0].headers.authorization, /^AWS4-HMAC-SHA256 /);
  assert.deepEqual(JSON.parse(calls[0].body), {});
});

test('public metadata and unauthenticated challenge use configuration, not forwarded headers', async t => {
  const { request } = await start(t);
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const response = await request(path, { headers: { 'X-Forwarded-Host': 'attacker.example' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      resource: config.resource, authorization_servers: [config.issuer],
      scopes_supported: ['openid', 'profile'], bearer_methods_supported: ['header'],
    });
  }
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await request('/mcp', { method });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('WWW-Authenticate'), `Bearer resource_metadata="${config.metadataURL}", scope="openid profile"`);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    await response.text();
  }
  const queryToken = await request(`/mcp?access_token=${await token()}`);
  assert.equal(queryToken.status, 401);
  await queryToken.text();
});

test('HTTP rejects invalid, expired, cross-issuer/resource/client and non-access tokens', async t => {
  const { request } = await start(t);
  const otherKeys = await generateKeyPair('RS256');
  const cases = {
    malformed: 'not-a-jwt',
    signature: await token({}, {}, otherKeys.privateKey),
    expired: await token({ exp: now() - 1 }),
    future: await token({ nbf: now() + 60 }),
    issuer: await token({ iss: 'https://other.example' }),
    projectOnly: await token({ aud: [config.projectId] }),
    resourceOnly: await token({ aud: [config.resource] }),
    client: await token({ client_id: 'connected-app-test-other' }),
    idToken: await token({ aud: [config.clientId], client_id: undefined, scope: undefined }),
    sessionWithCustomClaims: await token({ 'https://stytch.com/session': {} }),
    machineIdentity: await token({ sub: 'm2m-client-test-123' }),
    refreshType: await token({ token_type: 'refresh_token' }),
    wrongAlgorithm: await token({}, { alg: 'HS256' }, new Uint8Array(32)),
  };
  for (const claim of ['exp', 'iat', 'nbf', 'sub', 'aud', 'jti', 'client_id', 'scope']) {
    cases[`missing ${claim}`] = await token({ [claim]: undefined });
  }
  for (const [name, jwt] of Object.entries(cases)) {
    const response = await request('/mcp', { headers: { Authorization: `Bearer ${jwt}` } });
    assert.equal(response.status, 401, name);
    assert.match(response.headers.get('WWW-Authenticate'), /error="invalid_token"/);
    assert.match(response.headers.get('WWW-Authenticate'), /resource_metadata=/);
    const text = await response.text();
    assert.equal(text, '{"error":"invalid_token"}');
    assert.ok(!text.includes(jwt));
  }
  for (const scope of ['openid', 'openid profile:read']) {
    const response = await request('/mcp', { headers: { Authorization: `Bearer ${await token({ scope })}` } });
    assert.equal(response.status, 403, scope);
    assert.match(response.headers.get('WWW-Authenticate'), /scope="openid profile".*error="insufficient_scope"/);
    await response.text();
  }
});

test('real HTTP MCP initialize/list/call exposes only the profile, with isolated stable identities', async t => {
  const { url } = await start(t);
  const [alice, bob, refreshed] = await Promise.all([
    connect(t, url, await token({ name: 'Alice', email: 'private@example.com', custom: 'secret' })),
    connect(t, url, await token({ sub: 'user-test-bob' })),
    connect(t, url, await token({ jti: 'new-token', name: 'Changed', scope: 'openid profile email' })),
  ]);
  assert.equal(alice.getServerVersion().name, 'cartwheel-profile');
  assert.deepEqual(alice.getServerCapabilities(), { tools: {} });
  const { tools } = await alice.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['get_profile']);
  const tool = tools[0];
  assert.equal(tool._meta['openai/profile'], true);
  // The standard SDK client strips unknown top-level tool extensions; assert
  // securitySchemes on the wire below and its compatibility mirror here.
  assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['openid', 'profile'] }]);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
  assert.deepEqual(tool.outputSchema.required, ['id']);
  assert.equal(tool.outputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(tool.outputSchema.properties), ['id', 'name', 'email', 'nickname']);
  const validate = new Ajv().compile(tool.outputSchema);
  const clients = [alice, bob, refreshed, bob, alice];
  const results = await Promise.all(clients.map(client => client.callTool({ name: 'get_profile', arguments: {} })));
  for (const result of results) {
    assert.equal(result.isError, false);
    assert.ok(validate(result.structuredContent));
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.deepEqual(Object.keys(result.structuredContent), ['id']);
    assert.doesNotMatch(JSON.stringify(result), /user-test|private@|secret|Changed|Alice/);
  }
  const ids = results.map(result => result.structuredContent.id);
  assert.equal(ids[0], ids[2]);
  assert.equal(ids[0], ids[4]);
  assert.equal(ids[1], ids[3]);
  assert.notEqual(ids[0], ids[1]);
  // Lock the identity algorithm so future refactors do not silently relabel profiles.
  assert.equal(ids[0], `prf_${createHash('sha256').update(JSON.stringify([config.issuer, 'user-test-alice'])).digest('base64url')}`);
  for (const [name, args] of [['get_profile', { id: 'user-test-bob' }], ['generate_motion', {}], ['get_profile', { email: 'x' }]]) {
    assert.equal((await alice.callTool({ name, arguments: args })).isError, true);
  }
});

test('host, origin, body limits and stateless transport boundaries', async t => {
  const { request } = await start(t);
  const auth = { Authorization: `Bearer ${await token()}` };
  for (const [headers, expected] of [[{ Host: 'evil.example' }, 421], [{ Origin: 'https://evil.example' }, 403], [{ Origin: 'null' }, 403], [{ Origin: '' }, 403]]) {
    const response = await request('/mcp', { headers: { ...auth, ...headers } });
    assert.equal(response.status, expected);
    await response.text();
  }
  const preflight = await request('/mcp', { method: 'OPTIONS', headers: { Origin: 'https://mcp.example' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://mcp.example');
  for (const method of ['GET', 'DELETE']) {
    const response = await request('/mcp', { method, headers: auth });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'POST, OPTIONS');
    await response.text();
  }
  for (const [body, expected] of [['{broken', 400], [' '.repeat(17000), 413]]) {
    const response = await request('/mcp', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, expected);
    await response.text();
  }
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const response = await request('/mcp', {
    method: 'POST', headers: { ...auth, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25' },
    body: JSON.stringify(list),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Mcp-Session-Id'), null);
  const wireTool = (await response.json()).result.tools[0];
  assert.equal(wireTool.name, 'get_profile');
  assert.deepEqual(wireTool.securitySchemes, [{ type: 'oauth2', scopes: ['openid', 'profile'] }]);
  const withoutToken = await request('/mcp', {
    method: 'POST', headers: { 'Mcp-Session-Id': 'someone-elses-session' }, body: JSON.stringify(list),
  });
  assert.equal(withoutToken.status, 401);
  await withoutToken.text();
  // Initialization/discovery never grants authority to later requests, even on
  // a reused connection. Expiration and scopes are checked again for tool calls.
  for (const [claims, status] of [[{ exp: now() - 1 }, 401], [{ scope: 'openid' }, 403]]) {
    const denied = await request('/mcp', {
      method: 'POST', headers: {
        Authorization: `Bearer ${await token(claims)}`, Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json', 'Mcp-Session-Id': 'reused-session',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_profile', arguments: {} } }),
    });
    assert.equal(denied.status, status);
    await denied.text();
  }
});

test('failed key lookup fails closed without leaking diagnostics', async t => {
  const { request } = await start(t, { jwks: async () => { throw new Error('token-and-secret-diagnostic'); } });
  const response = await request('/mcp', { headers: { Authorization: `Bearer ${await token()}` } });
  assert.equal(response.status, 401);
  assert.equal(await response.text(), '{"error":"invalid_token"}');
});

const motionEnv = { ...env, MCP_MOTION_ENABLED: 'true', MCP_USER_API_ENVIRONMENT: 'staging',
  MCP_USER_API_REGION: 'us-east-1', MCP_USER_API_URL: 'https://user-staging.api.getcartwheel.com/mcp/credential' };
const enabled = hostedConfig(motionEnv);
const challenge = `Bearer resource_metadata="${config.metadataURL}", scope="openid profile"`;

test('motion opt-in fails safe with exact canonical trusted environment endpoints', () => {
  assert.equal(config.motion, undefined);
  assert.equal(hostedConfig({ ...motionEnv, MCP_MOTION_ENABLED: 'false', MCP_USER_API_URL: 'https://evil.example' }).motion, undefined);
  assert.equal(enabled.motion.endpoint, motionEnv.MCP_USER_API_URL);
  for (const changes of [
    { MCP_MOTION_ENABLED: 'TRUE' }, { MCP_USER_API_ENVIRONMENT: undefined },
    { MCP_USER_API_ENVIRONMENT: 'production' }, { MCP_USER_API_REGION: undefined },
    { MCP_USER_API_URL: 'https://evil.example/mcp/credential' },
  ]) assert.throws(() => hostedConfig({ ...motionEnv, ...changes }));
  assert.equal(hostedConfig({ ...motionEnv, MCP_USER_API_ENVIRONMENT: 'production',
    MCP_USER_API_URL: 'https://user.api.getcartwheel.com/mcp/credential',
    STYTCH_PROJECT_ID: env.STYTCH_PROJECT_ID.replace('-test-', '-live-'),
    STYTCH_CLIENT_ID: env.STYTCH_CLIENT_ID.replace('-test-', '-live-'),
  }).motion.endpoint, 'https://user.api.getcartwheel.com/mcp/credential');
});

test('motion schema contracts reject extra identity/routing hints and unsupported generation options', () => {
  const ajv = new Ajv();
  const cases = {
    list_characters: [{}, { limit: 50, nextToken: 'cursor' }],
    generate_motion: [{ prompt: 'Walk forward', characterID: 'job-1' },
      { prompt: 'Run', characterID: 'job-1', durationSeconds: 3.5, exportType: 'bvh' }],
    get_batch: [{ batchID: 'batch-1' }],
    list_batch_motions: [{ batchID: 'batch-1' }, { batchID: 'batch-1', limit: 1, nextToken: 'cursor' }],
    ...extensionArguments,
  };
  for (const tool of motionTools) {
    const validate = ajv.compile(tool.inputSchema);
    for (const args of cases[tool.name]) {
      assert.ok(validate(args), tool.name);
      assert.ok(!validate({ ...args, apiKey: 'caller-selected-key' }));
    }
    const writing = ['generate_motion', 'create_scene', 'save_key_poses', 'export_scene'].includes(tool.name);
    assert.deepEqual(tool.annotations, { readOnlyHint: !writing, destructiveHint: ['generate_motion', 'save_key_poses'].includes(tool.name),
      idempotentHint: !writing || tool.name === 'save_key_poses', openWorldHint: false });
    assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes);
    assert.equal(tool._meta['openai/profile'], undefined);
  }
  const generation = ajv.compile(motionTools.find(tool => tool.name === 'generate_motion').inputSchema);
  for (const changes of [{ prompt: ' ' }, { characterID: '../x' },
    { durationSeconds: 2 }, { durationSeconds: 9 }, { loop: true }]) {
    assert.ok(!generation({ ...cases.generate_motion[0], ...changes }));
  }
});

test('enabled real HTTP tools forward original verified per-request identity, never cross-user or metadata', async t => {
  const calls = [];
  const resolutions = [];
  const { url, request } = await start(t, { credentialFetch: async (url, options) => {
    resolutions.push({ url, options });
    return Response.json({ ...credential(), apiKey: `key-${createHash('sha256').update(options.headers['x-cartwheel-oauth-token']).digest('hex')}` });
  }, fetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ batchID: 'batch-1', status: 'pending', secret: 'raw-secret' });
  } }, enabled);
  const aliceToken = await token();
  const bobToken = await token({ sub: 'user-test-bob' });
  const refreshedToken = await token({ jti: 'refreshed' });
  const [alice, bob, refreshed] = await Promise.all([connect(t, url, aliceToken), connect(t, url, bobToken), connect(t, url, refreshedToken)]);
  assert.deepEqual((await alice.listTools()).tools.map(tool => tool.name), ['get_profile', ...motionTools.map(tool => tool.name)]);
  const args = { prompt: 'Walk', characterID: 'character-1' };
  await Promise.all([alice, bob, refreshed].map(client => client.callTool({ name: 'generate_motion', arguments: args,
    _meta: { 'openai/subject': 'someone-else', userID: 'user-test-other' } })));
  assert.deepEqual(new Set(resolutions.map(call => call.options.headers['x-cartwheel-oauth-token'])), new Set([aliceToken, bobToken, refreshedToken]));
  assert.deepEqual(new Set(calls.map(call => call.options.headers['x-api-key'])),
    new Set([aliceToken, bobToken, refreshedToken].map(value => `key-${createHash('sha256').update(value).digest('hex')}`)));
  for (const { url, options } of calls) {
    assert.equal(url, 'https://external-mogen-staging.api.getcartwheel.com/motion/fromText');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Content-Type', 'x-api-key']);
    assert.deepEqual(JSON.parse(options.body).prompts, ['Walk']);
    assert.equal(JSON.parse(options.body).createdByUser, 'user-fixture');
  }
  const profiles = await Promise.all([alice, bob, refreshed].map(client => client.callTool({ name: 'get_profile' })));
  assert.deepEqual(profiles[0], profiles[2]);
  assert.notDeepEqual(profiles[0], profiles[1]);
  assert.equal(calls.length, 3);
  assert.equal(resolutions.length, 3);
  await alice.callTool({ name: 'generate_motion', arguments: { ...args, userID: 'other' } });
  assert.equal(calls.length, 3);
  const denied = await request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${await token({ aud: [config.projectId] })}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'generate_motion', arguments: args } }) });
  assert.equal(denied.status, 401);
  await denied.text();
  assert.equal(calls.length, 3);
});

test('motion results are exact projected schemas, preserve signed assets and sanitize untrusted responses', async () => {
  const signed = 'https://assets.s3.amazonaws.com/file.glb?X-Amz-Signature=intentional';
  const samples = {
    ...extensionOutputs,
    list_characters: { characters: [{ jobID: 'c1', characterName: 'Character', uploadStatus: 'complete', extension: 'fbx' }], nextToken: 'next' },
    generate_motion: { batchID: 'b1', status: 'pending', numTotalJobs: 1, estimatedSecondsWaitTime: 20 },
    get_batch: { batchID: 'b1', status: 'complete', numSucceededJobs: 1, numFailedJobs: 0 },
    list_batch_motions: { items: [{ jobID: 'm1', status: 'complete', variationID: 0, title: 'Walk', durationSeconds: 5,
      bvhURL: signed, studioPreviewURL: 'https://studio.getcartwheel.com/preview', bvhURLs: [signed, null],
      exportURLs: [signed], variations: [{ variationID: 0, exportURLs: [signed] }, { variationID: 1, exportURLs: [signed] }] }], nextToken: 'next', hasMore: true },
  };
  for (const tool of motionTools) {
    const original = samples[tool.name];
    const dirty = structuredClone(original);
    dirty.apiKey = 'raw-secret'; dirty._meta = { token: 'raw-secret' };
    for (const entry of [...(dirty.items ?? []), ...(dirty.characters ?? [])]) {
      entry.secret = 'raw-secret';
      for (const variation of entry.variations ?? []) variation.secret = 'raw-secret';
    }
    const args = extensionArguments[tool.name]?.[0] ?? (tool.name === 'generate_motion' ? { prompt: 'Walk', characterID: 'c1' } :
      tool.name === 'list_characters' ? {} : { batchID: 'b1' });
    const result = await invokeHostedMotion(enabled.motion, tool.name, args, 'verified-token', challenge, { fetch: async () => Response.json(dirty) });
    assert.equal(result.isError, false);
    assert.deepEqual(result.structuredContent, original);
    assert.deepEqual(JSON.parse(result.content[0].text), original);
    assert.ok(new Ajv().compile(tool.outputSchema)(result.structuredContent));
  }
  for (const data of [{ batchID: 'b', status: 'Bearer secret' }, { batchID: 'verified-token', status: 'pending' }, {}, { batchID: 'b', status: {} }]) {
    const result = await invokeHostedMotion(enabled.motion, 'generate_motion', { prompt: 'Walk', characterID: 'c1' }, 'verified-token', challenge,
      { fetch: async () => Response.json(data) });
    assert.equal(JSON.parse(result.content[0].text).code, 'generation_outcome_unknown');
    assert.doesNotMatch(JSON.stringify(result), /verified-token|Bearer secret/);
  }
  const urls = await invokeHostedMotion(enabled.motion, 'list_batch_motions', { batchID: 'b1' }, 'token', challenge, {
    fetch: async () => Response.json({ items: [{ exportURLs: ['https://evil.example/file', 'https://getcartwheel.com.evil.example/file', 'http://assets.s3.amazonaws.com/file', signed] }] }),
  });
  assert.deepEqual(urls.structuredContent, { items: [{ exportURLs: [null, null, null, signed] }] });
});

test('scene objects and edit outputs strip nested metadata; new mutation failures are nonretryable', async () => {
  const dirty = structuredClone(extensionOutputs.create_scene);
  dirty.createdByUser = 'private-metadata';
  dirty.objects.character.apiKey = 'private-metadata';
  dirty.objects.character.timeline[0].s3KeyBvh = 'private-metadata';
  const result = await invokeHostedMotion(enabled.motion, 'create_scene', extensionArguments.create_scene[0], 'verified-token', challenge,
    { fetch: async () => Response.json(dirty) });
  assert.deepEqual(result.structuredContent, extensionOutputs.create_scene);
  assert.doesNotMatch(JSON.stringify(result), /private-metadata/);
  for (const operation of ['create_scene', 'save_key_poses', 'export_scene']) {
    let attempts = 0;
    const failure = await invokeHostedMotion(enabled.motion, operation, extensionArguments[operation][0], 'verified-token', challenge,
      { fetch: async () => { attempts++; throw new Error('private-metadata'); } });
    assert.equal(attempts, 1);
    assert.equal(JSON.parse(failure.content[0].text).code, 'mutation_outcome_unknown');
    assert.equal(JSON.parse(failure.content[0].text).retryable, false);
    assert.doesNotMatch(JSON.stringify(failure), /private-metadata/);
  }
});

test('backend auth/status/errors never fall through; no retries or raw messages/headers', async t => {
  const { url } = await start(t, { credentialFetch: async () => Response.json({ code: 'invalid_token', message: 'Bearer raw-secret' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer secret=raw-secret' } }) }, enabled);
  const client = await connect(t, url, await token());
  const result = await client.callTool({ name: 'list_characters' });
  assert.equal(result.isError, true);
  assert.equal(result._meta['mcp/www_authenticate'], `${challenge}, error="invalid_token"`);
  assert.deepEqual(JSON.parse(result.content[0].text), { code: 'invalid_token', message: 'Reconnect to Cartwheel with a valid access token.', retryable: false });
  assert.equal((await client.listTools()).tools.length, 17);
  for (const [status, code, expected] of [[403, 'connection_required', 'connection_required'],
    [503, 'identity_provider_unavailable', 'identity_provider_unavailable'], [500, 'secret-code', 'connector_unavailable']]) {
    let calls = 0;
    const result = await invokeHostedMotion(enabled.motion, 'generate_motion', { prompt: 'Walk', characterID: 'c1' }, 'token', challenge, {
      credentialFetch: async () => { calls++; return Response.json({ code, message: 'raw-secret', retryable: true, apiKey: 'raw-secret' }, { status }); },
    });
    assert.equal(calls, 1);
    assert.equal(JSON.parse(result.content[0].text).code, expected);
    assert.equal(JSON.parse(result.content[0].text).retryable, false);
    assert.doesNotMatch(JSON.stringify(result), /raw-secret|secret-code/);
    if (code === 'identity_provider_unavailable') {
      assert.equal(JSON.parse(result.content[0].text).message, 'Authorization could not be verified. Restart from your MCP client.');
    }
  }
});

test('timeouts, redirects, malformed and transport failures leave generation outcome unknown with one attempt', async () => {
  const failures = [
    async () => { throw new Error('raw-secret'); },
    async () => new Response('raw-secret', { status: 502 }),
    async () => new Response('{invalid', { status: 200 }),
    async () => new Response('x'.repeat(HOSTED_JSON_LIMIT + 1), { status: 200 }),
    async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }),
    async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('raw-secret')), { once: true })),
    async (_, { signal }) => new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(new Error('raw-secret')), { once: true });
    } })),
  ];
  for (const fetch of failures) {
    for (const operation of ['generate_motion', 'list_characters']) {
      let attempts = 0;
      const result = await invokeHostedMotion(enabled.motion, operation,
        operation === 'generate_motion' ? { prompt: 'Walk', characterID: 'c1' } : {}, 'token', challenge, {
          executionTimeoutMs: 5, fetch: (...args) => { attempts++; return fetch(...args); },
        });
      assert.equal(attempts, 1);
      assert.deepEqual(JSON.parse(result.content[0].text), {
        code: operation === 'generate_motion' ? 'generation_outcome_unknown' : 'motion_unavailable',
        message: operation === 'generate_motion' ? 'Generation may have been accepted. Do not automatically resubmit. Inspect your Cartwheel batches before trying again.' : 'Motion data could not be retrieved.',
        retryable: false,
      });
    }
  }
});

test('real hosted HTTP saves the maximum pose payload intact and rejects malformed poses', async t => {
  const calls = [];
  const { url } = await start(t, { fetch: async (url, options) => {
    assert.equal(url, 'https://external-mogen-staging.api.getcartwheel.com/scenes/scene-1/objects/character/0/keyPoses');
    assert.ok(Buffer.byteLength(options.body) <= HOSTED_JSON_LIMIT);
    calls.push(JSON.parse(options.body));
    return new Response(null, { status: 204 });
  } }, enabled);
  const client = await connect(t, url, await token());
  const args = { ...slot, keyPoses: realisticKeyPoses(300) };
  assert.ok(Buffer.byteLength(JSON.stringify(args)) > 20000);
  const response = await client.callTool({ name: 'save_key_poses', arguments: args });
  assert.equal(response.isError, false);
  assert.deepEqual(response.structuredContent, { status: 204 });
  assert.deepEqual(calls[0], { keyPoses: args.keyPoses, createdByUser: 'user-fixture' });
  const invalid = await client.callTool({ name: 'save_key_poses', arguments: { ...slot, keyPoses: [{ frame: 0 }] } });
  assert.equal(invalid.isError, true);
  assert.equal(calls.length, 1);
});

test('enabled ingress and response streams reject above 1 MiB, and profile-only keeps 16 KiB', async t => {
  let calls = 0;
  const { request } = await start(t, { fetch: async () => { calls++; return Response.json({ status: 204 }); } }, enabled);
  const auth = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_key_poses', arguments: { ...slot, keyPoses: [] } } });
  assert.equal((await request('/mcp', { method: 'POST', headers: auth, body: body.padEnd(HOSTED_JSON_LIMIT, ' ') })).status, 200);
  const rejected = await request('/mcp', { method: 'POST', headers: auth, body: body.padEnd(HOSTED_JSON_LIMIT + 1, ' ') });
  assert.equal(rejected.status, 413);
  assert.deepEqual(await rejected.json(), { error: 'invalid_request' });
  const profile = await start(t);
  assert.equal((await profile.request('/mcp', { method: 'POST', headers: auth, body: body.padEnd(16 * 1024 + 1, ' ') })).status, 413);
  assert.equal(calls, 1);
  // A chunked, otherwise valid read response is bounded before parsing/projecting.
  const output = JSON.stringify(extensionOutputs.get_scene).padEnd(HOSTED_JSON_LIMIT + 1, ' ');
  const result = await invokeHostedMotion(enabled.motion, 'get_scene', { sceneID: slot.sceneID }, 'verified-token', challenge, {
    fetch: async () => new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < output.length; i += 8192) controller.enqueue(Buffer.from(output.slice(i, i + 8192)));
      controller.close();
    } })),
  });
  assert.equal(JSON.parse(result.content[0].text).code, 'motion_unavailable');
});
