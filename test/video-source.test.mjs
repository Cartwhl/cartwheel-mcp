import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import { Resolver } from 'node:dns/promises';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceDownloader, isPublicAddress, sourceURL } from '../src/tool-executor/video-source.cjs';
import { importVideo } from '../src/tool-executor/index.cjs';

const url = 'https://attachment.example/private?sig=never-log';
const publicAnswers = [{ address: '93.184.215.14', family: 4 }, { address: '2606:4700::1111', family: 6 }];
function resolverFor(answers) {
  return () => ({
    resolve4: async () => answers.filter(answer => answer.family === 4).map(answer => answer.address),
    resolve6: async () => answers.filter(answer => answer.family === 6).map(answer => answer.address),
    cancel() {},
  });
}

test('public-address boundary rejects special-use IPv4/IPv6 and normalized URL aliases', () => {
  for (const address of ['0.1.2.3', '10.1.2.3', '100.100.100.200', '127.1.2.3', '169.254.169.254',
    '172.31.255.255', '192.0.0.9', '192.0.2.1', '192.31.196.1', '192.52.193.1', '192.88.99.1',
    '192.168.1.1', '192.175.48.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '::ffff:7f00:1', '::127.0.0.1',
    '64:ff9b::a00:1', '64:ff9b:1::1', '100::1', 'fc00::1', 'fd00:ec2::254', 'fe80::1', 'fe80::1%lo0',
    'ff02::1', '2001::1', '2001:2::1', '2001:db8::1', '2002:7f00:1::', '2620:4f:8000::1', '3ffe::1', '3fff::1', 'garbage']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['8.8.8.8', '93.184.215.14', '2606:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const host of ['127.1', '2130706433', '0x7f000001', '0177.0.0.1', '[0:0:0:0:0:0:0:1]', '[::ffff:7f00:1]', '[::ffff:0808:0808]']) {
    assert.throws(() => sourceURL(`https://${host}/?sig=private`), { code: 'unsafe_source_address' });
  }
});

async function tlsFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cartwheel-video-tls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=attachment.example', '-addext', 'subjectAltName=DNS:attachment.example',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  const cert = readFileSync(join(dir, 'cert.pem'));
  const requests = [], sni = [], responses = [];
  let receivedBytes = 0;
  const server = https.createServer({ key: readFileSync(join(dir, 'key.pem')), cert }, (req, res) => {
    requests.push({ headers: req.headers, url: req.url });
    if (req.url.startsWith('/redirect')) {
      res.writeHead(302, { Location: 'https://127.0.0.1/metadata' }); res.end();
    } else if (req.url === '/large') {
      const bytes = 8 * 1024 * 1024;
      let sent = 0;
      res.writeHead(200, { 'Content-Length': String(bytes) });
      const write = () => {
        while (sent < bytes) {
          sent += 65536;
          if (!res.write(Buffer.alloc(65536))) { res.once('drain', write); return; }
        }
        res.end();
      };
      write();
    } else { res.writeHead(200, { 'Content-Length': '6' }); res.end('abcdef'); }
  });
  server.on('secureConnection', socket => sni.push(socket.servername));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  // Only this fixture maps the validated public destination to loopback. The
  // production request options and controlled lookup run unchanged first.
  function request(target, options, callback) {
    assert.equal(options.agent, false);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.autoSelectFamily, false);
    assert.deepEqual(options.headers, { 'Accept-Encoding': 'identity' });
    return https.request(target, { ...options, port: server.address().port, ca: cert,
      lookup(name, opts, done) {
        options.lookup(name, opts, (error, address, family) => {
          if (error) { done(error); return; }
          assert.equal(isPublicAddress(address), true);
          assert.equal(net.isIP(address), family);
          done(null, '127.0.0.1', 4);
        });
      } }, response => {
        responses.push(response);
        callback(response);
        response.on('data', chunk => { receivedBytes += chunk.byteLength; });
      });
  }
  return { request, requests, sni, responses, get receivedBytes() { return receivedBytes; } };
}

test('real TLS request pins one validated answer, retains SNI/certificate/Host, ignores proxies and never redirects', { timeout: 10000 }, async t => {
  const fixture = await tlsFixture(t);
  let resolutions = 0;
  const download = createSourceDownloader({ request: fixture.request, createResolver() {
    resolutions++;
    // A second resolution would rebind to metadata. It must never occur per request.
    return resolverFor(resolutions === 1 ? publicAnswers : [{ address: '169.254.169.254', family: 4 }])();
  } });
  for (const [key, value] of Object.entries({ HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', NODE_USE_ENV_PROXY: '1' })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const response = await download(url, { signal: new AbortController().signal });
  assert.equal(await new Response(response.body).text(), 'abcdef');
  assert.equal(resolutions, 1);
  assert.deepEqual(fixture.sni, ['attachment.example']);
  // The fixture changes only the destination port; Host must retain the source
  // name, not the selected public address or fixture's loopback address.
  assert.equal(new URL(`https://${fixture.requests[0].headers.host}`).hostname, 'attachment.example');
  assert.deepEqual(Object.keys(fixture.requests[0].headers).sort(), ['accept-encoding', 'connection', 'host']);
  await assert.rejects(download(url, { signal: new AbortController().signal }), { code: 'unsafe_source_address' });
  assert.equal(fixture.requests.length, 1);

  const redirects = createSourceDownloader({ request: fixture.request,
    createResolver: resolverFor(publicAnswers) });
  await assert.rejects(redirects('https://attachment.example/redirect?sig=private', {
    signal: new AbortController().signal,
  }), { code: 'source_download_failed' });
  assert.equal(fixture.requests.length, 2);
  // Correct public DNS must not disable original-hostname certificate checks.
  await assert.rejects(redirects('https://wrong.example/private', {
    signal: new AbortController().signal,
  }), { code: 'source_download_failed' });
  assert.equal(fixture.requests.length, 2);

  const imported = await importVideo({ downloadURL: url, extension: 'mp4', duration: 1 }, {
    downloadSource: redirects,
    createUpload: async () => ({ mediaUploads: [{ mediaID: 'tls-import', extension: 'mp4',
      mediaUploadURL: 'https://cartwheel-mogen-resources.s3.amazonaws.com/video?X-Amz-Signature=private' }] }),
    fetchImpl: async (target, init) => {
      assert.equal(init.method, 'PUT'); // Source must never use global/injected fetch.
      assert.deepEqual(init.headers, { 'Content-Type': 'video/mp4', 'Content-Length': '6' });
      const chunks = [];
      for await (const chunk of init.body) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString(), 'abcdef');
      return new Response();
    },
  });
  assert.deepEqual(imported, { uploaded: true, mediaID: 'tls-import', bytes: 6 });

  const beforeLarge = fixture.receivedBytes;
  const large = await redirects('https://attachment.example/large', { signal: new AbortController().signal });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(fixture.receivedBytes - beforeLarge < 512 * 1024, 'Unconsumed web body must not drain the source');
  const closed = new Promise(resolve => fixture.responses.at(-1).once('close', resolve));
  await large.body.cancel();
  await closed;
  assert.equal(fixture.responses.at(-1).destroyed, true);
});

test('private, mixed and malformed DNS never reach a TLS server or registration', { timeout: 10000 }, async t => {
  const fixture = await tlsFixture(t);
  for (const answers of [[{ address: '10.0.0.1', family: 4 }], [...publicAnswers, { address: '::ffff:127.0.0.1', family: 6 }],
    [...publicAnswers, { address: '192.168.1.1', family: 4 }], [{ address: 'fc00::1', family: 6 }],
    [{ address: '8.8.8.8', family: 6 }], []]) {
    const downloadSource = createSourceDownloader({ request: fixture.request,
      createResolver: resolverFor(answers) });
    const result = await importVideo({ downloadURL: url, extension: 'mp4', duration: 1 }, {
      downloadSource, createUpload: () => assert.fail('No slot'), fetchImpl: () => assert.fail('No storage'),
    });
    assert.equal(result.uploaded, false);
    assert.equal(result.code, answers.length ? 'unsafe_source_address' : 'source_download_failed');
    assert.doesNotMatch(JSON.stringify(result), /private|never-log|https:/);
  }
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.sni.length, 0);
});

test('A/AAAA resolution accepts an absent family only, waits for both and cancels a pending sibling on error', { timeout: 10000 }, async t => {
  const fixture = await tlsFixture(t);
  const dnsError = code => Object.assign(new Error('private DNS diagnostic'), { code });
  for (const absent of ['resolve4', 'resolve6']) {
    const download = createSourceDownloader({ request: fixture.request, createResolver: () => ({
      ...resolverFor(publicAnswers)(),
      [absent]: async () => { throw dnsError('ENODATA'); },
    }) });
    const response = await download(url, { signal: new AbortController().signal });
    assert.equal(await new Response(response.body).text(), 'abcdef');
  }
  const connected = fixture.requests.length;
  for (const code of ['ENODATA', 'ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT', 'ECANCELLED']) {
    let cancellations = 0, pending = false, stop;
    const download = createSourceDownloader({ request: fixture.request, createResolver: () => ({
      resolve4: async () => { throw dnsError(code); },
      resolve6: () => code === 'ENODATA' ? Promise.reject(dnsError('ENODATA')) : new Promise((resolve, reject) => {
        pending = true;
        stop = () => { pending = false; reject(dnsError('ECANCELLED')); };
      }),
      cancel() { cancellations++; stop?.(); },
    }) });
    await assert.rejects(download(url, { signal: new AbortController().signal }), { code: 'source_download_failed' });
    assert.equal(cancellations, 1);
    assert.equal(pending, false);
  }
  // Even a successful family must not mask any sibling error, including NXDOMAIN.
  for (const code of ['ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT', 'ECANCELLED']) {
    const download = createSourceDownloader({ request: fixture.request, createResolver: () => ({
      resolve4: async () => ['93.184.215.14'],
      resolve6: async () => { throw dnsError(code); },
      cancel() {},
    }) });
    await assert.rejects(download(url, { signal: new AbortController().signal }), { code: 'source_download_failed' });
  }
  let finish6;
  const download = createSourceDownloader({ request: fixture.request, createResolver: () => ({
    resolve4: async () => ['93.184.215.14'],
    resolve6: () => new Promise(resolve => { finish6 = resolve; }),
    cancel() {},
  }) });
  const pending = download(url, { signal: new AbortController().signal });
  await new Promise(setImmediate);
  assert.equal(fixture.requests.length, connected);
  finish6(['fc00::1']);
  await assert.rejects(pending, { code: 'unsafe_source_address' });
  assert.equal(fixture.requests.length, connected);
});

test('native request-scoped DNS queries settle ECANCELLED on abort/deadline without workerpool jobs or late connections', { timeout: 5000 }, async t => {
  // A bounded local UDP sink leaves real c-ares queries pending until cancel().
  // Tracking the original native promises distinguishes cancellation from merely
  // racing a timeout while native resolver requests continue running.
  const dnsServer = createSocket('udp4');
  dnsServer.bind(0, '127.0.0.1');
  await once(dnsServer, 'listening');
  t.after(() => dnsServer.close());
  let queries = 0, cancels = 0, connects = 0, resolvers = 0;
  let allQueried;
  const queried = new Promise(resolve => { allQueried = resolve; });
  dnsServer.on('message', () => { if (++queries === 20) allQueried(); });
  const active = new Set(), outcomes = [];
  const downloadSource = createSourceDownloader({ createResolver() {
    resolvers++;
    const resolver = new Resolver();
    resolver.setServers([`127.0.0.1:${dnsServer.address().port}`]);
    for (const method of ['resolve4', 'resolve6']) {
      const resolve = resolver[method].bind(resolver);
      resolver[method] = name => {
        const promise = resolve(name);
        active.add(promise);
        void promise.then(() => { active.delete(promise); outcomes.push('success'); }, error => {
          active.delete(promise); outcomes.push(error.code);
        });
        return promise;
      };
    }
    const cancel = resolver.cancel.bind(resolver);
    resolver.cancel = () => { cancels++; cancel(); };
    return resolver;
  }, request(target, options, callback) {
    const req = https.request(target, options, callback);
    req.on('socket', socket => socket.on('connect', () => { connects++; }));
    return req;
  } });
  const run = (options = {}) => importVideo({ downloadURL: url, extension: 'mp4', duration: 1 }, {
    downloadSource, createUpload: () => assert.fail('No slot'), fetchImpl: () => assert.fail('No storage'), ...options,
  });
  const controllers = Array.from({ length: 10 }, () => new AbortController());
  const imports = controllers.map(controller => run({ signal: controller.signal, timeoutMs: 1000 }));
  await queried;
  assert.equal(active.size, 20);
  controllers[0].abort();
  await imports[0];
  await new Promise(setImmediate);
  assert.equal(active.size, 18, 'Cancelling one request must not cancel other request-scoped resolvers');
  for (const controller of controllers.slice(1)) controller.abort();
  const results = await Promise.all(imports);
  const expired = await Promise.all(Array.from({ length: 10 }, () => run({ timeoutMs: 30 })));
  await new Promise(setImmediate);
  assert.ok([...results, ...expired].every(result => result.code === 'import_cancelled'));
  assert.equal(active.size, 0);
  assert.equal(outcomes.length, 40);
  assert.ok(outcomes.every(code => code === 'ECANCELLED'));
  assert.equal(cancels, 20);
  assert.equal(resolvers, 20);
  assert.equal(connects, 0);
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  assert.equal((await run({ signal: alreadyAborted.signal })).code, 'import_cancelled');
  assert.equal(resolvers, 20, 'Pre-aborted imports must not enqueue DNS');
});

test('abort during DNS and TLS handshake destroys the request and late resolution cannot connect', { timeout: 5000 }, async t => {
  let connections = 0;
  const server = net.createServer(socket => { connections++; socket.on('error', () => {}); });
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  for (const phase of ['dns', 'tls']) {
    const controller = new AbortController();
    let req, cancellations = 0;
    const finishQueries = [];
    const download = createSourceDownloader({ createResolver: () => ({
      resolve4: () => phase === 'tls' ? Promise.resolve(['93.184.215.14']) : new Promise(resolve => finishQueries.push(() => resolve(['93.184.215.14']))),
      resolve6: () => phase === 'tls' ? Promise.resolve([]) : new Promise(resolve => finishQueries.push(() => resolve([]))),
      cancel() { cancellations++; },
    }),
      request(target, options, callback) {
        req = https.request(target, { ...options, port: server.address().port,
          lookup: (name, opts, cb) => options.lookup(name, opts, (error, address) => {
            if (error) { cb(error); return; }
            assert.equal(isPublicAddress(address), true);
            cb(null, '127.0.0.1', 4);
          }) }, callback);
        return req;
      } });
    const pending = download(url, { signal: controller.signal });
    if (phase === 'tls') await once(server, 'connection');
    else assert.equal(finishQueries.length, 2);
    controller.abort();
    await assert.rejects(pending, { code: 'source_download_failed' });
    assert.equal(req.destroyed, true);
    assert.equal(cancellations, phase === 'dns' ? 1 : 0);
    // A misbehaving injected resolver that succeeds after cancel cannot connect.
    for (const finish of finishQueries) finish();
    await new Promise(setImmediate);
    assert.equal(connections, phase === 'dns' ? 0 : 1);
  }
});
