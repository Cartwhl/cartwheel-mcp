import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uploadVideo } from '../examples/comic4/upload-video.mjs';

const slot = {
  mediaID: 'media-test', extension: 'mp4',
  mediaUploadURL: 'https://cartwheel-mogen-resources.s3.us-east-1.amazonaws.com/media-test.mp4?X-Amz-Signature=test-only',
};
async function fixture(t, contents = Buffer.from('example video bytes')) {
  const directory = await mkdtemp(join(tmpdir(), 'cartwheel-upload-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'clip.mp4');
  await writeFile(path, contents);
  return path;
}

test('upload streams the selected bytes only to signed storage without an API key', async t => {
  const bytes = Buffer.from('selected video contents');
  const filePath = await fixture(t, bytes);
  let calls = 0;
  const result = await uploadVideo({ filePath, upload: slot, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.href, slot.mediaUploadURL);
    assert.equal(options.method, 'PUT');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) });
    const chunks = [];
    for await (const chunk of options.body) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    return new Response(null, { status: 200 });
  } });
  assert.deepEqual(result, { mediaID: 'media-test', uploaded: true, bytes: bytes.length });
  assert.equal(calls, 1);
});

test('upload rejects foreign destinations, unsigned URLs, and mismatched or empty files', async t => {
  const filePath = await fixture(t);
  const fetchImpl = async () => assert.fail('Must not upload');
  for (const mediaUploadURL of [
    'https://attacker.example/clip.mp4?X-Amz-Signature=x',
    'http://cartwheel-mogen-resources.s3.amazonaws.com/x?X-Amz-Signature=x',
    'https://cartwheel-mogen-resources.s3.amazonaws.com/x',
    'https://user:password@cartwheel-mogen-resources.s3.amazonaws.com/x?X-Amz-Signature=x',
  ]) await assert.rejects(uploadVideo({ filePath, upload: { ...slot, mediaUploadURL }, fetchImpl }), /signed upload URL/);
  await assert.rejects(uploadVideo({ filePath, upload: { ...slot, extension: 'mov' }, fetchImpl }), /extension must match/);
  const emptyPath = await fixture(t, Buffer.alloc(0));
  await assert.rejects(uploadVideo({ filePath: emptyPath, upload: slot, fetchImpl }), /nonempty video/);
});

test('failed uploads are not retried and errors omit the response body and signed URL', async t => {
  const filePath = await fixture(t);
  let calls = 0;
  await assert.rejects(uploadVideo({ filePath, upload: slot, fetchImpl: async () => {
    calls++;
    return new Response('private upstream details', { status: 403 });
  } }), { message: 'Video upload failed (HTTP 403).' });
  assert.equal(calls, 1);
});
