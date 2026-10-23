// Loads the real application scripts into Node (no browser, no network) for automated tests.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(here, '..');
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
const jspdf = require(path.join(root, 'js/vendor/jspdf.umd.min.js'));
globalThis.jspdf = { jsPDF: jspdf.jsPDF || jspdf.default || jspdf };
for (const f of ['samples', 'i18n', 'core', 'draw', 'report', 'original', 'original2']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
}
export const G = globalThis.G;

/* A document that records every drawing call, to compare geometry numerically. */
export function recordDoc() {
  const pages = [];
  return {
    kind: 'record', pages,
    addPage(w, h) {
      const p = { w, h, ops: [] };
      for (const k of ['line', 'rect', 'poly', 'text', 'area', 'image']) {
        p[k] = (...a) => { p.ops.push({ k, a }); };
      }
      pages.push(p); return p;
    },
    page(i) { return pages[i]; },
    count() { return pages.length; },
  };
}

export function loadSample(i) {
  const s = globalThis.GV_SAMPLES[i];
  return G.parseBuffer(s.name, G.b64ToBuffer(s.b64));
}
export function itemOf(rec, ov, method) {
  return { rec, st: G.stats(rec, method || 'original'), hdr: G.header(rec, ov || {}), comment: '' };
}
export function options(patch) {
  const o = G.defaultOptions(); o.lang = 'en';
  return Object.assign(o, patch || {});
}
