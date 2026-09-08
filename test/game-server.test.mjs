import test from 'node:test';
import assert from 'node:assert/strict';
import { createExampleServer } from '../examples/game/serve.mjs';

function request(server, url, { host = '127.0.0.1:4173', method = 'GET' } = {}) {
  return new Promise(resolve => {
    const response = { status: 200, headers: {}, writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; }, end(body) { resolve({ status: this.status, headers: this.headers, body }); } };
    server.emit('request', { url, method, headers: { host } }, response);
  });
}
test('the local preview serves required modules and assets but rejects other hosts, writes and filesystem escape', async () => {
  const server = createExampleServer();
  for (const path of ['/', '/app.mjs', '/vendor/three/build/three.core.js', '/assets/walk.motion.json', '/assets/character.glb']) {
    const r = await request(server, path); assert.equal(r.status, 200, path); assert.ok(r.body.length > 20);
  }
  for (const path of ['/.env', '/../../src/index.mjs', '/vendor/three/../../package.json', '/assets/%2e%2e/secret.glb', '/serve.mjs']) assert.notEqual((await request(server, path)).status, 200, path);
  assert.equal((await request(server, '/', { host: 'attacker.example' })).status, 403);
  assert.equal((await request(server, '/', { method: 'POST' })).status, 403);
  const head = await request(server, '/assets/walk.bvh', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.body, undefined);
});
