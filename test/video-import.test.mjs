import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { importVideo, validateVideoImport } from '../src/tool-executor/index.cjs';

const args = { downloadURL: 'https://files.oaiusercontent.com/private?sig=download-secret', extension: 'mp4', duration: 12 };
const slot = { mediaUploads: [{ mediaID: 'media-test', extension: 'mp4',
  mediaUploadURL: 'https://cartwheel-mogen-resources.s3.us-east-1.amazonaws.com/private?X-Amz-Signature=storage-secret' }] };
function source(chunks, headers = { 'content-length': '6' }, onCancel = () => {}) {
  return new Response(new ReadableStream({
    pull(controller) { if (chunks.length) controller.enqueue(Buffer.from(chunks.shift())); else controller.close(); },
    cancel: onCancel,
  }), { headers });
}
function transfer(download, { upload = slot, putStatus = 200, timeoutMs, signal } = {}) {
  const calls = [];
  let registered = 0;
  return { calls, get registered() { return registered; },
    run: () => importVideo(args, { timeoutMs, signal, createUpload: async (media, signal) => {
      registered++;
      assert.deepEqual(media, { media: [{ extension: 'mp4', name: 'video.mp4', duration: 12 }] });
      assert.equal(signal.aborted, false);
      return upload;
    }, fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers['x-api-key'], undefined);
      assert.equal(init.headers.Authorization, undefined);
      if (init.method === 'GET') return download;
      assert.deepEqual(init.headers, { 'Content-Type': 'video/mp4', 'Content-Length': '6' });
      const chunks = [];
      for await (const chunk of init.body) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString(), 'abcdef');
      return new Response(null, { status: putStatus });
    } }),
  };
}

test('exact attachment trust boundary rejects alternate schemes, hosts, credentials and URL tricks before I/O', async () => {
  for (const downloadURL of [
    'https://files.oaiusercontent.com.evil.example/x', 'https://evil.files.oaiusercontent.com/x',
    'https://oaiusercontent.com/x', 'https://files.oaiusercontent.com./x',
    'https://files.oaiusercontent.com:444/x', 'https://files.oaiusercontent.com:443/x',
    'https://user:secret@files.oaiusercontent.com/x', 'http://files.oaiusercontent.com/x',
    'https://127.0.0.1/x', 'https://[::1]/x', 'http://169.254.169.254/latest',
    'https://files%2eoaiusercontent.com/x', 'https://files.oaiusercontent.com\\@evil.example/x',
    'https://files.oaiusercontent.com/x#private', 'file:///tmp/video',
  ]) {
    assert.throws(() => validateVideoImport({ ...args, downloadURL }), { code: 'unsupported_attachment_host' });
    await assert.rejects(importVideo({ ...args, downloadURL }, {
      createUpload: () => assert.fail('No slot'), fetchImpl: () => assert.fail('No egress'),
    }), { code: 'unsupported_attachment_host' });
  }
  assert.throws(() => validateVideoImport({ ...args, duration: 31 }), { code: 'invalid_video_metadata' });
});

test('successful import streams exact bytes and returns no private capabilities', async () => {
  const fixture = transfer(source(['ab', 'cd', 'ef']));
  assert.deepEqual(await fixture.run(), { uploaded: true, mediaID: 'media-test', bytes: 6 });
  assert.equal(fixture.registered, 1);
  assert.equal(fixture.calls.length, 2);
});

test('unknown, invalid, oversized and encoded lengths fail before slot creation and cancel download', async () => {
  for (const headers of [{}, { 'content-length': '0' }, { 'content-length': '-1' },
    { 'content-length': '1.5' }, { 'content-length': '6,6' }, { 'content-length': '250000000' },
    { 'content-length': '9007199254740993' }, { 'content-length': '6', 'content-encoding': 'gzip' },
    { 'content-length': '6', 'content-range': 'bytes 0-5/12' },
    { 'content-length': '6', 'transfer-encoding': 'chunked' }]) {
    let cancelled = false;
    const fixture = transfer(source(['abcdef'], headers, () => { cancelled = true; }));
    const result = await fixture.run();
    assert.equal(result.uploaded, false);
    assert.equal(fixture.registered, 0);
    assert.equal(cancelled, true);
  }
});

test('false lengths and failed storage never claim success, retain safe slot ID, and never retry', async () => {
  for (const download of [source(['abc']), source(['abcdefg']), source(['abc', 'def', 'g'])]) {
    const fixture = transfer(download);
    const result = await fixture.run();
    assert.equal(result.uploaded, false);
    assert.equal(result.mediaID, 'media-test');
    assert.equal(fixture.calls.length, 2);
    assert.doesNotMatch(JSON.stringify(result), /secret|https/);
  }
  const fixture = transfer(source(['abcdef']), { putStatus: 403 });
  assert.deepEqual(await fixture.run(), { uploaded: false, code: 'storage_upload_failed', mediaID: 'media-test' });
  assert.equal(fixture.calls.length, 2);
});

test('untrusted storage slots do not receive a PUT; upstream diagnostics never escape', async () => {
  for (const mediaUploadURL of ['https://attacker.example/x?X-Amz-Signature=x',
    'https://cartwheel-mogen-resources.s3.amazonaws.com/x',
    'http://cartwheel-mogen-resources.s3.amazonaws.com/x?X-Amz-Signature=x',
    'https://secret@cartwheel-mogen-resources.s3.amazonaws.com/x?X-Amz-Signature=x']) {
    const fixture = transfer(source(['abcdef']), { upload: { mediaUploads: [{ ...slot.mediaUploads[0], mediaUploadURL }] } });
    assert.equal((await fixture.run()).code, 'invalid_upload_slot');
    assert.equal(fixture.calls.length, 1);
  }
  const result = await importVideo(args, { createUpload: () => assert.fail(), fetchImpl: async () => {
    throw new Error(args.downloadURL);
  } });
  assert.deepEqual(result, { uploaded: false, code: 'video_import_failed' });
});

test('one exact deadline bounds stalled fetch, slot creation, download reads and storage, including ignored abort', async () => {
  for (const stage of ['fetch', 'slot', 'read', 'put']) {
    let cancelled = false;
    const stalled = () => new Promise(() => {});
    const download = stage === 'read' ? new Response(new ReadableStream({
      pull: stalled, cancel() { cancelled = true; },
    }), { headers: { 'content-length': '6' } }) : source(['abcdef'], undefined, () => { cancelled = true; });
    const start = Date.now();
    const result = await importVideo(args, { timeoutMs: 30,
      createUpload: stage === 'slot' ? stalled : async () => slot,
      fetchImpl: (url, init) => init.method === 'GET' ? stage === 'fetch' ? stalled() : Promise.resolve(download) :
        stage === 'put' ? stalled() : (async () => { for await (const chunk of init.body) void chunk; return new Response(); })(),
    });
    assert.equal(result.uploaded, false);
    assert.equal(result.code, 'import_cancelled');
    assert.ok(Date.now() - start < 500);
    if (stage !== 'fetch') assert.equal(cancelled, true);
  }
});

test('native Node fetch sends a known-length streaming PUT without chunked encoding', async t => {
  let received;
  const server = createServer(async (req, res) => {
    if (req.url === '/download') { res.writeHead(200, { 'Content-Length': '6' }); res.end('abcdef'); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { headers: req.headers, bytes: Buffer.concat(chunks).toString() };
    res.writeHead(200); res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const result = await importVideo(args, { createUpload: async () => slot,
    // Backend test routing only: the helper still validates the real capability URLs.
    fetchImpl: (url, init) => fetch(`${base}/${init.method === 'GET' ? 'download' : 'storage'}`, init),
  });
  assert.equal(result.uploaded, true);
  assert.equal(received.bytes, 'abcdef');
  assert.equal(received.headers['content-length'], '6');
  assert.equal(received.headers['transfer-encoding'], undefined);
});

test('storage backpressure does not eagerly drain the attachment; caller cancellation cancels both streams', async () => {
  const controller = new AbortController();
  let pulls = 0, cancelled = false, putSignal;
  const result = await importVideo(args, { signal: controller.signal, createUpload: async () => slot,
    fetchImpl: async (url, init) => {
      if (init.method === 'GET') return new Response(new ReadableStream({
        pull(stream) { pulls++; stream.enqueue(new Uint8Array(64 * 1024)); },
        cancel() { cancelled = true; },
      }), { headers: { 'content-length': String(200 * 1024 * 1024) } });
      putSignal = init.signal;
      setTimeout(() => controller.abort(), 20);
      // Simulate a socket which has stopped accepting bytes.
      return new Promise(() => {});
    },
  });
  assert.equal(result.uploaded, false);
  assert.equal(result.mediaID, 'media-test');
  assert.equal(cancelled, true);
  assert.equal(putSignal.aborted, true);
  assert.ok(pulls <= 4, `Only a bounded number of chunks should be prefetched (${pulls})`);
});

test('early storage 2xx with zero or partial consumption and redirects never count as upload confirmation', async () => {
  for (const status of [200, 302, 307]) {
    const result = await importVideo(args, { createUpload: async () => slot,
      fetchImpl: async (url, init) => init.method === 'GET' ? source(['abcdef']) :
        new Response(null, { status, headers: { Location: 'http://169.254.169.254/' } }),
    });
    assert.equal(result.uploaded, false);
  }
  let uploadBody;
  const partial = await importVideo(args, { createUpload: async () => slot,
    fetchImpl: async (url, init) => {
      if (init.method === 'GET') return source([Buffer.alloc(65536), Buffer.alloc(32768)], { 'content-length': '98304' });
      uploadBody = init.body;
      const first = await uploadBody[Symbol.asyncIterator]().next();
      assert.equal(first.value.byteLength, 65536);
      // Let Readable.from prefetch the remaining chunk and finish its generator.
      await new Promise(setImmediate);
      assert.equal(uploadBody.readableLength, 32768);
      assert.equal(uploadBody.readableEnded, false);
      return new Response(null, { status: 200 });
    },
  });
  assert.deepEqual(partial, { uploaded: false, code: 'storage_upload_failed', mediaID: 'media-test' });
  assert.equal(uploadBody.destroyed, true);
  let created = false;
  const result = await importVideo(args, { createUpload: async () => { created = true; },
    fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } }),
  });
  assert.equal(result.code, 'attachment_download_failed');
  assert.equal(created, false);
});

test('native fetch early HTTP 200 after partial request bytes cannot confirm a large streaming PUT', { timeout: 5000 }, async t => {
  const bytes = 8 * 1024 * 1024;
  let received = 0, generated = 0, atResponse, uploadBody;
  const server = createServer((req, res) => {
    req.once('data', chunk => {
      received += chunk.byteLength;
      req.pause();
      // Deliberately violate normal storage behavior: reply without reading EOF.
      res.writeHead(200, { 'Content-Length': '0' });
      res.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await importVideo(args, { timeoutMs: 2000, createUpload: async () => slot,
    fetchImpl: async (url, init) => {
      if (init.method === 'GET') return new Response(new ReadableStream({
        pull(stream) {
          if (generated === bytes) { stream.close(); return; }
          generated += 65536;
          stream.enqueue(new Uint8Array(65536));
        },
      }), { headers: { 'Content-Length': String(bytes) } });
      uploadBody = init.body;
      const response = await fetch(`http://127.0.0.1:${server.address().port}/storage`, init);
      atResponse = { ended: uploadBody.readableEnded, status: response.status };
      return response;
    },
  });
  assert.ok(received > 0 && received < bytes, `Server consumed ${received}/${bytes} bytes`);
  assert.deepEqual(atResponse, { ended: false, status: 200 });
  assert.deepEqual(result, { uploaded: false, code: 'storage_upload_failed', mediaID: 'media-test' });
  assert.equal(uploadBody.destroyed, true);
  t.diagnostic(`Early HTTP 200: server read ${received}/${bytes} bytes; source produced ${generated}; upload readableEnded=${atResponse.ended}`);
});

test('a fully consumed PUT 2xx observed at the deadline cannot become success', async t => {
  const now = Date.now();
  let elapsed = 0;
  t.mock.method(Date, 'now', () => now + elapsed);
  const result = await importVideo(args, { timeoutMs: 1000, createUpload: async () => slot,
    fetchImpl: async (url, init) => {
      if (init.method === 'GET') return source(['abcdef']);
      for await (const chunk of init.body) void chunk;
      elapsed = 1000;
      return new Response(null, { status: 200 });
    },
  });
  assert.deepEqual(result, { uploaded: false, code: 'import_cancelled', mediaID: 'media-test' });
});
