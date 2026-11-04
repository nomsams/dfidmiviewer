import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { G, root } from './harness.mjs';

function environment() {
  const nodes = new Map(), context2d = new Proxy({}, { get: (o, k) => o[k] || (() => {}), set: (o, k, v) => (o[k] = v, true) });
  function node() {
    return { dataset: {}, style: {}, value: '', files: [], hidden: true, listeners: {}, clientWidth: 800, clientHeight: 400,
      classList: { toggle() {} }, addEventListener(k, f) { this.listeners[k] = f; }, setAttribute() {}, focus() {},
      getContext: () => context2d, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) };
  }
  const document = { readyState: 'complete', body: node(), documentElement: node(),
    querySelector(s) { if (!nodes.has(s)) nodes.set(s, node()); return nodes.get(s); }, querySelectorAll: () => [], createElement: node, addEventListener() {} };
  const appG = Object.assign({}, G), state = { api: null };
  appG.exporter = { init(api) { state.api = api; }, render() {} };
  const context = { G: appG, document, console, setTimeout, clearTimeout, Map, Promise, TextDecoder, Blob, URL, jspdf: globalThis.jspdf,
    localStorage: { getItem: () => null, setItem() {} }, location: { hash: '' }, addEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }) };
  context.window = context;
  vm.createContext(context);
  return { context, state, node, appG, load(name) { vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), context); } };
}
const sampleBuffer = () => G.b64ToBuffer(globalThis.GV_SAMPLES[1].b64);
const descriptor = (name, read) => ({ name, path: name, size: 10, mtime: 0, read });

test('overlapping file imports complete in order and share duplicate detection', async () => {
  const env = environment(); env.load('app');
  let release, started;
  const reading = new Promise(r => { started = r; });
  const held = new Promise(r => { release = r; });
  const first = descriptor('first.DFI', async () => { started(); await held; return sampleBuffer(); });
  const a = env.appG.app.addFiles([first]); await reading;
  const b = env.appG.app.addFiles([first, descriptor('second.DFI', async () => G.b64ToBuffer(globalThis.GV_SAMPLES[0].b64))]);
  const done = Promise.allSettled([a, b]);
  await new Promise(r => setTimeout(r, 10)); release();
  const results = await done;
  assert.ok(results.every(r => r.status === 'fulfilled'), results.map(r => String(r.reason)).join('; '));
  assert.deepEqual(Array.from(env.appG.S.entries, e => e.rec.meta.fileName), ['first.DFI', 'second.DFI']);
  assert.equal(env.appG.S.load, null);
});

test('clearing files cancels active and queued imports, and a later import still works', async () => {
  const env = environment(); env.load('app');
  let release, started;
  const reading = new Promise(r => { started = r; }), held = new Promise(r => { release = r; });
  const a = env.appG.app.addFiles([descriptor('old.DFI', async () => { started(); await held; return sampleBuffer(); })]);
  await reading;
  const b = env.appG.app.addFiles([descriptor('queued.DFI', async () => sampleBuffer())]);
  const done = Promise.allSettled([a, b]); env.state.api.clear(); release(); await done;
  assert.equal(env.appG.S.entries.length, 0, 'cleared files cannot reappear after an asynchronous read');
  assert.equal(env.appG.S.load, null);
  await env.appG.app.addFiles([descriptor('new.DFI', async () => sampleBuffer())]);
  assert.equal(env.appG.S.entries.length, 1);
  assert.equal(env.appG.S.entries[0].rec.meta.fileName, 'new.DFI');
});

test('chart switches safely from a hovered long recording to a shorter or empty recording', () => {
  const env = environment(); env.load('chart');
  const canvas = env.node(), tip = env.node(), chart = new env.appG.Chart(canvas, tip);
  const rec = n => ({ samples: Array.from({ length: n }, (_, i) => ({ tt: i, tm: i, pBar: 1, qLmin: 2, vL: i })), events: [], meta: {} });
  chart.set({ rec: rec(100) }); canvas.listeners.mousemove({ clientX: 650, clientY: 150 });
  assert.equal(tip.hidden, false);
  assert.doesNotThrow(() => chart.set({ rec: rec(2) }));
  assert.equal(tip.hidden, true, 'old recording tooltip is cleared');
  canvas.listeners.mousemove({ clientX: 650, clientY: 150 });
  assert.doesNotThrow(() => chart.set({ rec: rec(0) }));
  assert.equal(tip.hidden, true);
});

test('the same recording arriving by another route (copy, zip, renamed) is recognised by its content and skipped', async () => {
  const env = environment(); env.load('app');
  await env.appG.app.addFiles([descriptor('a.DFI', async () => sampleBuffer())]);
  await env.appG.app.addFiles([descriptor('a (1).DFI', async () => sampleBuffer()), descriptor('inside.zip/a.DFI', async () => sampleBuffer()), descriptor('other.DFI', async () => G.b64ToBuffer(globalThis.GV_SAMPLES[0].b64))]);
  assert.deepEqual(Array.from(env.appG.S.entries, (e) => e.rec.meta.fileName), ['a.DFI', 'other.DFI']);
  assert.equal(env.appG.S.skipped.filter((x) => x.text === G.t('err.duplicate')).length, 2, 'both repeats are listed as already added');
  assert.equal(env.appG.S.errors.length, 0, 'a repeat is not an error notice');
});
