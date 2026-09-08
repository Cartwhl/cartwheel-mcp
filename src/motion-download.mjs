import { MAX_BVH_BYTES, MotionInputError } from './motion-analysis.mjs';

const hosts = new Set([
  'cartwheel-mogen-resources.s3.amazonaws.com',
  'cartwheel-mogen-resources.s3.us-east-1.amazonaws.com',
]);

// Only assets returned by the authenticated public motion endpoint are eligible.
// API credentials never accompany asset requests. Redirects cannot escape this set.
export async function downloadMotionBVH(value, { fetchImpl, signal }) {
  let url;
  try { url = new URL(value); } catch { throw new MotionInputError('Cartwheel did not return a valid BVH asset URL.'); }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password || url.hash) {
    throw new MotionInputError('The motion asset is not on approved Cartwheel production storage. Download it with your client and use the local preparation helper.');
  }
  const response = await fetchImpl(url, { redirect: 'error', signal, headers: { Accept: 'text/plain, application/octet-stream' } });
  if (!response.ok || !response.body) throw new MotionInputError('BVH download failed. Request fresh motion status and try analysis again.');
  if (Number(response.headers.get('content-length')) > MAX_BVH_BYTES) {
    await response.body.cancel();
    throw new MotionInputError('BVH exceeds the 24 MiB analysis limit.');
  }
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      bytes += chunk.byteLength;
      if (bytes > MAX_BVH_BYTES) throw new MotionInputError('BVH exceeds the 24 MiB analysis limit.');
      chunks.push(chunk);
    }
  } finally { await reader.cancel(); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
