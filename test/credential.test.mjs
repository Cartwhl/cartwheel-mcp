import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { signCredentialRequest, motionConfig } from '../src/hosted-credential.mjs';
import { invokeHostedMotion } from '../src/hosted-motion.mjs';
import { HOSTED_JSON_LIMIT, projectHostedOutput } from '../src/tool-executor/hosted.cjs';
import { credential, fakeCredentials, slot } from './hosted-fixtures.mjs';

const config = motionConfig({ MCP_MOTION_ENABLED: 'true', MCP_USER_API_ENVIRONMENT: 'staging', MCP_USER_API_REGION: 'us-east-1',
  MCP_USER_API_URL: 'https://user-staging.api.getcartwheel.com/mcp/credential', STYTCH_PROJECT_ID: 'project-test-aaaa', STYTCH_CLIENT_ID: 'connected-app-test-bbbb' });
const token = 'nonsecret-oauth-test-token';
const generation = { prompt: 'Walk', characterID: 'character-1' };
const code = result => JSON.parse(result.content[0].text).code;
const hash = value => createHash('sha256').update(value).digest('hex');

test('credential request signs the fixed target, body and OAuth token with the configured AWS scope', async () => {
  const signingDate = new Date('2026-10-14T12:00:00Z');
  const signed = await signCredentialRequest(config, token, { credentials: fakeCredentials, signingDate });
  assert.equal(signed.body, '{}'); assert.equal(signed.method, 'POST'); assert.equal(signed.path, '/mcp/credential');
  assert.equal(signed.headers.host, 'user-staging.api.getcartwheel.com');
  assert.equal(signed.headers['x-amz-content-sha256'], hash('{}'));
  assert.equal(signed.headers['x-cartwheel-oauth-token'], token);
  assert.equal(signed.headers['x-amz-security-token'], fakeCredentials.sessionToken);
  const match = /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/(20261014\/us-east-1\/execute-api\/aws4_request), SignedHeaders=([^,]+), Signature=(\w+)$/.exec(signed.headers.authorization);
  assert.ok(match);
  const [, , signedHeaders] = match;
  for (const name of ['host', 'content-type', 'x-amz-date', 'x-amz-content-sha256', 'x-amz-security-token', 'x-cartwheel-oauth-token']) assert.ok(signedHeaders.split(';').includes(name));
  await assert.rejects(signCredentialRequest({ ...config, endpoint: 'https://evil.example/mcp/credential' }, token, { credentials: fakeCredentials }));
});

test('canonical credential URLs reject old route, aliases, query, credentials and redirects', async () => {
  for (const url of [config.endpoint + '?x=1', config.endpoint.replace('https:', 'http:'),
    config.endpoint.replace('/credential', '/invoke'), config.endpoint.replace('https://', 'https://user:password@')]) {
    assert.throws(() => motionConfig({ MCP_MOTION_ENABLED: 'true', MCP_USER_API_ENVIRONMENT: 'staging', MCP_USER_API_REGION: 'us-east-1',
      MCP_USER_API_URL: url, STYTCH_PROJECT_ID: 'project-test-aaaa', STYTCH_CLIENT_ID: 'connected-app-test-bbbb' }));
  }
  let attempts = 0;
  const result = await invokeHostedMotion(config, 'generate_motion', generation, token, 'challenge', { credentials: fakeCredentials,
    fetch: async (url, init) => {
      attempts++; assert.equal(url, config.endpoint); assert.equal(init.redirect, 'error');
      return new Response(null, { status: 307, headers: { Location: 'https://evil.example/' } });
    } });
  assert.equal(attempts, 1); assert.equal(code(result), 'connector_unavailable');
  assert.doesNotMatch(JSON.stringify(result), /may have been accepted/);
});

test('all argument and semantic validation happens before any AWS credentials or resolver call', async () => {
  let calls = 0;
  const dependencies = { credentials: async () => { calls++; throw new Error('Must not resolve'); }, fetch: async () => { calls++; throw new Error(); } };
  for (const [name, args] of [['generate_motion', { ...generation, createdByUser: 'spoof' }], ['fetch', { url: config.endpoint }],
    ['get_motion', { motionID: '../escape' }], ['save_key_poses', { ...slot, keyPoses: [
      { frame: 2, localJointRot: [[0, 0, 0]], rootPosition: [0, 0, 0], smoothRoot2d: [0, 0] },
      { frame: 1, localJointRot: [[0, 0, 0]], rootPosition: [0, 0, 0], smoothRoot2d: [0, 0] },
    ] }], ['save_key_poses', { ...slot, keyPoses: [], extra: 'x'.repeat(HOSTED_JSON_LIMIT) }]]) {
    assert.equal(code(await invokeHostedMotion(config, name, args, token, 'challenge', dependencies)), 'invalid_request');
  }
  assert.equal(calls, 0);
});

test('resolver and credential-provider failures are pre-submission, bounded, sanitized and single attempt', async () => {
  const secret = 'PRIVATE-KEY-RAW-RESPONSE';
  for (const resolve of [
    async () => { throw new Error(secret); },
    async () => new Response(secret, { status: 500 }),
    async () => Response.json({ ...credential(), apiKey: token }),
    async () => Response.json({ ...credential(), expiresAt: 0 }),
    async () => new Response('x'.repeat(HOSTED_JSON_LIMIT + 1)),
    async () => new Response(new ReadableStream({ start() {} })),
  ]) {
    let calls = 0;
    const result = await invokeHostedMotion(config, 'generate_motion', generation, token, 'challenge', {
      credentials: fakeCredentials, generationTimeoutMs: 10, fetch: async url => { calls++; assert.equal(url, config.endpoint); return resolve(); },
    });
    assert.equal(calls, 1); assert.equal(code(result), 'connector_unavailable');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-KEY|may have been accepted|nonsecret-oauth/);
  }
  let fetched = false;
  const result = await invokeHostedMotion(config, 'generate_motion', generation, token, 'challenge', {
    credentials: () => new Promise(() => {}), generationTimeoutMs: 5, fetch: async () => { fetched = true; },
  });
  assert.equal(code(result), 'connector_unavailable'); assert.equal(fetched, false);
});

test('no cross-request key cache; OAuth only to resolver, keys only to fixed external API, audit only on writes', async () => {
  let keys = 0;
  const seen = [];
  const fetch = async (url, init) => {
    if (url === config.endpoint) {
      assert.equal(init.headers['x-cartwheel-oauth-token'], token);
      assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256/);
      assert.equal(init.headers['x-api-key'], undefined); assert.equal(init.body, '{}');
      return Response.json({ ...credential(), apiKey: `key-${++keys}` });
    }
    assert.equal(new URL(url).origin, 'https://external-mogen-staging.api.getcartwheel.com');
    assert.equal(init.headers['x-cartwheel-oauth-token'], undefined); assert.equal(init.headers.authorization, undefined);
    assert.equal(init.redirect, 'error'); seen.push(init.headers['x-api-key']);
    if (url.endsWith('/motion/fromText')) {
      const body = JSON.parse(init.body);
      assert.equal(body.createdByUser, 'user-fixture'); assert.equal(body.requestedModel, 'swing');
      assert.deepEqual(body.swingProperties, { duration: 5, cfgScale: 7.5 });
      return Response.json({ batchID: 'b1', status: 'QUEUED' });
    }
    assert.equal(JSON.parse(init.body).createdByUser, undefined); // POST search is read-only.
    return Response.json({ items: [] });
  };
  for (const [name, args] of [['generate_motion', generation], ['generate_motion', generation], ['search_motions', { pageSize: 20 }]]) {
    assert.equal((await invokeHostedMotion(config, name, args, token, 'challenge', { credentials: fakeCredentials, fetch })).isError, false);
  }
  assert.deepEqual(seen, ['key-1', 'key-2', 'key-3']);
});

test('key/token reflections and raw API errors cannot reach the model; generic mutation 400 is uncertain', async () => {
  for (const response of [() => Response.json({ batchID: credential().apiKey, status: 'QUEUED' }),
    () => Response.json({ batchID: token, status: 'QUEUED' }), () => new Response('PRIVATE-RAW', { status: 400 }),
    () => { throw new Error(`PRIVATE-RAW ${token} ${credential().apiKey}`); }]) {
    let attempts = 0;
    const result = await invokeHostedMotion(config, 'generate_motion', generation, token, 'challenge', { credentials: fakeCredentials,
      fetch: async url => { if (url === config.endpoint) return Response.json(credential()); attempts++; return response(); } });
    assert.equal(attempts, 1); assert.equal(code(result), 'generation_outcome_unknown');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-RAW|fixture-api-key|nonsecret-oauth/);
  }
});

test('insufficient preflight budget or cancellation never submits; active API abort is uncertain and not retried', async () => {
  let apiCalls = 0;
  const controller = new AbortController();
  const fetch = async (url, init) => {
    if (url === config.endpoint) return Response.json(credential());
    apiCalls++; controller.abort(); assert.equal(init.signal.aborted, true);
    return new Promise(() => {});
  };
  assert.equal(code(await invokeHostedMotion(config, 'generate_motion', generation, token, 'challenge', {
    credentials: fakeCredentials, fetch, generationTimeoutMs: 21_000,
  })), 'authorization_too_slow');
  assert.equal(apiCalls, 0);
  assert.equal(code(await invokeHostedMotion(config, 'generate_motion', generation, token, 'challenge', {
    credentials: fakeCredentials, fetch, signal: controller.signal,
  })), 'generation_outcome_unknown');
  assert.equal(apiCalls, 1);
  assert.equal(code(await invokeHostedMotion(config, 'generate_motion', generation, token, 'challenge', {
    credentials: fakeCredentials, fetch, signal: controller.signal,
  })), 'connector_unavailable');
  assert.equal(apiCalls, 1);
});

test('pending assets and malformed optional numbers preserve legacy motion reads including numeric zero', () => {
  for (const value of ['0', null, -1]) {
    assert.deepEqual(projectHostedOutput('list_batch_motions', { items: [{ variationID: value, durationSeconds: value,
      bvhURL: '', exportURLs: [null, 'invalid'], variations: [{ variationID: value, durationSeconds: value }] }] }),
    { items: [{ exportURLs: [null, null], variations: [{}] }] });
  }
  assert.deepEqual(projectHostedOutput('get_motion', { variationID: 0, durationSeconds: 5 }), { variationID: 0, durationSeconds: 5 });
});
