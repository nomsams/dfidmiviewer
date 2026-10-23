import test from 'node:test';
import assert from 'node:assert/strict';
import { G, recordDoc, loadSample, itemOf, options } from './harness.mjs';

const buf = (i) => G.b64ToBuffer(globalThis.GV_SAMPLES[i].b64);
const code = (fn) => { try { fn(); } catch (e) { return e.code || 'JS:' + e.message; } return null; };

/* ---------- tar writer for synthetic archives ---------- */
function tar(files) {
  const blocks = [];
  for (const [name, data] of Object.entries(files)) {
    const body = typeof data === 'string' ? new TextEncoder().encode(data) : data, h = new Uint8Array(512);
    const put = (s, o) => { for (let i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i); };
    put(name, 0); put('0000644\0', 100); put('0000000\0', 108); put('0000000\0', 116); put(body.length.toString(8).padStart(11, '0') + '\0', 124); put('00000000000\0', 136);
    put('        ', 148); h[156] = 48; put('ustar\0', 257); put('00', 263);
    let sum = 0; for (const b of h) sum += b; put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of blocks) { out.set(b, o); o += b.length; }
  return out.buffer;
}

/* ---------- synthetic recordings ---------- */
function fakeRec(n, o) {
  o = o || {}; const samples = [];
  for (let i = 0; i < n; i++) {
    const p = o.p != null ? o.p : 1e5 + 2e5 * Math.abs(Math.sin(i / 7)), q = i % 11 ? 1e-4 : 0, v = i * 1e-5;
    samples.push({ tt: i, tm: i, p, q, v, pBar: p / 1e5, qLmin: q * 60000, vL: v * 1000, extra: {} });
  }
  const ev = (name, idx, data, date) => ({ name, idx, data: data || '', date: date || '2026-01-01T10:00:' + String(Math.min(59, idx % 60)).padStart(2, '0') + '.000' });
  const events = o.noEvents ? [] : [ev('RecordStart', 0), ev('SetCons', 0, '00400000;0;03.000;00800000;0;000'), ev('PumpStart', Math.min(1, n - 1)), ev('MeasureDStart', Math.min(1, n - 1)),
    ev('MeasureDStop', n - 1), ev('SetStop', n - 1, 'Manu_StopOperator'), ev('PumpStop', n - 1, '00150000;00.0000000;00.005'), ev('RecordStop', n - 1)];
  return { meta: { fileName: 'x.DFI', kind: 'dfi', source: 'binary', softVersion: 'DPV 8.10', jobSite: 'S', contract: '', jobName: 'H', jobNumber: '', operator: '', groutName: '', params: {}, setConsRaw: '00400000;0;03.000;00800000;0;000', ginRaw: '', trig: '', trigStep: 1, channels: [], units: [], infoProc: '', size: 1, company: '' },
    samples, events, warnings: [], id: 'f' + n };
}

test('both real files parse with the expected sample counts and identity', () => {
  const a = loadSample(0), b = loadSample(1);
  assert.equal(a.samples.length, 483); assert.equal(b.samples.length, 363);
  assert.equal(a.meta.jobName, '18-1'); assert.equal(b.meta.jobName, '18-2'); assert.equal(b.meta.jobSite, 'HABY'); assert.equal(b.meta.softVersion, 'DPV 8.10');
  assert.equal(G.windows(a).length, 5); assert.equal(G.windows(b).length, 1);
});

test('statistics reproduce the original software where it is known', () => {
  const a = G.stats(loadSample(0)), b = G.stats(loadSample(1));
  assert.equal(G.fmtHMS(a.durMeas), '00:07:32'); assert.equal(G.fmtHMS(a.durTotal), '00:22:57'); assert.equal(a.vol, 18); assert.equal(a.endP.toFixed(1), '1.8'); assert.equal(a.avgQ.toFixed(2), '2.39');
  assert.equal(a.avgP.toFixed(2), '2.05'); assert.equal(a.p30.toFixed(2), '2.02'); assert.equal(a.q30, 0); assert.equal(a.reprises, 4);
  assert.equal(G.fmtHMS(b.durMeas), '00:05:52'); assert.equal(G.fmtHMS(b.durTotal), '00:10:11'); assert.equal(b.vol, 5); assert.equal(b.endP.toFixed(1), '1.5'); assert.equal(b.avgQ.toFixed(2), '0.85');
  assert.equal(b.stopType, 'Manu_StopOperator');
});

test('bilan export uses the original format (decimal comma, trimmed zeros)', () => {
  const rec = loadSample(0), csv = G.bilanCsv([itemOf(rec, { pump: 'P1' })]).replace('﻿', '').split('\r\n');
  assert.ok(csv[0].startsWith('Start_date;Borehole;Fan;Sleeve'));
  assert.match(csv[1], /^2026-09-28;18-1;;;;;;;;P1;11:52:24;12:15:21;00:22:57;00:07:32;;;18;2,05;2,02;1,8;2,39;0;0;Manu_StopOperator/);
});

test('damaged and foreign files are rejected with a clear code, never parsed into wrong numbers', () => {
  const good = buf(1), u8 = () => new Uint8Array(good.slice(0));
  assert.equal(code(() => G.parseBuffer('t', good.slice(0, good.byteLength - 1500))), 'invalidArchive');
  assert.equal(code(() => G.parseBuffer('t', good.slice(0, 700))), 'invalidArchive');
  assert.equal(code(() => G.parseBuffer('t', new ArrayBuffer(0))), 'unrecognizedFile');
  assert.equal(code(() => G.parseBuffer('t', new ArrayBuffer(4096))), 'unrecognizedFile');
  assert.equal(code(() => G.parseBuffer('t', new TextEncoder().encode('hello').buffer)), 'unrecognizedFile');
  const flip = (off, mask) => { const u = u8(); u[1024 + off] ^= mask; return u.buffer; }; // REC.BN1 starts at byte 1024 in this archive
  assert.equal(code(() => G.parseBuffer('t', flip(60, 0x40))), 'invalidBinary');
  assert.equal(code(() => G.parseBuffer('t', flip(25, 0x01))), 'invalidBinary');
  const hdr = u8(); hdr[148] ^= 1; assert.equal(code(() => G.parseBuffer('t', hdr.buffer)), 'invalidArchive'); // header checksum
  /* a changed value in the text record must disagree with the binary one */
  const u = u8(), txtAt = 27136, txt = new TextDecoder().decode(u.subarray(txtAt, txtAt + 22187)), m = /\n\t+\d+\.\d+\t\d+\.\d+\t(\d+\.?\d*)/.exec(txt.slice(2000));
  const pos = txtAt + 2000 + m.index + m[0].lastIndexOf(m[1]); u[pos] = u[pos] === 0x39 ? 0x31 : u[pos] + 1;
  assert.equal(code(() => G.parseBuffer('t', u.buffer)), 'sourceMismatch');
});

test('a device update package is recognised and carries no measurements', () => {
  const rec = G.parseBuffer('u.DMJ', tar({ 'pack/UPDATE.XML': '<Xml><Update v="1"/></Xml>', 'pack/UPDATE.BIN': new Uint8Array(40), 'pack/PROC/PARAM.XML': '<Xml><ParamS N_I="x"/></Xml>' }));
  assert.equal(rec.meta.kind, 'update'); assert.equal(rec.samples.length, 0); assert.ok(rec.warnings.includes('updatePack'));
});

test('a text-only archive and a bare REC.TXT are read (lower precision, flagged)', () => {
  const head = '\t\t000D0080\t000F0080\t93000780\t93000540\t93000500\n\t\ts\ts\tPa\tm3/s\tm3\n';
  const rows = [0, 1, 2, 3].map((i) => `\t\t${i}\t${i}\t${100000 + i * 1000}\t0.0001\t${i * 0.00001}`).join('\n');
  const txt = 'RecordStart\t\t2026-01-01T10:00:00.000\t0\t0\t100000\t0\t0\n' + head + rows + '\nPumpStop\t00100000;00.0000000;00.000\t2026-01-01T10:00:03.000\n';
  const bare = G.parseBuffer('REC.TXT', new TextEncoder().encode(txt).buffer);
  assert.equal(bare.samples.length, 4); assert.equal(bare.meta.source, 'text');
  const inTar = G.parseBuffer('a.DFI', tar({ 'a/REC.TXT': txt }));
  assert.equal(inTar.samples.length, 4);
  assert.equal(code(() => G.parseBuffer('REC.TXT', new TextEncoder().encode(txt.replace('93000780', '93000999')).buffer)), 'unsupportedChannels');
  assert.equal(code(() => G.parseBuffer('REC.TXT', new TextEncoder().encode(txt.replace('\ts\ts\tPa', '\ts\ts\tfurlongs')).buffer)), 'unsupportedUnits');
  const dec = G.parseBuffer('REC.TXT', new TextEncoder().encode(txt.replace(/0\.0001/g, '0,0001')).buffer); assert.equal(dec.samples.length, 4); // decimal commas
  assert.equal(code(() => G.parseBuffer('REC.TXT', new TextEncoder().encode(txt.replace('\t\t2\t2\t', '\t\t0\t0\t')).buffer)), 'resetCounters');
});

test('malformed XML and oversize files are refused', () => {
  const okTxt = 'RecordStart\t\t2026-01-01T10:00:00.000\n\t\t000D0080\t000F0080\t93000780\t93000540\t93000500\n\t\ts\ts\tPa\tm3/s\tm3\n\t\t0\t0\t100000\t0\t0\n';
  const bad = (xml) => code(() => G.parseBuffer('a.DFI', tar({ 'a/REC.TXT': okTxt, 'a/REC.XML': xml })));
  for (const x of ['<Xml><Event></Xml>', '<Xml/><Xml/>', '<!DOCTYPE a><Xml/>', '<Xml a=1/>']) assert.equal(bad(x), 'invalidXml', x);
  assert.equal(code(() => G.parseBuffer('big', { byteLength: 300 * 1024 * 1024 })), 'fileTooLarge');
});

test('degenerate recordings never throw: empty, one sample, no events, huge', () => {
  const cases = { empty: fakeRec(0), one: fakeRec(1), two: fakeRec(2), noEvents: fakeRec(50, { noEvents: true }), flat: fakeRec(40, { p: 0 }), big: fakeRec(150000) };
  for (const [name, rec] of Object.entries(cases)) {
    for (const method of ['original', 'weighted']) {
      assert.doesNotThrow(() => G.stats(rec, method), name + ' stats ' + method);
    }
  }
  assert.equal(G.stats(cases.empty).ok, false);
  assert.ok(Number.isFinite(G.stats(cases.big).maxP), 'very large recording (no stack overflow)');
  assert.doesNotThrow(() => G.samplesCsv(cases.big));
});

test('every layout x language x document type builds for normal and degenerate records', () => {
  const recs = [loadSample(0), loadSample(1), fakeRec(0), fakeRec(1), fakeRec(2), fakeRec(50, { noEvents: true })];
  const upd = { ...fakeRec(0), meta: { ...fakeRec(0).meta, kind: 'update' } };
  const failures = [];
  for (const lang of ['en', 'sv', 'fr', 'no']) for (const layout of ['classic', 'modern', 'cards']) for (const kind of ['records', 'summary', 'both']) {
    const opt = options({ layout }); opt.lang = lang; opt.show.events = opt.show.params = opt.show.table = opt.show.ginPage = opt.show.d = opt.show.gin = true;
    Object.assign(opt.o.reports, { time: true, pvg: true, pvf: true }); Object.assign(opt.o, { }); opt.o.q.on = opt.o.v.on = opt.o.d.on = opt.o.g.on = true; opt.o.smoothP.on = opt.o.smoothQ.on = true; opt.o.sel.eff = true;
    try {
      const doc = recordDoc(); G.buildDocument(doc, [...recs, upd].map((r) => itemOf(r, { top: '1', bottom: '2' })), opt, kind);
      for (const p of doc.pages) for (const o of p.ops) for (const v of o.a.flat(3)) if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number in ' + o.k);
    } catch (e) { failures.push(`${lang}/${layout}/${kind}: ${e.message}`); }
  }
  assert.deepEqual(failures, []);
});

test('the real PDF backend produces valid documents for every layout', () => {
  for (const layout of ['classic', 'modern', 'cards']) {
    const doc = G.pdfDoc(), opt = options({ layout }); opt.o.reports.pvg = opt.o.reports.pvf = true;
    G.buildDocument(doc, [itemOf(loadSample(0)), itemOf(loadSample(1))], opt, 'both');
    const bytes = doc.raw().output('arraybuffer');
    assert.equal(new TextDecoder().decode(new Uint8Array(bytes).subarray(0, 5)), '%PDF-', layout);
    assert.ok(doc.count() >= 3, layout + ' pages ' + doc.count());
  }
});

test('translations: every language defines every English key', () => {
  const en = Object.keys(G.DICT.en);
  for (const l of ['sv', 'fr', 'no']) assert.deepEqual(en.filter((k) => !(k in G.DICT[l])), [], l);
});

test('SVG back-end keeps repeated spaces (the original prints "DLGPVD  6.61" and "28-09-26  12:15:30")', () => {
  const doc = G.svgDoc(), p = doc.addPage(100, 50); p.text('a  b', 10, 10, { size: 8 });
  const svg = p.svg(); assert.match(svg, /xml:space="preserve"/); assert.match(svg, />a {2}b</);
});
