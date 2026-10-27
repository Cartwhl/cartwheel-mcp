const https = require('node:https');
const { Resolver } = require('node:dns').promises;
const { isIP, BlockList } = require('node:net');
const { Readable } = require('node:stream');

class VideoImportError extends Error {
  constructor(code, diagnosticHostname) {
    super(code); this.code = code;
    if (diagnosticHostname) this.diagnosticHostname = diagnosticHostname;
  }
}
const blocked = new BlockList();
// IANA IPv4/IPv6 Special-Purpose registries (2025-10-09), multicast and reserved
// space. https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/ . Fail closed for
// IPv6 outside global unicast, including every IPv4-mapped/translation form.
for (const cidr of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
  '192.31.196.0/24', '192.52.193.0/24', '192.88.99.0/24', '192.168.0.0/16',
  '192.175.48.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/3',
  '2001::/23', '2001:db8::/32', '2002::/16', '2620:4f:8000::/48', '3ffe::/16', '3fff::/20']) {
  const [address, prefix] = cidr.split('/');
  blocked.addSubnet(address, Number(prefix), isIP(address) === 4 ? 'ipv4' : 'ipv6');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
function isPublicAddress(address) {
  const family = isIP(address);
  if (!family || address.includes('%')) return false;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  return (family === 4 || globalV6.check(address, type)) && !blocked.check(address, type);
}
function sourceURL(value) {
  if (typeof value !== 'string' || value.length > 16000 || /[\x00-\x20\x7f\\]/.test(value)) throw new VideoImportError('invalid_source_url');
  let url;
  try { url = new URL(value); } catch { throw new VideoImportError('invalid_source_url'); }
  const hostname = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(url.hostname) &&
    url.hostname.length <= 253 ? url.hostname : undefined;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || value.includes('#')) {
    throw new VideoImportError('unsafe_source_url', hostname);
  }
  const address = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(address) && !isPublicAddress(address)) throw new VideoImportError('unsafe_source_address', hostname);
  return url;
}

async function resolveSource(name, signal, createResolver) {
  if (signal.aborted) throw new VideoImportError('import_cancelled');
  // c-ares queries are request-scoped and cancellable, unlike dns.lookup's
  // workerpool getaddrinfo jobs. Never fall back to the OS resolver.
  const resolver = createResolver();
  let cancelled = false;
  const cancel = () => { if (!cancelled) { cancelled = true; resolver.cancel(); } };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const query = async (method, family) => {
      if (signal.aborted) throw new VideoImportError('import_cancelled');
      try {
        const addresses = await resolver[method](name);
        return addresses.map(address => ({ address, family }));
      } catch (error) {
        // An absent family is normal. NXDOMAIN, SERVFAIL, timeout, cancellation
        // and other errors must not allow a successful sibling to bypass DNS.
        if (error.code === 'ENODATA') return [];
        throw error;
      }
    };
    const answers = (await Promise.all([query('resolve4', 4), query('resolve6', 6)])).flat();
    if (signal.aborted) throw new VideoImportError('import_cancelled');
    if (!answers.length) throw new VideoImportError('source_download_failed');
    if (answers.some(({ address, family }) => !isPublicAddress(address) || isIP(address) !== family)) {
      throw new VideoImportError('unsafe_source_address');
    }
    return answers[0];
  } catch (error) {
    cancel(); // Also stop a still-pending sibling query on resolution failure.
    throw new VideoImportError(signal.aborted ? 'import_cancelled' :
      error instanceof VideoImportError ? error.code : 'source_download_failed');
  } finally { signal.removeEventListener('abort', cancel); }
}

// Dependency seams are backend-only and allow testing the actual resolver and TLS
// request policy. No caller-controlled headers, agent, socket or proxy options.
function createSourceDownloader({ createResolver = () => new Resolver(), request = https.request } = {}) {
  return (value, { signal }) => new Promise((resolve, reject) => {
    const url = sourceURL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const rejectSafe = () => reject(new VideoImportError('source_download_failed'));
    const pinnedLookup = (name, options, callback) => {
      // Both families are checked before handing one address to this socket.
      void resolveSource(name, signal, createResolver).then(
        ({ address, family }) => signal.aborted ? callback(new VideoImportError('import_cancelled')) : callback(null, address, family),
        error => callback(error instanceof VideoImportError ? error : new VideoImportError('source_download_failed')));
    };
    let req;
    try {
      req = request(url, { method: 'GET', agent: false, lookup: pinnedLookup,
        autoSelectFamily: false, rejectUnauthorized: true,
        ...(isIP(hostname) ? {} : { servername: hostname }),
        headers: { 'Accept-Encoding': 'identity' }, signal }, response => {
        // https.request never follows Location. Destroy rejected responses here.
        if (response.statusCode !== 200) { response.destroy(); rejectSafe(); return; }
        resolve({ status: response.statusCode, headers: new Headers(response.headers),
          // Explicit byte-based queue across Node versions; chunk-counting
          // defaults can prefetch the whole source while the PUT is paused.
          body: Readable.toWeb(response, { strategy: {
            highWaterMark: 64 * 1024, size: chunk => chunk.byteLength,
          } }) });
      });
      req.on('error', error => reject(error instanceof VideoImportError ? error : new VideoImportError('source_download_failed')));
      req.end();
    } catch { req?.destroy(); rejectSafe(); }
  });
}
const downloadSource = createSourceDownloader();
module.exports = { VideoImportError, sourceURL, isPublicAddress, createSourceDownloader, downloadSource };
