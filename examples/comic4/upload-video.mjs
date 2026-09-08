#!/usr/bin/env node
import { open, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo', mkv: 'video/x-matroska' };
const uploadHosts = new Set([
  'cartwheel-mogen-resources.s3.amazonaws.com',
  'cartwheel-mogen-resources.s3.us-east-1.amazonaws.com',
]);

// Run by the MCP client's authorized local execution tool, not by the MCP server.
export async function uploadVideo({ filePath, upload, fetchImpl = fetch }) {
  const extension = extname(filePath).slice(1).toLowerCase();
  if (!types[extension] || extension !== upload?.extension?.toLowerCase()) {
    throw new Error('The local video extension must match its media upload slot.');
  }
  let url;
  try { url = new URL(upload.mediaUploadURL); } catch { throw new Error('Invalid media upload URL.'); }
  if (url.protocol !== 'https:' || !uploadHosts.has(url.hostname) || url.port || url.username || url.password || url.hash || !url.searchParams.has('X-Amz-Signature')) {
    throw new Error('Expected a signed upload URL for Cartwheel production media storage.');
  }
  const handle = await open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size >= 250_000_000) {
      throw new Error('Choose a nonempty video file smaller than 250 MB.');
    }
    const body = handle.createReadStream({ autoClose: false });
    try {
      const response = await fetchImpl(url, {
        method: 'PUT', redirect: 'error',
        headers: { 'Content-Type': types[extension], 'Content-Length': String(stat.size) },
        body, duplex: 'half', signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error(`Video upload failed (HTTP ${response.status}).`);
      return { mediaID: upload.mediaID, bytes: stat.size, uploaded: true };
    } finally { body.destroy(); }
  } finally { await handle.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [filePath, responsePath, mediaID] = process.argv.slice(2);
    if (!filePath || !responsePath || !mediaID) throw new Error('Usage: node upload-video.mjs VIDEO PRIVATE_UPLOAD_RESPONSE.json MEDIA_ID');
    const response = JSON.parse(await readFile(responsePath, 'utf8'));
    const upload = response.mediaUploads?.find(item => item.mediaID === mediaID);
    if (!upload) throw new Error('Media ID was not found in the saved create_media_upload JSON body.');
    console.log(JSON.stringify(await uploadVideo({ filePath, upload })));
  } catch (error) {
    // Transport errors may contain a signed URL; only our fixed validation errors are safe.
    const safe = /^(Usage:|The local video|Invalid media upload|Expected a signed|Choose a nonempty|Video upload failed \(HTTP|Media ID was not found)/.test(error.message);
    console.error(safe ? error.message : 'Video upload failed. Check the local file, network connection, and upload expiry.');
    process.exitCode = 1;
  }
}
