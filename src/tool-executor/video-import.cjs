const { Readable } = require('node:stream');
const { VideoImportError, sourceURL, downloadSource: safeDownloadSource } = require('./video-source.cjs');

const MAX_VIDEO_BYTES = 249_999_999;
const types = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo', mkv: 'video/x-matroska' };
const uploadOrigins = new Set(['https://cartwheel-mogen-resources.s3.amazonaws.com',
  'https://cartwheel-mogen-resources.s3.us-east-1.amazonaws.com']);
function fail(code, diagnosticHostname) { throw new VideoImportError(code, diagnosticHostname); }
function validateVideoImport(args) {
  sourceURL(args?.downloadURL);
  if (typeof args.extension !== 'string' || !Object.hasOwn(types, args.extension) || !Number.isFinite(args.duration) || args.duration <= 0 || args.duration > 30 ||
      (args.name !== undefined && (typeof args.name !== 'string' || args.name.length > 200 || !/\S/.test(args.name) || /[\x00-\x1f\x7f]/.test(args.name))) ||
      (args.resolution !== undefined && (typeof args.resolution !== 'string' || !/^[1-9][0-9]{0,5}x[1-9][0-9]{0,5}$/.test(args.resolution) || /\s/.test(args.resolution)))) fail('invalid_video_metadata');
  return { extension: args.extension, name: args.name ?? `video.${args.extension}`, duration: args.duration,
    ...(args.resolution === undefined ? {} : { resolution: args.resolution }) };
}
// Race uncooperative transports/streams as well as passing the same cancellation
// signal to native fetch. Never propagate transport exceptions (signed URLs).
async function wait(promise, signal) {
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(new VideoImportError('import_cancelled'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
function cancel(body) { void body?.cancel().catch(() => {}); }

// createUpload is a backend-owned callback to the existing create_media_upload
// executor. Source and storage transports never receive API credentials.
async function importVideo(args, { createUpload, fetchImpl = globalThis.fetch, signal,
  downloadSource = safeDownloadSource, timeoutMs = 38_000 } = {}) {
  const media = validateVideoImport(args);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 38_000) fail('invalid_import_deadline');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const deadline = Date.now() + timeoutMs;
  const timer = setTimeout(abort, timeoutMs);
  let reader, body, mediaID;
  const check = () => { if (controller.signal.aborted || Date.now() >= deadline) fail('import_cancelled'); };
  try {
    check();
    const pending = downloadSource(args.downloadURL, { signal: controller.signal });
    // Dispose a late response even if a custom transport ignores cancellation.
    void pending.then(response => { if (controller.signal.aborted) cancel(response.body); }, () => {});
    const response = await wait(pending, controller.signal);
    if (response.status !== 200 || !response.body) { cancel(response.body); fail('attachment_download_failed'); }
    reader = response.body.getReader();
    const length = response.headers.get('content-length');
    if (!length || !/^[1-9][0-9]*$/.test(length)) fail('attachment_length_required');
    const bytes = Number(length);
    if (!Number.isSafeInteger(bytes) || bytes > MAX_VIDEO_BYTES) fail('attachment_too_large');
    if (response.headers.has('content-range') || response.headers.has('transfer-encoding') ||
        (response.headers.has('content-encoding') && response.headers.get('content-encoding') !== 'identity')) fail('unsupported_attachment_encoding');
    check();
    const slot = await wait(createUpload({ media: [media] }, controller.signal), controller.signal);
    const upload = slot?.mediaUploads?.length === 1 ? slot.mediaUploads[0] : undefined;
    if (typeof upload?.mediaID !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(upload.mediaID) || /\s/.test(upload.mediaID)) fail('invalid_upload_slot');
    mediaID = upload.mediaID;
    let target;
    try { target = new URL(upload.mediaUploadURL); } catch { fail('invalid_upload_slot'); }
    if (!uploadOrigins.has(target.origin) || target.username || target.password || target.hash ||
        !target.searchParams.get('X-Amz-Signature') || upload.extension !== media.extension) fail('invalid_upload_slot');
    let transferred = 0, complete = false;
    async function* chunks() {
      let held;
      for (;;) {
        check();
        const { done, value } = await wait(reader.read(), controller.signal);
        if (done) break;
        if (!(value instanceof Uint8Array)) fail('attachment_length_mismatch');
        transferred += value.byteLength;
        if (transferred > bytes) fail('attachment_length_mismatch');
        // Hold the final chunk until EOF validates the advertised length.
        if (held) yield held;
        held = value;
      }
      if (transferred !== bytes) fail('attachment_length_mismatch');
      if (held) yield held;
      complete = true;
    }
    body = Readable.from(chunks(), { objectMode: false, highWaterMark: 64 * 1024 });
    // Native fetch consumes this error; also handle injected transports that do not.
    body.on('error', () => {});
    check();
    const putting = fetchImpl(target.href, { method: 'PUT', redirect: 'error',
      headers: { 'Content-Type': types[media.extension], 'Content-Length': length },
      body, duplex: 'half', signal: controller.signal });
    void putting.then(result => cancel(result.body), () => {});
    const result = await wait(putting, controller.signal);
    check();
    // Generator completion only proves source EOF: Readable.from can still hold
    // an unread tail. Accept 2xx only after the PUT consumer has drained the body
    // through its end event. Do not drain it ourselves or wait on an early reply.
    if (!result.ok || !complete || transferred !== bytes || !body.readableEnded || body.errored) fail('storage_upload_failed');
    return { uploaded: true, mediaID, bytes };
  } catch (error) {
    const code = controller.signal.aborted || Date.now() >= deadline ? 'import_cancelled' :
      error instanceof VideoImportError ? error.code : 'video_import_failed';
    return { uploaded: false, code, ...(mediaID ? { mediaID } : {}) };
  } finally {
    controller.abort();
    body?.destroy();
    if (reader) void reader.cancel().catch(() => {});
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
module.exports = { importVideo, validateVideoImport, VideoImportError, MAX_VIDEO_BYTES };
