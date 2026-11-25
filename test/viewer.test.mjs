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
  const input = (characterID, motionID, retarget) => host({ method: 'ui/notifications/tool-input',
    params: { arguments: { ...(characterID ? { characterID } : {}), motionID, ...(retarget ? { retarget } : {}) } } });
  const result = (motionID, characterID, retarget) => host({ method: 'ui/notifications/tool-result', params: {
    structuredContent: { status: 'opening', motionID, motionName: motionID, ...(characterID ? { characterID, characterName: 'MHR' } : {}) },
    _meta: { viewerUrl: `https://app-staging.getcartwheel.com/asset-viewer.html#bvhUrl=https%3A%2F%2Fbucket.s3.amazonaws.com%2Fmotion.bvh&motionName=${motionID}${characterID ? '&characterName=MHR' : '&autoRig=true'}${retarget ? '&retargetedMotion=true' : ''}` },
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
  h.host({ method: 'ui/notifications/tool-result', params: { isError: true } });
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

test('reused wrapper cannot replace an original preview with a late retarget result for the same IDs', () => {
  const h = harness();
  h.host({ id: 1, result: { hostCapabilities: {}, hostContext: {} } });
  const character = 'char-upload-MHR', motion = 'motion-1';
  h.input(character, motion, true);
  h.input(character, motion);
  h.result(motion, character);
  assert.equal(h.frames.length, 1);
  h.result(motion, character, true);
  h.result(motion);
  assert.equal(h.frames.length, 1, 'late retarget and automatic-rig results cannot replace the selected preview');
  assert.equal(h.frames[0].removed, undefined);
});

test('exact original character mismatch signals eligibility without simulating user consent or retrying', () => {
  const h = harness();
  h.host({ id: 1, result: { hostCapabilities: { message: { text: true } }, hostContext: {} } });
  h.input('char-1', 'motion-1');
  h.result('motion-1', 'char-1');
  const frame = h.frames.at(-1);
  h.report(frame, 'incompatible_rig');
  const modelContext = h.messages.filter(message => message.method === 'ui/update-model-context').at(-1).params;
  assert.match(modelContext.content[0].text, /requested this exact pair.*one view_character_motion follow-up.*not to retarget/);
  const statusMessage = JSON.parse(h.messages.find(message => message.method === 'ui/message').params.content[0].text);
  assert.equal(statusMessage.message, 'Preview failed: incompatible rigs.');
  assert.doesNotMatch(statusMessage.message, /retarget|consent|request/i);
  assert.equal(modelContext.structuredContent.originalCharacterMismatch, true);
  assert.equal(statusMessage.originalCharacterMismatch, undefined);
  h.report(frame, 'incompatible_rig');
  assert.equal(h.messages.filter(message => message.method === 'ui/update-model-context').length, 2,
    'duplicate terminal status is published only once');
});

test('no-target and previously retargeted mismatches do not signal eligibility', () => {
  for (const retarget of [false, true]) {
    const h = harness();
    h.host({ id: 1, result: { hostCapabilities: {}, hostContext: {} } });
    h.input(retarget ? 'char-1' : undefined, 'motion-1', retarget);
    h.result('motion-1', retarget ? 'char-1' : undefined, retarget);
    h.report(h.frames.at(-1), 'incompatible_rig');
    assert.notEqual(h.messages.filter(message => message.method === 'ui/update-model-context').at(-1).params.structuredContent.originalCharacterMismatch, true);
  }
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
