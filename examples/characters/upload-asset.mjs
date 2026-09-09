#!/usr/bin/env node
import { open, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const hosts = new Set([
  'cartwheel-mogen-resources.s3.amazonaws.com',
  'cartwheel-mogen-resources.s3.us-east-1.amazonaws.com',
]);
const models = { fbx: 'application/octet-stream', glb: 'model/gltf-binary', gltf: 'model/gltf+json', ma: 'application/octet-stream', mb: 'application/octet-stream', obj: 'text/plain', mjcf: 'application/zip' };
const images = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const thumbnails = { png: 'image/png', jpg: 'image/jpeg', webm: 'video/webm' };
class UploadError extends Error {}

// The MCP client runs this helper with explicitly selected files. The stdio
// server has no filesystem tool, and storage requests never carry an API key.
export async function uploadAsset({ kind, filePath, upload, fetchImpl = fetch }) {
  const extension = extname(filePath).slice(1).toLowerCase();
  let field, contentType, identity, maxBytes;
  if (kind === 'character') {
    field = 'characterFileUploadURL';
    contentType = Object.hasOwn(models, upload?.fileExtension ?? '') ? models[upload.fileExtension] : undefined;
    if (extension !== (upload?.fileExtension === 'mjcf' ? 'zip' : upload?.fileExtension)) contentType = undefined;
    identity = { characterID: upload?.characterID };
    maxBytes = 1024 ** 3;
  } else if (kind === 'image') {
    field = 'mediaUploadURL';
    contentType = Object.hasOwn(images, extension) && extension === upload?.extension ? images[extension] : undefined;
    identity = { mediaID: upload?.mediaID };
    maxBytes = 50 * 1024 ** 2;
  } else if (kind === 'config') {
    field = 'configUploadURL';
    contentType = extension === 'json' ? 'application/json' : undefined;
    identity = { characterID: upload?.characterID };
    maxBytes = 16 * 1024 ** 2;
  } else if (kind === 'thumbnail') {
    field = 'thumbnailUploadURL';
    contentType = Object.hasOwn(thumbnails, extension) ? thumbnails[extension] : undefined;
    identity = { characterID: upload?.characterID };
    maxBytes = 50 * 1024 ** 2;
  } else throw new UploadError('Choose character, image, config, or thumbnail upload.');

  if (!contentType || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(Object.values(identity)[0] ?? '')) {
    throw new UploadError('The selected file format and asset ID must match the upload slot.');
  }
  let url;
  try { url = new URL(upload?.[field]); } catch { throw new UploadError('The upload response is missing a valid URL for this asset kind.'); }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password || url.hash || !url.searchParams.get('X-Amz-Signature')) {
    throw new UploadError('Expected a signed upload URL for Cartwheel production storage.');
  }
  if (kind === 'thumbnail' && !url.pathname.endsWith(`.${extension}`)) throw new UploadError('The thumbnail extension must match its upload slot.');

  let handle;
  try {
    handle = await open(filePath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || !stat.size || stat.size > maxBytes) throw new UploadError(`Choose a nonempty ${kind} file of at most ${maxBytes / 1024 ** 2} MiB for this helper.`);
    const body = handle.createReadStream({ autoClose: false });
    try {
      const response = await fetchImpl(url, {
        method: 'PUT', redirect: 'error',
        headers: { 'Content-Type': contentType, 'Content-Length': String(stat.size) },
        body, duplex: 'half', signal: AbortSignal.timeout(240_000),
      });
      if (!response.ok) throw new UploadError(`Asset upload failed (HTTP ${response.status}).`);
      return { ...identity, kind, uploaded: true, bytes: stat.size };
    } finally { body.destroy(); }
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError('Asset upload failed. Check the selected file, network connection, and upload expiry.');
  } finally { await handle?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [kind, filePath, responsePath, mediaID, ...extra] = process.argv.slice(2);
    if (!kind || !filePath || !responsePath || extra.length || (kind === 'image' ? !mediaID : mediaID)) {
      throw new UploadError('Usage: node upload-asset.mjs KIND FILE PRIVATE_UPLOAD_RESPONSE.json [MEDIA_ID for image]');
    }
    const response = JSON.parse(await readFile(responsePath, 'utf8'));
    const upload = kind === 'image' ? response.mediaUploads?.find(item => item.mediaID === mediaID) : response;
    if (!upload) throw new UploadError('The requested media ID was not found in the upload response.');
    console.log(JSON.stringify(await uploadAsset({ kind, filePath, upload })));
  } catch (error) {
    console.error(error instanceof UploadError ? error.message : 'Cannot read the selected file or private upload response.');
    process.exitCode = 1;
  }
}
