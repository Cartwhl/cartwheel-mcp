import { safeAsset } from './tool-executor/index.cjs';

export const viewerResourceUri = 'ui://cartwheel/asset-viewer/v5.html';
export const viewerTool = {
  name: 'view_character_motion',
  description: 'Open a 3D preview, embedded in MCP Apps clients or as a private, expiring preview link in other clients. For a selected motion, calls get_motion once with the requested character to obtain its fitting BVH; this can run retarget processing. Omit the character for MHR; omit the motion for rest pose. Each call is self-contained and the host controls panel reuse. Opening does not confirm rendering; the app reports readiness or failure. Never generates a new motion, retries automatically or substitutes a character. Do not first request the same character-targeted get_motion just to open this preview.',
  inputSchema: { type: 'object', properties: {
    characterID: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$' },
    motionID: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$' },
  }, additionalProperties: false },
  outputSchema: { type: 'object', properties: {
    status: { type: 'string', enum: ['opening', 'assets_unavailable'] },
    characterID: { type: 'string' }, motionID: { type: 'string' },
    retryable: { const: false },
    characterName: { type: 'string' }, motionName: { type: 'string' },
    previewUrl: { type: 'string', description: 'Private, expiring link; returned only for clients without MCP Apps.' },
  }, required: ['status', 'characterID', 'characterName', 'retryable'], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  _meta: { ui: { resourceUri: viewerResourceUri } },
};

function appOrigin(environment) {
  if (environment === 'staging') return 'https://app-staging.getcartwheel.com';
  if (environment === 'production') return 'https://app.getcartwheel.com';
  throw new Error('Viewer unavailable');
}

export function supportsViewerApp(capabilities) {
  const mimeTypes = capabilities?.extensions?.['io.modelcontextprotocol/ui']?.mimeTypes;
  return Array.isArray(mimeTypes) && mimeTypes.includes('text/html;profile=mcp-app');
}

// Invocation is authorized by the caller: API key locally, request-scoped OAuth in hosted.
export async function invokeViewer(args, { environment = 'production', invokeTool, app = true } = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.entries(args).some(([key, value]) => !['characterID', 'motionID'].includes(key) ||
        typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(value))) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({
      code: 'invalid_request', message: 'Invalid connector request.', retryable: false,
    }) }] };
  }
  const url = new URL('/asset-viewer.html', appOrigin(environment));
  const characterID = args.characterID ?? 'char-upload-MHR';
  const character = characterID !== 'char-upload-MHR'
    ? await invokeTool('get_character', { characterID }) : undefined;
  if (character?.isError) return character;
  const characterData = character?.structuredContent;
  const label = (value, fallback) => {
    const clean = typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 256) : '';
    return clean || fallback;
  };
  const characterName = label(characterData?.characterName, character ? args.characterID : 'MHR');
  const motionName = args.motionID;
  const identity = { characterID, characterName,
    ...(motionName ? { motionID: args.motionID, motionName } : {}), retryable: false };
  const unavailable = () => {
    const structuredContent = { ...identity, status: 'assets_unavailable' };
    return { isError: true, structuredContent, content: [{ type: 'text', text: JSON.stringify({ ...structuredContent,
      message: 'Preview assets are not available. Keep the requested character and do not retry automatically.' }) }] };
  };
  const meshURL = characterData?.baseGlbURL ?? (characterData?.fileExtension === 'glb' ? characterData.characterFileURL : undefined);
  if (character && (characterData?.characterID !== characterID || characterData.uploadStatus !== 'COMPLETE' || !safeAsset(meshURL))) return unavailable();
  // Validate the character deliverable before starting target-specific processing.
  const motion = args.motionID ? await invokeTool('get_motion', {
    motionID: args.motionID, characterID, downloadType: 'bvh',
  }) : undefined;
  if (motion?.isError) return motion;
  const motionData = motion?.structuredContent;
  if (motion && (motionData?.status !== 'COMPLETED' ||
      motionData.motionID !== args.motionID || (motionData.jobID && motionData.jobID !== args.motionID) ||
      !safeAsset(motionData.bvhURL))) return unavailable();
  const fragment = new URLSearchParams({ characterName });
  if (character) fragment.set('meshUrl', meshURL);
  if (motion) {
    fragment.set('bvhUrl', motionData.bvhURL); fragment.set('motionName', motionName);
    fragment.set('retargetedMotion', 'true');
  }
  url.hash = fragment.toString();
  if (url.hash.length > 32768) return unavailable();
  const structuredContent = { ...identity, status: 'opening', ...(!app ? { previewUrl: url.href } : {}) };
  return { isError: false, structuredContent,
    content: [{ type: 'text', text: `Opening preview of ${characterName}${motionName ? ` with ${motionName}` : ' in its rest pose'}. Rendering is not yet confirmed.${!app ? ` [Private, expiring preview link](${url.href})` : ''}` }],
    // Temporary asset capabilities are for the UI, never embedded in a shared UI resource.
    _meta: { viewerUrl: url.href },
  };
}

export function viewerResource(environment = 'production') {
  const origin = appOrigin(environment);
  return {
    uri: viewerResourceUri, mimeType: 'text/html;profile=mcp-app',
    _meta: { ui: { prefersBorder: true, csp: { frameDomains: [origin] } } },
    text: `<!doctype html><html><head><meta name="referrer" content="no-referrer"><style>:root{color-scheme:light dark;background-color:Canvas;color:CanvasText}html,body{margin:0;font:14px system-ui}body{display:flex;flex-direction:column;max-height:inherit}html[data-fill] body{height:100%;overflow:hidden}#viewer-slot{height:380px;flex:0 1 380px;min-height:0}#viewer-slot:empty{display:none}html[data-fill] #viewer-slot{flex:1 1 0}iframe{display:block;width:100%;height:100%;border:0}p{margin:0;padding:16px;flex:0 1 auto;min-height:0;overflow:auto;box-sizing:border-box}</style></head><body><p id="status" role="status">Loading Cartwheel preview…</p><div id="viewer-slot"></div><script>
let frame, current, initialized = false, capabilities = {}, nextID = 2;
let seen = new Set(), terminal = false, followupSent = false, latest;
let readinessTimer;
const clearReadinessTimer = () => { clearTimeout(readinessTimer); readinessTimer = undefined; };
const slot = document.getElementById('viewer-slot');
const status = document.getElementById('status');
// Only one host style token crosses the viewer boundary. Never inject host CSS,
// custom properties, URLs, or unresolved var()/env()/attr() expressions.
const root = document.documentElement;
const preferredScheme = window.matchMedia('(prefers-color-scheme: dark)');
let hostTheme, hostBackground;
let displayMode = 'inline', dimensions = {};
const validHeight = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const updateLayout = context => {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return;
  if (Object.hasOwn(context,'displayMode')) displayMode = context.displayMode === 'fullscreen' ? 'fullscreen' : 'inline';
  if (Object.hasOwn(context,'containerDimensions')) dimensions = context.containerDimensions ?? {};
  const fixed = validHeight(dimensions.height);
  const maximum = validHeight(dimensions.maxHeight);
  const fill = fixed || displayMode === 'fullscreen';
  root.toggleAttribute('data-fill', fill);
  root.style.height = fixed ? dimensions.height + 'px' : fill ? (maximum ? dimensions.maxHeight + 'px' : '100vh') : '';
  root.style.maxHeight = !fixed && maximum ? dimensions.maxHeight + 'px' : '';
};
const validColor = value => typeof value === 'string' && value.length <= 256 &&
  /^[#a-zA-Z0-9(),.%+ /-]+$/.test(value) &&
  !/\\b(?:var|env|attr)\\s*\\(|\\b(?:currentcolor|inherit|initial|unset|revert|revert-layer)\\b/i.test(value) &&
  CSS.supports('background-color', value);
const sendTheme = () => {
  if (!frame) return;
  frame.contentWindow.postMessage({type:'cartwheel/asset-viewer-theme',
    theme:root.style.colorScheme,backgroundColor:getComputedStyle(root).backgroundColor}, '${origin}');
};
const applyTheme = () => {
  root.style.colorScheme = hostTheme ?? (preferredScheme.matches ? 'dark' : 'light');
  root.style.backgroundColor = hostBackground ?? 'Canvas';
  sendTheme();
};
const updateTheme = context => {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return;
  if (Object.hasOwn(context,'theme')) hostTheme = ['light','dark'].includes(context.theme) ? context.theme : undefined;
  const variables = context.styles?.variables;
  if (variables && Object.hasOwn(variables,'--color-background-primary')) {
    const value = variables['--color-background-primary'];
    hostBackground = validColor(value) ? value : undefined;
  }
  applyTheme();
};
preferredScheme.addEventListener('change', applyTheme);
applyTheme();
const texts = {loading:'Opening preview; rendering is not yet confirmed.',ready:'Preview is ready.',incompatible_rig:'Preview failed: the motion and character rigs are incompatible. Keep the requested character; choose a compatible existing motion. Do not retry automatically.',asset_load_failed:'Preview failed: an asset could not be loaded. Keep the requested character. Do not retry automatically or claim the preview is showing.'};
const rpc = (method, params) => {
  const id = nextID++;
  // Responses (including method-not-found and host denial) are consumed once.
  // No retry, promise rejection or request-response loop is created.
  window.parent.postMessage({jsonrpc:'2.0',id,method,params}, '*');
};
const publish = () => {
  if (!initialized || !latest || seen.has(latest)) return;
  seen.add(latest);
  const content = [{type:'text',text:texts[latest]}];
  rpc('ui/update-model-context', {content,structuredContent:{...current,status:latest}});
  if (['incompatible_rig','asset_load_failed'].includes(latest) && !followupSent && capabilities.message?.text) {
    followupSent = true;
    rpc('ui/message', {role:'user',content:[{type:'text',text:JSON.stringify({...current,status:latest,message:texts[latest]})}]});
  }
};
const report = value => {
  if (!current || terminal || latest === value || (latest === 'ready' && value === 'loading')) return;
  latest = value;
  if (['incompatible_rig','asset_load_failed'].includes(value)) terminal = true;
  if (value === 'ready' || terminal) clearReadinessTimer();
  status.textContent = texts[value]; status.hidden = value === 'ready';
  publish(); notifySize();
};
const reset = () => {
  clearReadinessTimer();
  if (frame) frame.remove();
  frame = undefined; current = undefined; latest = undefined;
  seen = new Set(); terminal = false; followupSent = false;
  status.hidden = false; status.textContent = 'Loading Cartwheel preview…';
};
let lastWidth, lastHeight;
const notifySize = () => {
  // Fixed containers and unbounded fullscreen are host-owned. Never feed their
  // viewport-dependent body height back into the host's iframe auto-sizing.
  if (validHeight(dimensions.height) || (displayMode === 'fullscreen' && !validHeight(dimensions.maxHeight))) {
    lastWidth = lastHeight = undefined;
    return;
  }
  // Natural body height includes wrapped status text, independent of host height.
  const height = Math.ceil(document.body.getBoundingClientRect().height);
  const width = document.documentElement.clientWidth;
  if (width === lastWidth && height === lastHeight) return;
  lastWidth = width; lastHeight = height;
  window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height,width}}, '*');
};
window.addEventListener('resize', notifySize);
window.addEventListener('message', event => {
  if (frame && event.source === frame.contentWindow && event.origin === '${origin}') {
    const data = event.data;
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 2 &&
        data.type === 'cartwheel/asset-viewer-status' && typeof data.status === 'string' && Object.hasOwn(texts,data.status)) report(data.status);
    return;
  }
  if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
  const message = event.data;
  if (Number.isSafeInteger(message.id) && message.id >= 2 && message.id < nextID) return;
  if (message.id === 1 && message.result && !initialized) {
    initialized = true; capabilities = message.result.hostCapabilities ?? {};
    updateTheme(message.result.hostContext);
    updateLayout(message.result.hostContext);
    window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'}, '*'); notifySize(); publish(); return;
  }
  if (message.method === 'ui/notifications/host-context-changed') {
    if (initialized) { updateTheme(message.params); updateLayout(message.params); notifySize(); }
    return;
  }
  if (message.method === 'ui/notifications/tool-input') { reset(); notifySize(); return; }
  if (message.method !== 'ui/notifications/tool-result') return;
  reset();
  try {
    const url = new URL(message.params?._meta?.viewerUrl);
    if (message.params?.isError || url.origin !== '${origin}' || url.pathname !== '/asset-viewer.html' || url.search || url.username || url.password) throw new Error();
    const data = message.params.structuredContent;
    if (data?.status !== 'opening' || typeof data.characterID !== 'string' || typeof data.characterName !== 'string') throw new Error();
    current = {characterID:data.characterID,characterName:data.characterName};
    for (const key of ['motionID','motionName']) if (typeof data[key] === 'string') current[key] = data[key];
    for (const key of ['variationID','outputIndex']) if (Number.isSafeInteger(data[key]) && data[key] >= 0) current[key] = data[key];
    // A new browsing context per result: old WindowProxy events cannot match.
    frame = document.createElement('iframe');
    frame.title = 'Cartwheel character and motion viewer'; frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('credentialless',''); frame.setAttribute('sandbox','allow-scripts allow-same-origin');
    const instance = frame;
    frame.addEventListener('load', () => { if (frame === instance) sendTheme(); });
    // One total deadline covers document/entry boot and asset fetches. A loading
    // handshake does not extend it. Guard even an already-queued stale callback.
    readinessTimer = setTimeout(() => {
      if (frame === instance && latest !== 'ready' && !terminal) report('asset_load_failed');
    }, 30000);
    frame.src = url.href; slot.appendChild(frame); report('loading');
  } catch { reset(); status.textContent = 'Preview unavailable. Reopen it from the conversation.'; notifySize(); }
});
window.parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'Cartwheel viewer',version:'0.5.0'},appCapabilities:{availableDisplayModes:['fullscreen']}}}, '*');
</script></body></html>`,
  };
}
