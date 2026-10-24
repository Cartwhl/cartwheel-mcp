import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { invokePreviews, previewsResource } from '../src/previews.mjs';

const image = 'https://resources-staging.getcartwheel.com/character.png?signature=private';
const args = { items: [{ title: 'Clementine', characterID: 'character-1', media: { type: 'image', url: image } }] };
const plain = value => JSON.parse(JSON.stringify(value));

test('gallery accepts mixed previews without processing and keeps capabilities out of model-visible results', () => {
  const result = invokePreviews({ items: [...args.items,
    { title: 'Walk 02', motionID: 'motion-2', characterID: 'character-1', media: { type: 'video', url: 'https://bucket.s3.us-east-1.amazonaws.com/walk.mp4' } },
    { title: 'No thumbnail', characterID: 'character-3' }] });
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent.items[1], { id: 'item-2', title: 'Walk 02', motionID: 'motion-2', characterID: 'character-1' });
  assert.equal(result._meta.previewItems[0].media.url, image);
  assert.equal(result._meta.previewItems[2].media, undefined);
  assert.doesNotMatch(JSON.stringify([result.content, result.structuredContent]), /https:|signature/);
});

test('gallery rejects malformed targets, ambiguous duplicate selections and untrusted media', () => {
  for (const input of [null, [], {}, { items: [] }, { items: Array(21).fill(args.items[0]) },
    { ...args, unknown: true }, { items: [args.items[0], args.items[0]] },
    ...[{ title: 'Missing target' }, { title: 'Bad', characterID: 3 }, { title: 'Bad', motionID: '../path' },
      { title: ' ', characterID: 'x' }, { title: 'x\0y', characterID: 'x' }, { title: 'x'.repeat(161), characterID: 'x' },
      { title: 'Bearer private', characterID: 'x' }, { ...args.items[0], variationID: 1 },
      ...['http://resources.getcartwheel.com/x.png', 'https://evil.example/x.png',
        'https://resources.getcartwheel.com.evil.example/x.png', 'https://user:pass@resources.getcartwheel.com/x.png',
        'https://resources.getcartwheel.com:443/x.png#fragment', 'data:image/png;base64,AAAA', 'file:///tmp/x.png']
        .map(url => ({ ...args.items[0], media: { type: 'image', url } })),
    ].map(item => ({ items: [item] }))]) {
    const result = invokePreviews(input);
    assert.equal(result.isError, true, JSON.stringify(input));
    assert.equal(result._meta, undefined);
    assert.doesNotMatch(JSON.stringify(result), /private|evil\.example|user:pass|file:/);
  }
  assert.throws(() => previewsResource('https://evil.example'), /unavailable/);
});

function harness() {
  const messages = [], children = [], frames = [], timers = new Map();
  let receive, timerID = 0;
  const parent = { postMessage: value => messages.push(plain(value)) };
  const status = {}, root = { style: {}, clientWidth: 640 };
  const document = { documentElement: root, getElementById: id => id === 'status' ? status : { append: frame => frames.push(frame) },
    body: { getBoundingClientRect: () => ({ height: 350 }) },
    createElement: () => ({ style: {}, setAttribute() {}, remove() { this.removed = true; },
      contentWindow: { postMessage: (value, origin) => children.push({ value: plain(value), origin }) } }),
  };
  const html = previewsResource('staging').text;
  runInNewContext(html.match(/<script>([\s\S]+)<\/script>/)[1], {
    document, window: { parent, matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener: (name, callback) => { if (name === 'message') receive = callback; } },
    CSS: { supports: () => true }, getComputedStyle: () => ({ backgroundColor: 'rgb(246, 246, 246)' }),
    setTimeout: (callback, delay) => { const id = ++timerID; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const host = message => receive({ source: parent, data: { jsonrpc: '2.0', ...message } });
  const child = (message, source = frames.at(-1)?.contentWindow, origin = 'https://app-staging.getcartwheel.com') => receive({ source, origin, data: message });
  const init = capabilities => host({ id: 1, result: { hostCapabilities: capabilities ?? { message: { text: {} } }, hostContext: { theme: 'dark' } } });
  const result = () => host({ method: 'ui/notifications/tool-result', params: invokePreviews(args) });
  return { host, child, init, result, messages, children, frames, timers, status };
}

test('gallery only sends known selected identities through a negotiated host message', () => {
  const h = harness();
  h.result();
  h.child({ type: 'cartwheel/asset-previews-ready' });
  assert.equal(h.children.at(-1).value.canSendMessage, false);
  h.init();
  assert.equal(h.children.at(-1).value.canSendMessage, true);
  assert.equal(h.frames[0].src, 'https://app-staging.getcartwheel.com/asset-previews.html');
  const click = { type: 'cartwheel/asset-previews-open', id: 'item-1' };
  h.child(click, {}, 'https://app-staging.getcartwheel.com');
  h.child(click, h.frames[0].contentWindow, 'https://evil.example');
  h.child({ ...click, id: 'unknown' });
  h.child({ ...click, characterID: 'substituted-character' });
  assert.equal(h.messages.filter(message => message.method === 'ui/message').length, 0);
  h.child(click); h.child(click);
  const requests = h.messages.filter(message => message.method === 'ui/message');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].params.role, 'user');
  assert.match(requests[0].params.content[0].text, /view_character_motion.*character-1/);
  assert.doesNotMatch(JSON.stringify(requests[0]), /https:|signature|substituted/);
  h.host({ id: requests[0].id, result: {} });
  assert.deepEqual(h.children.at(-1), { origin: 'https://app-staging.getcartwheel.com',
    value: { type: 'cartwheel/asset-previews-action', id: 'item-1', state: 'sent' } });
});

test('message refusal, timeout and stale results cannot retry or act on another gallery instance', () => {
  for (const outcome of ['denied', 'timeout', 'replaced']) {
    const h = harness(); h.init(); h.result();
    const oldFrame = h.frames[0];
    h.child({ type: 'cartwheel/asset-previews-ready' });
    h.child({ type: 'cartwheel/asset-previews-open', id: 'item-1' });
    const request = h.messages.find(message => message.method === 'ui/message');
    if (outcome === 'denied') h.host({ id: request.id, error: { code: -32000 } });
    if (outcome === 'timeout') [...h.timers.values()].find(timer => timer.delay === 8000).callback();
    if (outcome === 'replaced') {
      h.result();
      const count = h.messages.length;
      h.child({ type: 'cartwheel/asset-previews-open', id: 'item-1' }, oldFrame.contentWindow);
      assert.equal(h.messages.length, count);
      assert.equal(oldFrame.removed, true);
    } else assert.equal(h.children.at(-1).value.state, 'error');
    const count = h.children.length;
    h.host({ id: request.id, result: {} });
    assert.equal(h.children.length, count);
    assert.equal(h.messages.filter(message => message.method === 'ui/message').length, 1);
  }
  const h = harness(); h.init({}); h.result();
  h.child({ type: 'cartwheel/asset-previews-ready' });
  h.child({ type: 'cartwheel/asset-previews-open', id: 'item-1' });
  assert.equal(h.messages.filter(message => message.method === 'ui/message').length, 0);
  assert.equal(h.children.at(-1).value.state, 'error');
});
