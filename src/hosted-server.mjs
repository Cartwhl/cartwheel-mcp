import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import getRawBody from 'raw-body';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { invokeHostedMotion, motionConfig, motionTools } from './hosted-motion.mjs';
import { HOSTED_JSON_LIMIT } from './tool-executor/hosted.cjs';

const scopes = ['openid', 'profile'];
const securitySchemes = [{ type: 'oauth2', scopes }];
const metadataPath = '/.well-known/oauth-protected-resource';
const profileTool = {
  name: 'get_profile',
  description: 'Return the authenticated profile. Its opaque ID is stable across token refresh, reconnection, and display-name changes.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, pattern: '\\S', description: 'Stable opaque profile identifier; never reassigned.' },
      name: { type: 'string' },
      email: { type: 'string' },
      nickname: { type: 'string' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  securitySchemes,
  _meta: { 'openai/profile': true, securitySchemes },
};

function configuredURL(value, name, allowLocal = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute URL`); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must use HTTPS without credentials, query, or fragment (loopback HTTP is development-only)`);
  }
  return url;
}

export function hostedConfig(env = process.env) {
  const resource = configuredURL(env.MCP_PUBLIC_URL, 'MCP_PUBLIC_URL', true);
  if (resource.pathname !== '/mcp' || resource.href !== env.MCP_PUBLIC_URL) {
    throw new Error('MCP_PUBLIC_URL must be a canonical URL ending in /mcp, with no trailing slash');
  }
  const issuer = configuredURL(env.STYTCH_ISSUER, 'STYTCH_ISSUER');
  if (env.STYTCH_ISSUER !== issuer.origin) throw new Error('STYTCH_ISSUER must be the exact HTTPS project/custom origin, without a trailing slash');
  if (!/^project-(test|live)-[a-f0-9-]+$/.test(env.STYTCH_PROJECT_ID ?? '')) throw new Error('STYTCH_PROJECT_ID is required');
  if (!/^connected-app-(test|live)-[a-f0-9-]+$/.test(env.STYTCH_CLIENT_ID ?? '')) throw new Error('STYTCH_CLIENT_ID must identify the pre-registered Connected App');
  const mode = env.STYTCH_PROJECT_ID.startsWith('project-test-') ? 'test' : 'live';
  const clientPattern = new RegExp(`^connected-app-${mode}-[a-f0-9-]+$`);
  if (!clientPattern.test(env.STYTCH_CLIENT_ID) || (env.MCP_CLAUDE_CLIENT_ID &&
      (!clientPattern.test(env.MCP_CLAUDE_CLIENT_ID) || env.MCP_CLAUDE_CLIENT_ID === env.STYTCH_CLIENT_ID))) {
    throw new Error('Connected Apps must be distinct and belong to the configured environment');
  }
  const allowedOrigins = [resource.origin];
  for (const origin of (env.MCP_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)) {
    const url = configuredURL(origin, 'MCP_ALLOWED_ORIGINS', true);
    if (origin !== url.origin) throw new Error('MCP_ALLOWED_ORIGINS must contain exact origins, without trailing slashes');
    allowedOrigins.push(origin);
  }
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  return {
    resource: resource.href, issuer: issuer.origin, projectId: env.STYTCH_PROJECT_ID,
    clientId: env.STYTCH_CLIENT_ID, claudeClientId: env.MCP_CLAUDE_CLIENT_ID || undefined, allowedOrigins, host: resource.host,
    metadataURL: `${resource.origin}${metadataPath}/mcp`,
    listenHost: env.HOST ?? '127.0.0.1', port,
    motion: motionConfig(env),
  };
}

// Only the signing-key cache is shared. No token, profile, session, or user cache.
export function createTokenVerifier(config, jwks = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`))) {
  return async token => {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS256'], typ: 'JWT', issuer: config.issuer, audience: config.projectId,
      requiredClaims: ['sub', 'exp', 'iat', 'nbf', 'jti', 'client_id', 'scope'],
    });
    // Stytch's project audience alone is NOT resource binding. For this MVP the
    // pre-registered client's access_token_custom_audience must be MCP_PUBLIC_URL.
    // Do not guess a resource/resources claim or trust the SDK's synthetic token_type.
    if (!Array.isArray(payload.aud) || !payload.aud.every(aud => typeof aud === 'string') ||
        !payload.aud.includes(config.resource) ||
        !(payload.client_id === config.clientId || (config.claudeClientId && payload.client_id === config.claudeClientId)) ||
        typeof payload.sub !== 'string' || !/^user-(test|live)-\S+$/.test(payload.sub) ||
        typeof payload.jti !== 'string' || !payload.jti.trim() ||
        ![payload.iat, payload.nbf, payload.exp].every(Number.isFinite) ||
        payload.iat > Date.now() / 1000 || payload.exp <= payload.iat ||
        'https://stytch.com/session' in payload ||
        (payload.token_type !== undefined && payload.token_type !== 'access_token') ||
        typeof payload.scope !== 'string') {
      throw new Error('Invalid Connected App access token');
    }
    const granted = payload.scope.split(' ');
    if (!scopes.every(scope => granted.includes(scope))) {
      throw Object.assign(new Error('Insufficient scope'), { insufficientScope: true });
    }
    // Stable deterministic identity contract; do not change on reconnect or
    // use email, client_id, token ID, resource URL, or editable display metadata.
    const id = createHash('sha256').update(JSON.stringify([payload.iss, payload.sub])).digest('base64url');
    return { id: `prf_${id}` };
  };
}

function profileServer(profile, config, token, challenge, motionDependencies) {
  const server = new Server({ name: 'cartwheel-profile', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [profileTool, ...(config.motion ? motionTools : [])] }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
    if (config.motion && motionTools.some(tool => tool.name === params.name)) {
      return invokeHostedMotion(config.motion, params.name, params.arguments ?? {}, token, challenge,
        { ...motionDependencies, signal: extra.signal });
    }
    if (params.name !== 'get_profile' || Object.keys(params.arguments ?? {}).length !== 0) {
      return { isError: true, content: [{ type: 'text', text: 'Only get_profile with no arguments is supported.' }] };
    }
    return { isError: false, structuredContent: profile, content: [{ type: 'text', text: JSON.stringify(profile) }] };
  });
  return server;
}

export function createHostedServer(config, { jwks, ...motionDependencies } = {}) {
  const verify = createTokenVerifier(config, jwks);
  const challenge = `Bearer resource_metadata="${config.metadataURL}", scope="${scopes.join(' ')}"`;
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const authenticateError = (res, error) => {
    res.setHeader('WWW-Authenticate', `${challenge}${error ? `, error="${error}"` : ''}`);
    json(res, error === 'insufficient_scope' ? 403 : 401, { error: error ?? 'authentication_required' });
  };
  const handle = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Never derive discovery URLs from Host/X-Forwarded-*. The proxy must preserve
    // the configured public Host; forwarded headers are deliberately not trusted.
    if (req.headers.host !== config.host) return json(res, 421, { error: 'invalid_host' });
    const origin = req.headers.origin;
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) return json(res, 403, { error: 'invalid_origin' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version');
    }
    const path = req.url?.split('?')[0];
    const isMetadata = [metadataPath, `${metadataPath}/mcp`].includes(path);
    if (!isMetadata && path !== '/mcp') return json(res, 404, { error: 'not_found' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': isMetadata ? 'GET, OPTIONS' : 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
      });
      return res.end();
    }
    if (isMetadata && req.method === 'GET') {
      return json(res, 200, { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: scopes, bearer_methods_supported: ['header'] });
    }
    if (isMetadata) {
      res.setHeader('Allow', 'GET, OPTIONS');
      return json(res, 405, { error: 'method_not_allowed' });
    }
    const authorization = req.headers.authorization;
    if (!authorization) return authenticateError(res);
    const token = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(authorization)?.[1];
    if (!token) return authenticateError(res, 'invalid_token');
    let body;
    if (req.method === 'POST') {
      try { body = JSON.parse(await getRawBody(req, { limit: config.motion ? HOSTED_JSON_LIMIT : 16 * 1024, encoding: 'utf8' })); }
      catch (error) { return json(res, error.status === 413 ? 413 : 400, { error: 'invalid_request' }); }
    }
    let profile;
    // Verify after the bounded body read, so a slow upload cannot outlive exp.
    try { profile = await verify(token); }
    catch (error) { return authenticateError(res, error.insufficientScope ? 'insufficient_scope' : 'invalid_token'); }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return json(res, 405, { error: 'method_not_allowed' });
    }
    const server = profileServer(profile, config, token, challenge, motionDependencies);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once('close', () => { void server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      await server.close();
      if (!res.headersSent) json(res, 500, { error: 'internal_error' });
      else res.end();
    }
  };
  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => {
    void handle(req, res).catch(() => {
      // Do not log SDK errors: they can contain credentials or request bodies.
      if (!res.headersSent) json(res, 500, { error: 'internal_error' });
      else res.end();
    });
  });
}
