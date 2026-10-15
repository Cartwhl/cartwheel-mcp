import { createHash } from 'node:crypto';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Hash } from '@smithy/hash-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { abortable, readBoundedJSON } from './hosted-transport.mjs';

const endpoints = Object.freeze({
  staging: 'https://user-staging.api.getcartwheel.com/mcp/credential',
  production: 'https://user.api.getcartwheel.com/mcp/credential',
});

export function motionConfig(env) {
  if (env.MCP_MOTION_ENABLED !== undefined && !['true', 'false'].includes(env.MCP_MOTION_ENABLED)) {
    throw new Error('MCP_MOTION_ENABLED must be true or false');
  }
  if (env.MCP_MOTION_ENABLED !== 'true') return undefined;
  const environment = env.MCP_USER_API_ENVIRONMENT;
  const endpoint = Object.hasOwn(endpoints, environment) ? endpoints[environment] : undefined;
  const mode = environment === 'production' ? 'live' : 'test';
  const region = env.MCP_USER_API_REGION;
  if (!endpoint || env.MCP_USER_API_URL !== endpoint || !/^[a-z]{2}-[a-z]+-\d+$/.test(region ?? '') ||
      !env.STYTCH_PROJECT_ID?.startsWith(`project-${mode}-`) ||
      !env.STYTCH_CLIENT_ID?.startsWith(`connected-app-${mode}-`)) {
    throw new Error('Hosted motion requires an exact trusted endpoint, signing region and matching explicit environment');
  }
  return { endpoint, environment, region };
}

// Only AWS service credentials may be cached by the standard SDK provider. No
// OAuth token, binding, or Cartwheel key is cached. AWS_PROFILE locally; execution
// role for future Lambda hosting. This service needs execute-api:Invoke, not apigateway:GetApiKey.
const awsCredentials = defaultProvider();
export async function signCredentialRequest(config, token, { credentials = awsCredentials, signingDate } = {}) {
  if (config.endpoint !== endpoints[config.environment] || !/^[A-Za-z0-9._~-]{1,16000}$/.test(token)) throw new Error('Invalid credential request');
  const url = new URL(config.endpoint);
  const body = '{}';
  const signer = new SignatureV4({ credentials, region: config.region, service: 'execute-api', sha256: Hash.bind(null, 'sha256') });
  return signer.sign(new HttpRequest({ protocol: url.protocol, hostname: url.hostname, path: url.pathname, method: 'POST', body,
    headers: { host: url.host, 'content-type': 'application/json', accept: 'application/json',
      'x-cartwheel-oauth-token': token, 'x-amz-content-sha256': createHash('sha256').update(body).digest('hex') },
  }), { signingDate });
}

export async function resolveCredential(config, token, signal, dependencies = {}) {
  signal.throwIfAborted();
  const signed = await abortable(signCredentialRequest(config, token, dependencies), signal);
  signal.throwIfAborted();
  const response = await abortable((dependencies.fetch ?? globalThis.fetch)(config.endpoint, {
    method: signed.method, headers: signed.headers, body: signed.body, redirect: 'error', signal,
  }), signal);
  // No raw gateway/credential response, status text, headers or exception escapes.
  const data = await readBoundedJSON(response, signal);
  if (response.status !== 200) return { status: response.status, code: data?.code };
  if (!data || Object.keys(data).sort().join(',') !== 'apiKey,createdByUser,expiresAt' ||
      typeof data.apiKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.apiKey) ||
      typeof data.createdByUser !== 'string' || !/^user-[A-Za-z0-9_-]{1,251}$/.test(data.createdByUser) ||
      !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() / 1000 || JSON.stringify(data).includes(token)) {
    throw new Error('Invalid credential response');
  }
  return { status: 200, credential: data };
}
