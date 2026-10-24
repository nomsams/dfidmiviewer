// Compares the Original reports with the measured geometry of three real printouts (tests/fixtures/spec-*.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { G, root, recordDoc, loadSample, itemOf, options } from './harness.mjs';

const spec = (n) => JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/spec-' + n + '.json'), 'utf8'));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs specimen ${b} (tol ${tol})`);

/* the specimen was printed with sleeve 1, levels 1-1 m, comma decimals, flow curve off */
function build(reports) {
  const rec = loadSample(1), opt = options({ layout: 'classic' });
  opt.o.dec = ','; Object.assign(opt.o.reports, { time: false, pvg: false, pvf: false }, reports);
  const doc = recordDoc();
  G.buildDocument(doc, [itemOf(rec, { sleeve: '1', top: '1', bottom: '1' })], opt, 'records');
  return doc;
}
const textLeft = (op) => { const [s, x, , o] = op.a; o && 0; const opt = op.a[3] || {}; const w = G.textWidth(s, opt.size || 8, opt.bold); return opt.align === 'center' ? x - w / 2 : opt.align === 'right' ? x - w : x; };
const texts = (page) => page.ops.filter((o) => o.k === 'text').map((o) => ({ s: o.a[0], x: textLeft(o), y: o.a[2], size: (o.a[3] || {}).size, c: (o.a[3] || {}).c || '#000000', bold: !!(o.a[3] || {}).bold }));
const lines = (page) => page.ops.filter((o) => o.k === 'line').map((o) => ({ x1: o.a[0], y1: o.a[1], x2: o.a[2], y2: o.a[3], ...(o.a[4] || {}) }));

test('time report: page, frame, columns and header match the printout', () => {
  const doc = build({ time: true }), P = doc.page(0), sp = spec('time');
  assert.equal(doc.count(), 1);
  near(P.w, 297, 0.1, 'page width'); near(P.h, 210, 0.1, 'page height');
  const rects = P.ops.filter((o) => o.k === 'rect').map((o) => o.a);
  const frame = rects.find((r) => Math.abs(r[1] - 35.98) < 0.1 && r[2] > 280);
  assert.ok(frame, 'main frame present');
  near(frame[0], 5, 0.05, 'frame x'); near(frame[2], 286.97, 0.1, 'frame width'); near(frame[3], 166.97, 0.1, 'frame height');
  const head = rects.find((r) => Math.abs(r[1] - 9.99) < 0.05 && r[2] > 280); assert.ok(head, 'header box');
  near(head[3], 14.96, 0.1, 'header height');
  /* four column separators */
  const seps = lines(P).filter((l) => Math.abs(l.x1 - l.x2) < 0.01 && Math.abs(l.y1 - 35.98) < 0.05 && l.y2 > 200).map((l) => l.x1).sort((a, b) => a - b);
  const want = sp.lines.filter((l) => Math.abs(l.x1 - l.x2) < 0.01 && l.lw > 0.4).map((l) => l.x1).sort((a, b) => a - b);
  assert.equal(seps.length, 4); seps.forEach((x, i) => near(x, want[i], 0.1, 'separator ' + i));
});

test('time report: every text of the printout is reproduced at its position', () => {
  const got = texts(build({ time: true }).page(0)), sp = spec('time');
  const skip = (t) => t.t.trim() === '' || /^\(Contract/.test(t.t); // the contract falls back to today's date; everything else, including the original's literal "Unknow", must match
  let checked = 0;
  for (const t of sp.texts.filter((x) => !skip(x))) {
    const m = got.filter((g) => g.s === t.t || g.s.trim() === t.t.trim()).sort((a, b) => Math.abs(a.y - t.y) - Math.abs(b.y - t.y))[0];
    assert.ok(m, 'text present: "' + t.t + '"');
    near(m.y, t.y, 0.2, 'baseline of "' + t.t + '"');
    near(m.x, t.x, Math.max(0.9, 0.045 * G.textWidth(t.t, t.size || 8, t.font === 'F2')), 'x of "' + t.t + '"');
    if (t.size) near(m.size, t.size, 0.2, 'size of "' + t.t + '"');
    if (t.color !== '#000000') assert.equal(m.c, t.color, 'colour of "' + t.t + '"');
    checked++;
  }
  assert.ok(checked >= 18, 'checked ' + checked + ' texts');
  assert.ok(got.some((g) => g.s === 'Unknow'), 'the original prints the literal default "Unknow" for an unnamed grout');
});

test('time report: grid, ticks and plot height match', () => {
  const P = build({ time: true }).page(0), L = lines(P), sp = spec('time');
  const dashed = L.filter((l) => l.dash && Math.abs(l.x1 - l.x2) < 0.01).map((l) => l.x1).sort((a, b) => a - b);
  const wantDashed = sp.lines.filter((l) => l.dash && Math.abs(l.x1 - l.x2) < 0.01).map((l) => l.x1).sort((a, b) => a - b);
  assert.equal(dashed.length, 10); dashed.forEach((x, i) => near(x, wantDashed[i], 0.06, 'dashed division ' + i));
  const dy = L.filter((l) => l.dash).map((l) => [l.y1, l.y2]).flat();
  near(Math.min(...dy), 45.76, 0.06, 'plot top'); near(Math.max(...dy), 104.56, 0.1, 'plot bottom (352.78 s at 1 cm = 60 s)');
  const ticks = L.filter((l) => Math.abs(l.y1 - l.y2) < 0.01 && l.x1 < 5 && l.x2 <= 5.01).map((l) => l.y1).sort((a, b) => a - b);
  const wantTicks = sp.lines.filter((l) => Math.abs(l.y1 - l.y2) < 0.01 && l.x1 < 5 && l.x1 > 4 && l.x2 - l.x1 < 1 && l.lw > 0.2 && l.stroke === '#000000').map((l) => l.y1).sort((a, b) => a - b);
  assert.equal(ticks.length, wantTicks.length); ticks.forEach((y, i) => near(y, wantTicks[i], 0.06, 'time tick ' + i));
  const horiz = L.filter((l) => Math.abs(l.y1 - l.y2) < 0.01 && l.x2 - l.x1 > 50 && l.w < 0.2).map((l) => l.y1);
  for (const y of [42.29, 45.76, 104.56, 107.32]) assert.ok(horiz.some((h) => Math.abs(h - y) < 0.1), 'thin line at y=' + y);
});

test('time report: pressure curve and red limit line sit where the printout has them', () => {
  const P = build({ time: true }).page(0), sp = spec('time');
  const polys = P.ops.filter((o) => o.k === 'poly');
  const blue = polys.filter((o) => (o.a[1] || {}).c === '#0000ff').flatMap((o) => o.a[0]);
  const red = polys.filter((o) => (o.a[1] || {}).c === '#ff0000').flatMap((o) => o.a[0]);
  assert.ok(blue.length > 300, 'one point per sample (' + blue.length + ')');
  const bs = sp.lines.filter((l) => l.stroke === '#0000ff' && l.lw > 0.2);
  const sx = bs.flatMap((l) => [l.x1, l.x2]), sy = bs.flatMap((l) => [l.y1, l.y2]);
  near(Math.min(...blue.map((p) => p[0])), Math.min(...sx), 0.35, 'curve left'); near(Math.max(...blue.map((p) => p[0])), Math.max(...sx), 0.35, 'curve right');
  near(Math.min(...blue.map((p) => p[1])), 45.76, 0.2, 'curve top'); near(Math.max(...blue.map((p) => p[1])), Math.max(...sy), 0.35, 'curve bottom');
  const rs = sp.lines.filter((l) => l.stroke === '#ff0000');
  near(red[0][0], rs[0].x1, 0.1, 'pressure-limit line x');
});

test('time report: page footer matches', () => {
  const t = texts(build({ time: true }).page(0));
  const f = t.find((x) => x.s === '1/1'); assert.ok(f); near(f.y, 207.35, 0.1, 'page number y'); near(f.x + G.textWidth('1/1', 8.16, true), 291.99, 0.3, 'page number right edge');
  assert.ok(t.some((x) => x.s.startsWith('JEAN LUTZ S.A') && Math.abs(x.x - 212.09) < 0.2), 'footer line');
});

test('pressure/volume/GIN report: grid, axes and curves match', () => {
  const doc = build({ pvg: true }), P = doc.page(0), sp = spec('pvg'), L = lines(P);
  assert.equal(doc.count(), 1);
  const majorX = L.filter((l) => Math.abs(l.x1 - l.x2) < 0.01 && l.w === 0.25).map((l) => l.x1).sort((a, b) => a - b);
  const wantX = sp.lines.filter((l) => Math.abs(l.x1 - l.x2) < 0.01 && l.lw > 0.2 && l.stroke === '#000000').map((l) => l.x1).sort((a, b) => a - b);
  assert.equal(majorX.length, 11); majorX.forEach((x, i) => near(x, wantX[i], 0.4, 'major vertical ' + i));
  const majorY = L.filter((l) => Math.abs(l.y1 - l.y2) < 0.01 && l.w === 0.25).map((l) => l.y1).sort((a, b) => a - b);
  const wantY = sp.lines.filter((l) => Math.abs(l.y1 - l.y2) < 0.01 && l.lw > 0.2 && l.stroke === '#000000').map((l) => l.y1).sort((a, b) => a - b);
  assert.equal(majorY.length, 11); majorY.forEach((y, i) => near(y, wantY[i], 0.1, 'major horizontal ' + i));
  assert.equal(L.filter((l) => l.w === 0.17 && Math.abs(l.x1 - l.x2) < 0.01).length, 10, 'ten minor verticals');
  const got = texts(P), want = sp.texts.filter((t) => ['Pressure (bar)', 'Volume (l)', 'Pressure/Volume/GIN'].includes(t.t) || /^(Pressure|Volume)/.test(t.t));
  for (const t of want) { const m = got.find((g) => g.s === t.t); assert.ok(m, 'text ' + t.t); near(m.y, t.y, 0.25, 'baseline ' + t.t); }
  const blue = P.ops.filter((o) => o.k === 'poly' && (o.a[1] || {}).c === '#0000ff').flatMap((o) => o.a[0]);
  const sb = sp.lines.filter((l) => l.stroke === '#0000ff'), sx = sb.flatMap((l) => [l.x1, l.x2]), sy = sb.flatMap((l) => [l.y1, l.y2]);
  near(Math.min(...blue.map((p) => p[0])), Math.min(...sx), 0.3, 'pressure curve left'); near(Math.max(...blue.map((p) => p[0])), Math.max(...sx), 0.4, 'pressure curve right (5 l)');
  near(Math.min(...blue.map((p) => p[1])), Math.min(...sy), 0.3, 'pressure curve top (3.3 bar)');
  const brown = P.ops.filter((o) => o.k === 'poly' && (o.a[1] || {}).c === '#804040').flatMap((o) => o.a[0]);
  const sr = sp.lines.filter((l) => l.stroke === '#804040'), rx = sr.flatMap((l) => [l.x1, l.x2]), ry = sr.flatMap((l) => [l.y1, l.y2]);
  assert.ok(brown.length > 40, 'penetrability curve drawn by default');
  near(Math.max(...brown.map((p) => p[0])), Math.max(...rx), 0.4, 'penetrability curve right'); near(Math.min(...brown.map((p) => p[1])), Math.min(...ry), 0.4, 'penetrability curve top');
  assert.ok(got.some((g) => g.s === 'Penetrability (l/min/bar)' && g.c === '#804040' && g.bold), 'brown axis title');
});

test('pressure/volume/flow report builds and carries the printout texts', () => {
  const doc = build({ pvf: true }), t = texts(doc.page(0)).map((x) => x.s);
  assert.equal(doc.count(), 1);
  for (const s of ['Average pressure', 'Cumulated volume', 'Average flow', 'Pressure/Volume/Flow', 'Borehole 18-2', ' Cumulated volume (Gr.)', '(*) : measured values']) assert.ok(t.includes(s), 'text: ' + s);
  assert.ok(t.some((s) => /Number of grouted sleeve\(s\): 1/.test(s)));
});

test('many sleeves fill five columns per page, then a new page; 1 sleeve per page splits them', () => {
  const rec = loadSample(0), opt = options({ layout: 'classic' }); opt.o.dec = ',';
  const items = Array.from({ length: 7 }, (_, i) => itemOf(rec, { job: 'H' + i, sleeve: String(i + 1) }));
  let doc = recordDoc(); G.buildDocument(doc, items, opt, 'records'); assert.equal(doc.count(), 2);
  opt.o.sel.oneSleeve = true; doc = recordDoc(); G.buildDocument(doc, items, opt, 'records'); assert.equal(doc.count(), 7);
});

test('a record longer than a column continues in the next column', () => {
  const rec = loadSample(0), opt = options({ layout: 'classic' }); opt.o.tcm = 10; // 10 s per cm: far longer than the page
  const doc = recordDoc(); G.buildDocument(doc, [itemOf(rec)], opt, 'records');
  const heads = doc.pages.flatMap((p) => p.ops).filter((o) => o.k === 'text' && o.a[0] === '18-1').length;
  assert.ok(heads > 1, 'column header repeated for continuation (' + heads + ')');
});

test('automatic axes fit every curve inside its column and the record inside the strip', () => {
  const rec = loadSample(0), opt = options({ layout: 'classic' }); opt.o.dec = ','; opt.o.axes = 'auto'; opt.o.q.on = true; opt.o.d.on = true; opt.o.v.on = true;
  const doc = recordDoc(); G.buildDocument(doc, [itemOf(rec, { sleeve: '1' })], opt, 'records');
  assert.equal(doc.count(), 1, 'the whole record fits on one page without manual scaling');
  const P = doc.page(0), col = { x0: 5, x1: 5 + 286.97 / 5 };
  for (const o of P.ops.filter((q) => q.k === 'poly' && q.a[0].length > 20)) for (const [x, y] of o.a[0]) {
    assert.ok(x >= col.x0 - 0.01 && x <= col.x1 + 0.01, 'curve x ' + x.toFixed(2) + ' inside the column');
    assert.ok(y >= 45.7 && y <= 203, 'curve y ' + y.toFixed(2) + ' inside the strip');
  }
  const labels = P.ops.filter((q) => q.k === 'text' && /^\(.* (bar|l\/min|l|l\/min\/bar)\)$/.test(q.a[0])).map((q) => q.a[0]);
  assert.ok(labels.length >= 2 && !labels.includes('(50 bar)'), 'scales were chosen from the data: ' + labels.join(' '));
});

test('manual axes: an empty (0) scale is automatic for that curve only; entered values are used as given', () => {
  const rec = loadSample(1), build = (patch) => { const opt = options({ layout: 'classic' }); opt.o.dec = ','; patch(opt.o); const doc = recordDoc(); G.buildDocument(doc, [itemOf(rec)], opt, 'records'); return doc.page(0).ops.filter((q) => q.k === 'text').map((q) => q.a[0]); };
  assert.ok(build((o) => { o.p.scale = 20; o.tcm = 30; }).includes('(20 bar)'));
  assert.ok(build((o) => { o.p.scale = 20; o.tcm = 30; }).includes('1 cm = 30 s'));
  const auto = build((o) => { o.p.scale = 0; });
  assert.ok(!auto.includes('(50 bar)') && auto.some((s) => /^\(\d+(,\d+)? bar\)$/.test(s)), 'pressure scale automatic when empty');
  const pv = (patch) => { const opt = options({ layout: 'classic' }); opt.o.dec = ','; opt.o.reports = { time: false, pvg: true, pvf: false }; patch(opt.o); const doc = recordDoc(); G.buildDocument(doc, [itemOf(rec)], opt, 'records'); return doc.page(0).ops.filter((q) => q.k === 'text').map((q) => q.a[0]); };
  assert.ok(pv(() => {}).includes('100'), 'P/V plot keeps the original 0-100 l axis by default');
  const fitted = pv((o) => { o.axes = 'auto'; }); assert.ok(!fitted.includes('100') && fitted.includes('5'), 'P/V plot axes fitted to the data: ' + fitted.filter((s) => /^\d/.test(s)).join(' '));
});
