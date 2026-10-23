// The additional print modes and options taken from the original software's menus.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { G, root, recordDoc, loadSample, itemOf, options } from './harness.mjs';

vm.runInThisContext(fs.readFileSync(path.join(root, 'js/zip.js'), 'utf8'), { filename: 'zip.js' });

/* A synthetic water test: three pressure stages (2, 4, 6 bar) with a one-second ramp between them. */
function waterTest(withEvents) {
  const samples = [], events = [], stage = [[2, 6], [4, 14], [6, 24]];
  const push = (p, q, v) => { const i = samples.length; samples.push({ tt: i, tm: i, p: p * 1e5, q: q / 60000, v: v / 1000, pBar: p, qLmin: q, vL: v, extra: {} }); return i; };
  const ev = (name, idx) => ({ name, idx, data: '', date: '2026-01-01T10:00:00.000' });
  events.push(ev('RecordStart', 0)); push(0.1, 0, 0); events.push(ev('MeasureDStart', 0));
  let vol = 0;
  stage.forEach(([p, q], k) => {
    const first = samples.length; for (let s = 0; s < 61; s++) { vol += q / 60; push(p, q, vol); }
    if (withEvents) { events.push(ev('LugeonStart', first)); events.push(ev('LugeonStop', samples.length - 1)); }
    push((p + (stage[k + 1] ? stage[k + 1][0] : 0.1)) / 2, 0, vol); // ramp sample
  });
  events.push(ev('MeasureDStop', samples.length - 1)); events.push(ev('PumpStop', samples.length - 1, ''));
  return { meta: { fileName: 'wt.DFI', kind: 'dfi', source: 'binary', softVersion: 'DPV 8.10', jobSite: 'S', contract: '', jobName: 'WT-1', jobNumber: '', operator: '', groutName: '', params: {}, setConsRaw: '', ginRaw: '', trig: '', trigStep: 1, channels: [], units: [], infoProc: '', size: 1, company: '' }, samples, events, warnings: [], id: 'wt' };
}

test('water test: stages are found from pressure plateaus and from LugeonStart/Stop events, Lugeon matches the hand calculation', () => {
  for (const withEvents of [false, true]) {
    const rec = waterTest(withEvents), w = G.waterTest(rec, { top: '2', bottom: '7' }, {});
    assert.equal(w.stages.length, 3, 'three stages (events: ' + withEvents + ')');
    assert.equal(w.stages[0].src, withEvents ? 'events' : 'plateau');
    assert.equal(w.length, 5);
    [[2, 6, 6.0], [4, 14, 7.0], [6, 24, 8.0]].forEach(([p, q, L], i) => {
      const s = w.stages[i]; assert.ok(Math.abs(s.p - p) < 0.01 && Math.abs(s.q - q) < 0.01, 'stage ' + (i + 1) + ' averages');
      assert.ok(Math.abs(s.lugeon - L) < 0.01, 'Lugeon ' + s.lugeon + ' vs ' + L);   // (Q / L) x (10 / P)
      assert.ok(Math.abs(s.dur - 60) < 0.5, 'stage duration');
    });
    assert.ok(Math.abs(w.final - 8.0) < 0.05, 'apparent final Lugeon = last stage');
  }
  const wl = G.waterTest(waterTest(false), { top: '2', bottom: '7' }, { staticM: 10, lossBar: 0.5 });
  assert.ok(Math.abs(wl.stages[0].lugeon - (6 / 5) * (10 / (2 + 0.981 - 0.5))) < 0.01, 'static water level and head loss enter the effective pressure');
  assert.ok(Number.isNaN(G.waterTest(waterTest(false), {}, {}).stages[0].lugeon), 'no tested length: Lugeon is not invented');
});

test('water test and volume distribution reports build, show the stages and totals', () => {
  const opt = options({ layout: 'classic' }); opt.o.dec = '.'; opt.o.reports = { time: false, pvg: false, pvf: false, hist: true, lug: true };
  const doc = recordDoc(); G.buildDocument(doc, [itemOf(waterTest(false), { top: '2', bottom: '7' }), itemOf(loadSample(0)), itemOf(loadSample(1))], opt, 'records');
  const txt = (p) => p.ops.filter((o) => o.k === 'text').map((o) => o.a[0]).join('|');
  assert.ok(doc.count() >= 3);
  const lug = doc.pages.find((p) => txt(p).includes('Water test diagram (Lugeon)') && txt(p).includes('Stage N#'));
  assert.ok(lug, 'water test page'); assert.match(txt(lug), /Number of stages: 3/); assert.match(txt(lug), /Lugeon apparent final: 8\.0/);
  const hist = doc.pages.find((p) => txt(p).includes('Distribution of the grouted volumes') && txt(p).includes('Number of injections'));
  assert.ok(hist, 'histogram page'); assert.match(txt(hist), /Injections: 3/);
  const none = recordDoc(); G.buildDocument(none, [itemOf(loadSample(1))], opt, 'records');
  assert.ok(none.pages.some((p) => /No stage found|Number of stages: \d/.test(txt(p))), 'a grouting file yields a plateau analysis or the "no stage" message, never an error');
});

test('multicriteria selection: ranges, stop type, dates, sorting, daily and grand totals', () => {
  const a = itemOf(loadSample(0), { pump: 'P1' }), b = itemOf(loadSample(1), { pump: 'P2' }), all = [b, a];
  assert.deepEqual(G.selectItems(all, {}).map((i) => i.hdr.job), ['18-1', '18-2'], 'sorted by start date ascending');
  assert.deepEqual(G.selectItems(all, { asc: false }).map((i) => i.hdr.job), ['18-2', '18-1']);
  assert.deepEqual(G.selectItems(all, { sort: 'vol' }).map((i) => i.hdr.job), ['18-2', '18-1'], 'by volume: 5 l then 18 l');
  assert.deepEqual(G.selectItems(all, { pMin: 2.1 }).map((i) => i.hdr.job), ['18-2'], 'average pressure 2.13 passes, 2.05 does not');
  assert.deepEqual(G.selectItems(all, { pMode: 'final', pMax: 1.6 }).map((i) => i.hdr.job), ['18-2'], 'final pressure 1.5 vs 1.8');
  assert.deepEqual(G.selectItems(all, { qMin: 1 }).map((i) => i.hdr.job), ['18-1'], 'average flow 2.39 vs 0.85');
  assert.deepEqual(G.selectItems(all, { pump: 'p2' }).map((i) => i.hdr.job), ['18-2']);
  assert.deepEqual(G.selectItems(all, { stop: 'operator' }).length, 2); assert.equal(G.selectItems(all, { stop: 'nothing' }).length, 0);
  assert.deepEqual(G.selectItems(all, { hMin: 12 }).map((i) => i.hdr.job), ['18-2'], 'started at 12:15 vs 11:52');
  assert.equal(G.selectItems(all, { dateFrom: '2026-09-29' }).length, 0); assert.equal(G.selectItems(all, { dateFrom: '2026-09-28', dateTo: '2026-09-28' }).length, 2);
  const rows = G.summaryRows(G.selectItems(all, {}), ['job', 'vol'], { daily: true });
  assert.equal(rows.length, 3); assert.match(rows[2].span, /2026-09-28 .*Daily injected volume : 23 l.*Daily number of injections : 2/);
  assert.equal(G.summaryRows(G.selectItems(all, {}), ['job'], { daily: false }).length, 2);
  const opt = options({ layout: 'classic' }); opt.mc = Object.assign(opt.mc, { pMin: 2.1 });
  const doc = recordDoc(); G.buildDocument(doc, all, opt, 'summary');
  const t = doc.pages.flatMap((p) => p.ops).filter((o) => o.k === 'text').map((o) => o.a[0]).join('|');
  assert.match(t, /Total injected volume: 5 l/); assert.doesNotMatch(t, /18-1/);
  opt.mc.pMin = 99; const empty = recordDoc(); G.buildDocument(empty, all, opt, 'summary'); assert.match(empty.pages.flatMap((p) => p.ops).map((o) => o.a[0]).join('|'), /No data found with these criteria/);
});

test('pressure in kg/cm2 converts values and labels; accuracy sets the printed decimals', () => {
  const build = (patch, reports) => { const opt = options({ layout: 'classic' }); opt.o.dec = ','; Object.assign(opt.o.reports, { time: false }, reports); patch(opt.o); const doc = recordDoc(); G.buildDocument(doc, [itemOf(loadSample(1), { sleeve: '1', top: '1', bottom: '1' })], opt, 'records'); return doc.page(0).ops; };
  const texts = (ops) => ops.filter((o) => o.k === 'text').map((o) => o.a[0]);
  assert.ok(texts(build((o) => { o.pUnit = 'kgcm2'; o.p.scale = 50; }, { time: true })).includes('(50 kg/cm²)'));
  assert.ok(texts(build((o) => { o.pUnit = 'kgcm2'; }, { pvg: true })).includes('Pressure (kg/cm²)'));
  const bar = build(() => {}, { time: true }).filter((o) => o.k === 'poly' && (o.a[1] || {}).c === '#0000ff').flatMap((o) => o.a[0]), kg = build((o) => { o.pUnit = 'kgcm2'; }, { time: true }).filter((o) => o.k === 'poly' && (o.a[1] || {}).c === '#0000ff').flatMap((o) => o.a[0]);
  const w = (pts) => Math.max(...pts.map((p) => p[0])) - 5; assert.ok(Math.abs(w(kg) / w(bar) - 1.0197) < 0.01, 'curve is 1.0197 times wider in kg/cm2');
  assert.ok(texts(build((o) => { o.decimals = 2; }, { time: true })).includes('5,78 l') === false && texts(build((o) => { o.decimals = 2; }, { time: true })).some((s) => /^6,00 l$/.test(s)), 'two decimals');
  assert.ok(texts(build((o) => { o.decimals = 0; }, { time: true })).includes('6 l'), 'zero decimals');
});

test('page selection syntax', () => {
  const r = G.parseRange;
  assert.equal(r('', 5), null); assert.equal(r('all', 5), null); assert.deepEqual(r('2-4', 9), [1, 2, 3]); assert.deepEqual(r('1, 3;5-6', 9), [0, 2, 4, 5]);
  assert.deepEqual(r('4-2', 9), [1, 2, 3], 'reversed range'); assert.deepEqual(r('2-99', 4), [1, 2, 3], 'clipped to the page count');
  assert.equal(r('abc', 5), 'bad'); assert.equal(r('7-9', 3), 'bad', 'nothing left after clipping'); assert.equal(r('0', 3), 'bad');
});
