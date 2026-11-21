import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { viewerResource } from '../src/viewer.mjs';

const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const messages = [], frames = [], timers = new Map();
  let receive, timerID = 0;
  const parent = { postMessage: value => messages.push(plain(value)) };
  const status = {}, root = { style: {}, clientWidth: 640, toggleAttribute() {} };
  const document = { documentElement: root, getElementById: id => id === 'status' ? status : { appendChild: frame => frames.push(frame) },
    body: { getBoundingClientRect: () => ({ height: 400 }) },
    createElement: () => ({ setAttribute() {}, addEventListener() {}, remove() { this.removed = true; },
      contentWindow: { postMessage() {} } }),
  };
  const script = viewerResource('staging').text.match(/<script>([\s\S]*)<\/script>/)[1];
  runInNewContext(script, { document, window: { parent, matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: (name, callback) => { if (name === 'message') receive = callback; } },
    CSS: { supports: () => true }, getComputedStyle: () => ({ backgroundColor: 'white' }),
    URL, URLSearchParams,
    setTimeout: (callback, delay) => { const id = ++timerID; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const host = message => receive({ source: parent, data: { jsonrpc: '2.0', ...message } });
  const input = (characterID, motionID) => host({ method: 'ui/notifications/tool-input',
    params: { arguments: { ...(characterID ? { characterID } : {}), motionID } } });
  const result = (motionID) => host({ method: 'ui/notifications/tool-result', params: {
    structuredContent: { status: 'opening', characterID: 'char-upload-MHR', characterName: 'MHR', motionID, motionName: motionID },
    _meta: { viewerUrl: `https://app-staging.getcartwheel.com/asset-viewer.html#characterName=MHR&motionName=${motionID}` },
  } });
  const report = (frame, value) => receive({ source: frame.contentWindow, origin: 'https://app-staging.getcartwheel.com',
    data: { type: 'cartwheel/asset-viewer-status', status: value } });
  const ready = frame => report(frame, 'ready');
  return { host, input, result, ready, report, messages, frames, timers };
}

test('reused wrapper rejects late mismatched results without replacing the current ready frame', () => {
  const h = harness();
  h.host({ id: 1, result: { hostCapabilities: {}, hostContext: {} } });
  h.input(undefined, 'motion-2001');
  h.input(undefined, 'motion-2002');
  h.result('motion-2002');
  const b = h.frames.at(-1);
  h.ready(b);
  const contexts = () => h.messages.filter(message => message.method === 'ui/update-model-context');
  assert.equal(contexts().at(-1).params.structuredContent.motionID, 'motion-2002');
  h.result('motion-2001');
  assert.equal(h.frames.at(-1), b);
  assert.equal(b.removed, undefined);
  assert.equal(contexts().at(-1).params.structuredContent.motionID, 'motion-2002');
  assert.equal(contexts().at(-1).params.structuredContent.status, 'ready');

  h.input(undefined, 'motion-2001');
  h.input(undefined, 'motion-2002');
  h.input(undefined, 'motion-2001');
  h.result('motion-2001');
  const finalA = h.frames.at(-1);
  const count = contexts().length;
  h.report(b, 'asset_load_failed');
  assert.equal(contexts().length, count, 'stale frame failure is ignored before final frame readiness');
  h.ready(finalA);
  h.result('motion-2002');
  assert.equal(h.frames.at(-1), finalA);
  assert.equal(contexts().at(-1).params.structuredContent.motionID, 'motion-2001');
  assert.equal(contexts().at(-1).params.structuredContent.status, 'ready');
});

test('one-input lifecycle and result-only viewer remain usable', () => {
  const h = harness();
  h.host({ id: 1, result: { hostCapabilities: {}, hostContext: {} } });
  h.input(undefined, 'motion-2001');
  h.result('motion-2001');
  assert.equal(h.frames.length, 1, 'single complete input does not enable ordering guard');
  h.result('motion-2002');
  assert.equal(h.frames.length, 2, 'result-only reuse remains compatible after a single input');
  const resultOnly = harness();
  resultOnly.result('motion-2001');
  assert.equal(resultOnly.frames.length, 1);
});
