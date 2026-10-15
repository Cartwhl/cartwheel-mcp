import { HOSTED_JSON_LIMIT } from './tool-executor/hosted.cjs';

// Also bounds credential-provider resolution and mocked/custom streams that do
// not themselves honor AbortSignal. Never expose the underlying exception.
export async function abortable(promise, signal) {
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(new Error('Request cancelled'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}

export async function readBoundedJSON(response, signal) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > HOSTED_JSON_LIMIT) throw new Error('Response too large');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { void reader.cancel().catch(() => {}); }
}
