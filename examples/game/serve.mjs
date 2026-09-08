#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const example = fileURLToPath(new URL('./', import.meta.url));
const three = resolve(dirname(fileURLToPath(import.meta.resolve('three'))), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.bvh': 'text/plain', '.glb': 'model/gltf-binary' };
export function createExampleServer() {
  return createServer(async (req, res) => {
    try {
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? '') || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(403).end(); return; }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      let root, path;
      if (['/', '/index.html', '/app.mjs', '/controller.mjs', '/playback.mjs', '/rest-pose.mjs', '/mhr-rig.mjs', '/style.css'].includes(pathname)) { root = example; path = resolve(example, pathname === '/' ? 'index.html' : pathname.slice(1)); }
      else if (/^\/assets\/[a-z0-9.-]+\.(glb|bvh|json)$/.test(pathname)) { root = resolve(example, 'assets'); path = resolve(example, pathname.slice(1)); }
      else if (/^\/vendor\/three\/[a-zA-Z0-9_./-]+\.js$/.test(pathname)) { root = three; path = resolve(three, pathname.replace('/vendor/three/', '')); }
      else { res.writeHead(404).end(); return; }
      const actual = await realpath(path), allowed = await realpath(root);
      if (!actual.startsWith(allowed + sep)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(actual);
      res.writeHead(200, { 'Content-Type': mime[extname(actual)], 'Content-Length': bytes.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'" });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404).end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '4173' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Use a port from 1024 to 65535.');
  const server = createExampleServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Port in use; choose --port NUMBER.' : 'Local example server failed.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Cartwheel game reference: http://127.0.0.1:${port}`));
}
