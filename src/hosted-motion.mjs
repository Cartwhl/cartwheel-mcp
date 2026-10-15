import { executeTool, ToolInputError } from './tool-executor/index.cjs';
import { hostedTools as motionTools, hostedRequest, projectHostedOutput } from './tool-executor/hosted.cjs';
import { resolveCredential } from './hosted-credential.mjs';
import { abortable, readBoundedJSON } from './hosted-transport.mjs';
export { motionTools };
export { motionConfig } from './hosted-credential.mjs';

const resolverErrors = {
  invalid_request: [400, 'Invalid connector request.'],
  invalid_token: [401, 'Reconnect to Cartwheel with a valid access token.'],
  service_access_denied: [403, 'The hosted MCP service is not authorized. Request was not submitted.'],
  connection_required: [403, 'Connect an API key through Cartwheel paid consent before using motion tools.'],
  account_unavailable: [403, 'The Cartwheel account is unavailable.'],
  key_access_denied: [403, 'The selected key is no longer available.'],
  binding_changed: [409, 'Connection state changed. Review your Cartwheel connection.'],
  identity_provider_unavailable: [503, 'Authorization could not be verified. Restart from your MCP client.'],
  connector_disabled: [503, 'The connector is not configured.'],
  connector_unavailable: [503, 'The connector is temporarily unavailable. Request was not submitted.'],
};
const messages = {
  ...Object.fromEntries(Object.entries(resolverErrors).map(([code, [, message]]) => [code, message])),
  authorization_too_slow: 'Request was not submitted. Reauthenticate before trying again.',
  motion_unavailable: 'Motion data could not be retrieved.',
  generation_outcome_unknown: 'Generation may have been accepted. Do not automatically resubmit. Inspect your Cartwheel batches before trying again.',
  mutation_outcome_unknown: 'The change may have been accepted. Do not automatically resubmit. Inspect scene state or export status before trying again.',
  motion_request_rejected: 'Cartwheel rejected the request. Check key access, available credits and request parameters. Do not automatically resubmit generation.',
};
export function motionError(code, challenge) {
  // Internal allowlist only, never pass a remote code or message through.
  if (!Object.hasOwn(messages, code)) code = 'connector_unavailable';
  const body = { code, message: messages[code], retryable: false };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }],
    ...(code === 'invalid_token' ? { _meta: { 'mcp/www_authenticate': `${challenge}, error="invalid_token"` } } : {}) };
}

export async function invokeHostedMotion(config, operation, args, token, challenge, {
  fetch: fetchAPI = globalThis.fetch, credentials, signingDate, signal,
  generationTimeoutMs = 32_000, readTimeoutMs = 10_000, executionTimeoutMs = 24_000,
} = {}) {
  let request;
  try { request = hostedRequest(operation, args); } // All schemas/semantic validation BEFORE credentials.
  catch { return motionError('invalid_request', challenge); }
  const writing = !motionTools.find(tool => tool.name === operation).annotations.readOnlyHint;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const deadline = Date.now() + (writing ? generationTimeoutMs : readTimeoutMs);
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  let attempted = false;
  try {
    const resolved = await resolveCredential(config, token, controller.signal, { fetch: fetchAPI, credentials, signingDate });
    if (resolved.status !== 200) {
      const code = Object.hasOwn(resolverErrors, resolved.code) && resolverErrors[resolved.code][0] === resolved.status
        ? resolved.code : 'connector_unavailable';
      return motionError(code, challenge);
    }
    const { apiKey, createdByUser, expiresAt } = resolved.credential;
    const remaining = deadline - Date.now();
    if (controller.signal.aborted || remaining <= 0 || (writing && remaining < 22_000) || expiresAt <= Date.now() / 1000) {
      return motionError('authorization_too_slow', challenge);
    }
    // Always inject a byte-bounded transport. The local executor's default json()
    // path must never be used here. One execution budget covers history preflight.
    const requestJSON = async (url, init) => {
      if (controller.signal.aborted || init.signal.aborted || expiresAt <= Date.now() / 1000) throw new Error('Authorization expired');
      attempted = true; // Only now could actual API work have been accepted.
      const response = await abortable(fetchAPI(url, init), init.signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw Object.assign(new Error('Cartwheel rejected the request'), { status: response.status });
      }
      return response.status === 204 ? { status: 204 } : readBoundedJSON(response, init.signal);
    };
    const data = await executeTool(operation, request.args, { apiKey, environment: config.environment, requestJSON,
      signal: controller.signal, timeoutMs: Math.min(24_000, executionTimeoutMs, remaining), ...(writing ? { createdByUser } : {}) });
    const output = projectHostedOutput(operation, data);
    const serialized = JSON.stringify(output);
    if (serialized.includes(apiKey) || serialized.includes(token) || /Bearer\s/i.test(serialized)) throw new Error('Credential reflection');
    return { isError: false, structuredContent: output, content: [{ type: 'text', text: serialized }] };
  } catch (error) {
    if (!attempted) return motionError('connector_unavailable', challenge);
    if (error instanceof ToolInputError || ([400, 401, 402, 403, 404, 429].includes(error?.status) && !(writing && error.status === 400))) {
      return motionError('motion_request_rejected', challenge);
    }
    return motionError(writing ? operation === 'generate_motion' ? 'generation_outcome_unknown' : 'mutation_outcome_unknown' : 'motion_unavailable', challenge);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
