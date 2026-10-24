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
  const wp = G.waterTest(waterTest(false), { top: '2', bottom: '7' }, { lossBar: 0.1, lossLin: 0.01, lossQuad: 0.001 }), q0 = wp.stages[0].q;
  assert.ok(Math.abs(wp.stages[0].lugeon - (q0 / 5) * (10 / (wp.stages[0].p - (0.1 + 0.01 * q0 + 0.001 * q0 * q0)))) < 0.01, 'head loss is c0 + c1*Q + c2*Q^2 of the stage flow, as in the original');
  assert.ok(Number.isNaN(G.waterTest(waterTest(false), {}, {}).stages[0].lugeon), 'no tested length: Lugeon is not invented');
});

test('water test and volume distribution reports build, show the stages and totals', () => {
  const opt = options({ layout: 'classic' }); opt.o.dec = '.'; opt.o.reports = { time: false, pvg: false, pvf: false, hist: true, lug: true };
  const doc = recordDoc(); G.buildDocument(doc, [itemOf(waterTest(false), { top: '2', bottom: '7' }), itemOf(loadSample(0)), itemOf(loadSample(1))], opt, 'records');
  const txt = (p) => p.ops.filter((o) => o.k === 'text').map((o) => o.a[0]).join('|');
  assert.ok(doc.count() >= 3);
  const lug = doc.pages.find((p) => txt(p).includes('Water test diagram') && txt(p).includes('Stage N#'));
  assert.ok(lug, 'water test page'); assert.match(txt(lug), /Number of stages: 3/); assert.match(txt(lug), /Lugeon apparent final: 8\.0/);
  assert.ok(!/Hydrostatic pressure/.test(txt(lug)), 'no hydrostatic column without a static water level');
  const opt2 = options({ layout: 'classic' }); opt2.o.dec = '.'; opt2.o.reports = { time: false, pvg: false, pvf: false, hist: false, lug: true }; opt2.o.lug.staticM = 10;
  const doc2 = recordDoc(); G.buildDocument(doc2, [itemOf(waterTest(false), { top: '2', bottom: '7' })], opt2, 'records');
  assert.ok(doc2.pages.some((p) => txt(p).includes('Hydrostatic pressure|') && txt(p).includes('0.98')), 'hydrostatic column (10 m of water = 0.98 bar)');
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

/* ---- facts decoded from the original's managed code (Jlsa.Foundation.LugeonStage, DXdataPVD) ---- */
test('water test uses the stage figures the device writes in LugeonStart/LugeonStop (SI units), and ignores implausible ones', () => {
  const build = (startData, stopData) => {
    const rec = waterTest(true);
    rec.events.forEach((e) => { if (e.name === 'LugeonStart') e.data = startData(e); if (e.name === 'LugeonStop') e.data = stopData(e); });
    return rec;
  };
  let n = 0, m = 0; const sp = [2e5, 4e5, 6e5], vols = [0.006, 0.014, 0.024];
  const rec = build((e) => (n++, `${n};${sp[n - 1]};60`), (e) => (m++, `${m};${sp[m - 1] * 1.0};60;${vols[m - 1]}`));
  const w = G.waterTest(rec, { top: '2', bottom: '7' }, {});
  assert.deepEqual(w.stages.map((s) => s.n), [1, 2, 3]);
  assert.deepEqual(w.stages.map((s) => +s.setP.toFixed(2)), [2, 4, 6], 'set pressure from LugeonStart');
  assert.ok(w.stages.every((s) => s.device), 'the device figures agree with the samples and are used');
  assert.ok(Math.abs(w.stages[1].vol - 14) < 0.01 && Math.abs(w.stages[1].p - 4) < 0.01 && Math.abs(w.stages[1].dur - 60) < 0.01);
  /* units other than SI are recognised when they agree with the samples (bar, litres) ... */
  let a = 0, b = 0; const alt = build(() => (a++, `${a};${[2, 4, 6][a - 1]};60`), () => (b++, `${b};${[2, 4, 6][b - 1]};60;${[6, 14, 24][b - 1]}`));
  assert.ok(G.waterTest(alt, { top: '2', bottom: '7' }, {}).stages.every((s) => s.device && Math.abs(s.lugeon - [6, 7, 8][s.n - 1]) < 0.02));
  /* ... and nonsense falls back to the samples instead of being printed */
  const bad = G.waterTest(build(() => '1;abc;x', () => '1;9999999;7;123'), { top: '2', bottom: '7' }, {});
  assert.ok(bad.stages.every((s) => !s.device) && Math.abs(bad.stages[0].p - 2) < 0.01, 'sample values used');
});

test('header keys of the original import (top depth, bottom depth, stagenumber, headloss, fan, method) fill the report header', () => {
  const txt = 'RecordStart\t\t2026-01-01T10:00:00.000\n\t\t000D0080\t000F0080\t93000780\t93000540\t93000500\n\t\ts\ts\tPa\tm3/s\tm3\n\t\t0\t0\t100000\t0\t0\n';
  const xml = '<Xml><Config name="Top Depth" data="2.50"/><Config name="bottom depth" data="3.000"/><Config name="StageNumber" data="7"/><Config name="Fan" data="F2"/><Config name="headloss" data="0.2"/><Config name="Grout Name" data="CEM-A"/></Xml>';
  const files = { 'a/REC.TXT': txt, 'a/REC.XML': xml };
  const enc = new TextEncoder(); const blocks = [];
  for (const [name, data] of Object.entries(files)) {
    const body = enc.encode(data), h = new Uint8Array(512), put = (s, o) => { for (let i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i); };
    put(name, 0); put('0000644\0', 100); put('0000000\0', 108); put('0000000\0', 116); put(body.length.toString(8).padStart(11, '0') + '\0', 124); put('00000000000\0', 136); put('        ', 148); h[156] = 48; put('ustar\0', 257); put('00', 263);
    let sum = 0; for (const x of h) sum += x; put(sum.toString(8).padStart(6, '0') + '\0 ', 148); blocks.push(h, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024)); const out = new Uint8Array(blocks.reduce((k, x) => k + x.length, 0)); let o = 0; blocks.forEach((x) => { out.set(x, o); o += x.length; });
  const rec = G.parseBuffer('a.DFI', out.buffer), hdr = G.header(rec, {});
  assert.equal(hdr.top, '2.50'); assert.equal(hdr.bottom, '3.000'); assert.equal(hdr.sleeve, '7'); assert.equal(hdr.fan, 'F2'); assert.equal(rec.meta.headLoss, '0.2'); assert.equal(hdr.grout, 'CEM-A');
  assert.equal(G.header(rec, { top: '9' }).top, '9', 'the user can still override');
  const opt = options({ layout: 'classic' }); opt.o.dec = ','; const doc = recordDoc(); G.buildDocument(doc, [itemOf(rec)], opt, 'records');
  assert.ok(doc.page(0).ops.some((q) => q.k === 'text' && q.a[0] === ' 7 (2,5-3 m)'), 'sleeve and levels shown like the original ("1 (1-1 m)"), zeros trimmed');
});

test('effective pressure follows the original (CalcPNormal inverted): grout column over the sleeve middle, angle and ground water', () => {
  const O = G._o, o = { density: 1000, angle: 0, waterDepth: 0 };
  assert.ok(Math.abs(O.effOffset({ top: '1', bottom: '1' }, o) - 0.1) < 1e-9, '1 m of 1000 kg/m3 = 0.1 bar (the offset seen in the original exports)');
  assert.ok(Math.abs(O.effOffset({ top: '2', bottom: '4' }, o) - 0.3) < 1e-9, 'middle of the sleeve: (2+4)/2 = 3 m');
  assert.ok(Math.abs(O.effOffset({ top: '2', bottom: '4' }, { density: 1500, angle: 0, waterDepth: 0 }) - 0.45) < 1e-9, 'density scales the column');
  assert.ok(Math.abs(O.effOffset({ top: '2', bottom: '4' }, { density: 1000, angle: 60, waterDepth: 0 }) - 0.15) < 1e-9, 'inclined hole: cos(angle)');
  assert.ok(Math.abs(O.effOffset({ top: '2', bottom: '4' }, { density: 1000, angle: 0, waterDepth: 1 }) - 0.1) < 1e-9, 'ground water above the middle subtracts (3-1)/10');
  assert.equal(O.effOffset({}, o), 0, 'no levels: no correction');
  const opt = options({ layout: 'classic' }); opt.o.dec = '.'; opt.o.reports = { time: false, pvg: false, pvf: true }; opt.o.sel.eff = true;
  const doc = recordDoc(); G.buildDocument(doc, [itemOf(loadSample(1), { sleeve: '1', top: '1', bottom: '1' })], opt, 'records');
  const raw = G.stats(loadSample(1), 'original').avgP;
  assert.ok(doc.page(0).ops.some((x) => x.k === 'text' && x.a[0] === (raw + 0.1).toFixed(2).replace(/0$/, '').replace(/\.$/, '') || x.a[0] === (raw + 0.1).toFixed(1)), 'the depth diagram shows the effective average pressure');
});

test('bilan export: levels are filled and the effective pressure shifts the two mean pressures only (end pressure stays raw, as in the original export)', () => {
  const rec = loadSample(1), a = itemOf(rec, { job: 'H1', sleeve: '1', top: '1', bottom: '1' }), b = Object.assign({}, a, { eff: { off: 0.1 } });
  const col = (it, name) => { const lines = G.bilanCsv([it]).split('\n'), head = lines[0].split(';'); return lines[1].split(';')[head.indexOf(name)]; };
  const num = (s) => parseFloat(String(s).replace(',', '.'));
  assert.ok(Math.abs(num(col(b, 'Average_pressure')) - num(col(a, 'Average_pressure')) - 0.1) < 0.011, 'average pressure +0.1');
  assert.ok(Math.abs(num(col(b, '30s_pressure')) - num(col(a, '30s_pressure')) - 0.1) < 0.011, '30 s pressure +0.1');
  assert.equal(col(b, 'End_pressure'), col(a, 'End_pressure'));
  assert.equal(col(a, 'Top_level'), '1'); assert.equal(col(a, 'Bottom_level'), '1');
});
