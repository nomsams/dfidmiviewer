// Static checks of the page and the UI script: catches startup crashes (missing elements, misused selectors) without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './harness.mjs';

const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html'), app = read('js/app.js');

test('every #id looked up by app.js exists in index.html', () => {
  const ids = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]).concat([...app.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]))); // static page + elements the app creates itself
  const wanted = new Set([...app.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]).concat([...app.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1])));
  const missing = [...wanted].filter((i) => !ids.has(i));
  assert.deepEqual(missing, []);
});

test('single-element lookups are never used as lists (and vice versa)', () => {
  assert.equal(/[^$]\$\('[^']*'\)\.(forEach|map|filter|length)\b/.test(app), false, '$() used like $$()');
  assert.equal(/\$\$\('[^']*'\)\.(onclick|onchange|value|hidden|checked|innerHTML|classList)\b/.test(app), false, '$$() used like $()');
});

test('every data-opt / data-ov path in the designer exists in the defaults', async () => {
  const { G } = await import('./harness.mjs');
  const opt = G.defaultOptions();
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const paths = [...html.matchAll(/data-opt="([\w.]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length > 60, 'found ' + paths.length + ' bindings');
  assert.deepEqual(paths.filter((p) => get(opt, p) === undefined), []);
});

test('scripts are classic scripts (no modules, no network) so the page also works from disk', () => {
  assert.equal(/type="module"/.test(html), false);
  assert.equal(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)="https?:/.test(html), false, 'nothing is loaded from the network; the only outside address is the pqview link');
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const f of order) assert.ok(fs.existsSync(path.join(root, f)), f + ' exists');
  assert.ok(order.indexOf('js/original.js') > order.indexOf('js/report.js') && order.indexOf('js/app.js') > order.indexOf('js/original.js'));
});

test('no syntax newer than the supported browsers in the app scripts', () => {
  for (const f of ['core', 'draw', 'report', 'original', 'chart', 'app', 'i18n']) {
    const src = read('js/' + f + '.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const [re, what] of [[/\?\.[\w[(]/, 'optional chaining'], [/\?\?[^?]/, 'nullish coalescing'], [/\.at\(/, 'Array.at'], [/\.flatMap?\(/, 'flat'], [/\.replaceAll\(/, 'replaceAll'], [/\.findLast\(/, 'findLast'], [/structuredClone/, 'structuredClone'], [/Object\.hasOwn\(/, 'Object.hasOwn']]) {
      assert.equal(re.test(src), false, f + '.js uses ' + what);
    }
  }
});

test('the export view: every element it looks up exists, scripts load in order, and its three ways to add files are wired', () => {
  const ex = read('js/exporter.js'), ids = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
  const wanted = new Set([...ex.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]));
  assert.deepEqual([...wanted].filter((i) => !ids.has(i)), [], 'ids used by exporter.js');
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  ['js/i18n.js', 'js/i18n-export.js'].reduce((a, b) => { assert.ok(order.indexOf(b) > order.indexOf(a), b + ' after ' + a); return b; });
  ['js/zip.js', 'js/intake.js', 'js/xlsx.js', 'js/export.js', 'js/exporter.js', 'js/app.js'].reduce((a, b) => { assert.ok(order.indexOf(a) >= 0 && order.indexOf(b) > order.indexOf(a), b + ' after ' + a); return b; });
  assert.ok(/id="xDrop"/.test(html) && /id="xPick"/.test(html) && /id="xPickDir"/.test(html) && /id="dirInput"[^>]*webkitdirectory/.test(html), 'drop box, file button, folder button');
  assert.ok(/drop\.addEventListener\('click'/.test(ex) && /\$\('#xPick'\)\.onclick/.test(ex), 'clicking the box and the button both open the file chooser');
  assert.ok(/fromDrop\(ev\.dataTransfer\)/.test(app), 'dropping is handled by the folder-aware intake');
  assert.ok(/data-mode="export"/.test(html) && /data-mode="simple"/.test(html) && /data-mode="advanced"/.test(html));
});
