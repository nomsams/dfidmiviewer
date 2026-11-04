import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { G, loadSample, itemOf } from './harness.mjs';

/* the rows the original program's Site > Export (field separator ";") produced for the two example files */
const HEADER = 'Start_date;Borehole;Fan;Sleeve;Regrout;Grout;Zone;X_coord;Y_coord;Pump;Start_time;End_time;Total_duration;Grouting_duration;Top_level;Bottom_level;Injected_volume;Average_pressure;30s_pressure;End_pressure;Average_flowrate;30s_flowrate;End_flowrate;Stop_type;Dry_weights;Coeff_Headloss;Head_loss;Water_depth;Inclination';
const ORIGINAL = [
  '2026-09-28;18-1;;1;1;1;;0;0;P1;11:52:24;12:15:21;00:22:57;00:07:32;1;1;18;2,15;2,13;1,8;2,39;0;0;Manu_StopOperator;18;0;0;0',
  '2026-09-28;18-2;;1;1;1;;0;0;P1;12:15:30;12:25:41;00:10:11;00:05:52;1;1;5;2,24;1,78;1,5;0,85;0;0;Manu_StopOperator;5;0;0;0',
];
const EFF = { density: 1000, angle: 0, waterDepth: 0 };
const items = () => [0, 1].map((i) => itemOf(loadSample(i), {}));
const num = (s) => parseFloat(String(s).replace(',', '.'));
const lang = (l) => { const old = G.lang; G.setLang(l); return () => G.setLang(old); };

test('the export columns are exactly those of the original export, in the same order', () => {
  assert.equal(G.exportKeys.join(';'), HEADER);
  assert.deepEqual(G.exportKeys, G.BILAN_COLUMNS);
});

test('CSV reproduces the original export: header, separators, decimal comma, one row per file, no trailing separator', () => {
  const m = G.exportModel(items(), { eff: null, sort: 'date' }), lines = G.exportCsv(m).split('\r\n');
  assert.equal(lines[0], HEADER);
  assert.equal(lines.length, 4, 'header, two rows and the final line break');
  lines.slice(1, 3).forEach((line, i) => {
    const got = line.split(';'), want = ORIGINAL[i].split(';');
    assert.equal(got.length, 28, 'the empty last column (Inclination) is not written, exactly like the original');
    got.forEach((v, k) => {
      const key = G.exportKeys[k];
      if (key === 'Average_pressure' || key === '30s_pressure') return; // compared below
      assert.equal(v, want[k], i + ' ' + key);
    });
  });
});

test('mean pressures: raw values equal the original database table, the effective option adds the grout column (+0.1 bar for 1 m)', () => {
  const raw = G.exportModel(items(), { eff: null, sort: 'date' }).objs, eff = G.exportModel(items(), { eff: EFF, sort: 'date' }).objs;
  assert.deepEqual(raw.map((r) => [r.Average_pressure, r['30s_pressure']]), [[2.05, 2.02], [2.13, 1.67]], 'raw, as in the original Injections_US table');
  ORIGINAL.forEach((row, i) => {
    const f = row.split(';'), a = num(f[17]), p = num(f[18]);
    assert.ok(Math.abs(eff[i].Average_pressure - a) <= 0.011, 'average pressure within the rounding of the original: ' + eff[i].Average_pressure + ' vs ' + a);
    assert.ok(Math.abs(eff[i]['30s_pressure'] - p) <= 0.011, '30 s pressure within the rounding of the original: ' + eff[i]['30s_pressure'] + ' vs ' + p);
    assert.equal(eff[i].End_pressure, raw[i].End_pressure, 'the end pressure is never corrected');
  });
  assert.equal(eff[0].Average_pressure, 2.15, 'exact for the first file');
});

test('columns with data are detected, empty ones are not', () => {
  const m = G.exportModel(items(), { eff: EFF });
  ['Fan', 'Zone', 'Inclination'].forEach((k) => assert.equal(m.hasData[k], false, k));
  ['Borehole', 'Injected_volume', 'Average_pressure', 'X_coord', 'Stop_type'].forEach((k) => assert.equal(m.hasData[k], true, k));
  const p = G.exportPick(m, G.exportKeys.filter((k) => m.hasData[k]));
  assert.equal(p.cols.length, 26); assert.equal(p.rows[0].length, 26); assert.ok(!G.exportCsv(p).split('\r\n')[0].includes('Fan'));
});

test('sorting, grout numbering and the totals row', () => {
  const a = itemOf(loadSample(0), { grout: 'Alpha' }), b = itemOf(loadSample(1), { grout: 'Beta' }), c = itemOf(loadSample(0), { job: '17-9', grout: 'alpha' });
  const m = G.exportModel([b, a, c], { sort: 'date', totals: true });
  assert.deepEqual(m.objs.map((r) => r.Borehole), ['17-9', '18-1', '18-2'], 'by date, equal times by name');
  const byName = G.exportModel([b, a, c], { sort: 'name' }).objs.map((r) => r.Borehole);
  assert.deepEqual(byName, ['17-9', '18-1', '18-2'], 'by borehole name');
  const none = G.exportModel([b, a, c], { sort: 'none' }).objs.map((r) => r.Borehole);
  assert.deepEqual(none, ['18-2', '18-1', '17-9'], 'as added');
  assert.deepEqual(m.objs.map((r) => r.Grout), [1, 1, 2], 'grouts are numbered in order of first appearance, ignoring case');
  assert.equal(m.total, m.rows.length - 1); assert.equal(m.rows.length, 4);
  const last = m.rows[m.total], at = (k) => last[G.exportKeys.indexOf(k)];
  assert.equal(at('Injected_volume'), 18 + 5 + 18, 'volumes are summed');
  assert.equal(at('Total_duration'), '00:56:05', '1377 + 611 + 1377 s'); assert.equal(at('Grouting_duration'), '00:20:56');
  assert.equal(at('Average_pressure'), '', 'pressures are not summed');
});

test('levels from the file and the optional head loss feed the row', () => {
  const rec = loadSample(0), it = itemOf(rec, { top: '2.5', bottom: '4' });
  const r = G.exportRow(it, { eff: EFF });
  assert.equal(r.Top_level, 2.5); assert.equal(r.Bottom_level, 4);
  assert.ok(Math.abs(r.Average_pressure - (G.stats(rec, 'original').avgP + 0.325)) < 0.011, 'mean level (2.5+4)/2 = 3.25 m of grout = 0.325 bar');
  rec.meta.headLoss = '20000';
  const h = G.exportRow(itemOf(rec, {}), { eff: null });
  assert.equal(h.Head_loss, 0.2); assert.ok(Math.abs(h.Average_pressure - (2.05 - 0.2)) < 0.011, 'head loss (Pa in the file) is subtracted from the mean pressures');
});

/* ---- Excel workbook ---- */
function wellFormed(xml) { // tags balance, attributes are quoted, no raw control characters
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml), 'no control characters');
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<\?[^>]*\?>|<!--[\s\S]*?-->/g)) {
    if (!m[2]) continue;
    if (m[4]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], 'closing tag ' + m[2]); else stack.push(m[2]);
  }
  assert.equal(stack.length, 0, 'unclosed tags: ' + stack.join(','));
  assert.ok(!/<[^>]*[^"\w/\s>=-][^>]*>[^<]*&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml), 'entities are escaped');
}
function readSheet(u8) {
  const parts = Object.fromEntries(G.unzip(u8).map((f) => [f.name, new TextDecoder().decode(f.data)]));
  const sheet = parts['xl/worksheets/sheet1.xml'], rows = [];
  for (const r of sheet.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const c of r[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const t = /t="inlineStr"/.test(c[2]) ? (/<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3]) || [])[1] : (c[3] ? Number((/<v>([^<]*)<\/v>/.exec(c[3]) || [])[1]) : undefined);
      cells[c[1]] = typeof t === 'string' ? t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : t;
    }
    rows.push(cells);
  }
  return { parts, rows, sheet };
}

test('the Excel file has every required part, well-formed XML and the right cells', () => {
  const restore = lang('en');
  const m = G.exportPick(G.exportModel(items(), { eff: EFF, sort: 'date', totals: true }), G.exportKeys.filter((k) => k !== 'Fan' && k !== 'Zone' && k !== 'Inclination'));
  const { parts, rows } = readSheet(G.exportXlsx(m, { sheet: 'Grout export', title: 't' }));
  ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'docProps/core.xml', 'docProps/app.xml'].forEach((n) => assert.ok(parts[n], 'part ' + n));
  Object.entries(parts).forEach(([n, x]) => { assert.ok(x.startsWith('<?xml'), n); wellFormed(x); });
  assert.match(parts['xl/workbook.xml'], /<sheet name="Grout export" sheetId="1" r:id="rId1"\/>/);
  assert.match(parts['xl/worksheets/sheet1.xml'], /<pane ySplit="1"[^>]*state="frozen"\/>/, 'header row frozen');
  assert.match(parts['xl/worksheets/sheet1.xml'], /<autoFilter ref="A1:Z3"\/>/, 'filter over the data rows, not the totals row');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].A, 'Start_date'); assert.equal(rows[0].B, 'Borehole');
  assert.equal(rows[1].B, '18-1'); assert.equal(rows[1].C, 1, 'whole numbers are numbers'); assert.equal(typeof rows[1].Q, 'number');
  assert.equal(rows[2].B, '18-2'); assert.equal(rows[3].B, 'Total'); assert.equal(rows[3].O, 23, 'volume total');
  assert.equal(rows[1].I, '11:52:24', 'times stay text');
  restore();
});

test('Excel: awkward text is escaped and never breaks the file; sheet names are made valid', () => {
  const it = itemOf(loadSample(0), { job: 'A&B <1> "x" \u0001 end ', grout: 'Mix\n2' });
  const m = G.exportModel([it], { eff: null });
  const { parts, rows } = readSheet(G.exportXlsx(m, { sheet: 'Bad:/?*[name]that is longer than thirty one chars' }));
  Object.values(parts).forEach(wellFormed);
  assert.equal(rows[1].B, 'A&B <1> "x"  end', 'text round-trips (control character dropped)');
  const name = /<sheet name="([^"]*)"/.exec(parts['xl/workbook.xml'])[1];
  assert.ok(name.length <= 31 && !/[\\/?*[\]:]/.test(name), name);
  assert.equal(G.xlsx.colName(0), 'A'); assert.equal(G.xlsx.colName(25), 'Z'); assert.equal(G.xlsx.colName(26), 'AA'); assert.equal(G.xlsx.colName(28), 'AC'); assert.equal(G.xlsx.colName(701), 'ZZ'); assert.equal(G.xlsx.colName(702), 'AAA');
});

test('CSV: quoting, decimal mark, BOM only when needed, tab separated text for the clipboard', () => {
  const it = itemOf(loadSample(0), { job: 'H;1 "q"' });
  const m = G.exportModel([it], { eff: null });
  const plain = G.exportCsv(m), dot = G.exportCsv(m, { dec: '.' });
  assert.ok(plain.includes('"H;1 ""q"""') && !plain.startsWith('﻿'));
  assert.ok(dot.split('\r\n')[1].includes(';2.05;') && plain.split('\r\n')[1].includes(';2,05;'));
  assert.ok(G.exportCsv(G.exportModel([itemOf(loadSample(0), { job: 'Åre' })], {})).startsWith('﻿'), 'BOM when the text has accents');
  const tsv = G.exportTsv(m, { dec: ',' }).split('\r\n');
  assert.equal(tsv[0].split('\t').length, 29); assert.ok(tsv[1].includes('\t2,05\t'));
});

test('a hundred and more files are handled quickly and keep their order', () => {
  const many = []; for (let i = 0; i < 250; i++) many.push(itemOf(loadSample(i % 2), { job: 'H' + String(i).padStart(3, '0') }));
  const t0 = Date.now(), m = G.exportModel(many, { eff: EFF, sort: 'name', totals: true });
  const csv = G.exportCsv(G.exportPick(m, G.exportKeys.filter((k) => m.hasData[k])), {}), x = G.exportXlsx(m, { sheet: 'x' });
  assert.ok(Date.now() - t0 < 4000, 'took ' + (Date.now() - t0) + ' ms');
  assert.equal(csv.split('\r\n').length, 250 + 1 + 1 + 1, 'header, 250 files, totals, final break');
  assert.equal(readSheet(x).rows.length, 252); assert.equal(m.objs[0].Borehole, 'H000'); assert.equal(m.objs[249].Borehole, 'H249');
});

/* ---- intake: folders and zip archives ---- */
function deflatedZip(files) { // a real compressed .zip (method 8), the kind Windows and macOS produce
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const nm = Buffer.from(f.name), raw = Buffer.from(f.data), cmp = zlib.deflateRawSync(raw), crc = G.crc32(new Uint8Array(raw));
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(cmp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, cmp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(cmp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nm); off += 30 + nm.length + cmp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

test('intake opens compressed and stored zip archives, skips folders and junk, and keeps only measurement files from bulk sources', async () => {
  const a = new Uint8Array(Buffer.from('first')), b = new Uint8Array(Buffer.from('second'));
  const z = deflatedZip([{ name: 'site/18-1.DFI', data: a }, { name: 'site/readme.pdf', data: b }, { name: '__MACOSX/site/._18-1.DFI', data: b }, { name: 'site/sub/18-2.dfi', data: b }]);
  const got = await G.intake.unzipAny(z);
  assert.deepEqual(got.map((x) => x.name).sort(), ['site/18-1.DFI', 'site/readme.pdf', 'site/sub/18-2.dfi'], 'macOS resource forks are ignored');
  assert.equal(new TextDecoder().decode(got.find((x) => x.name === 'site/18-1.DFI').data), 'first');
  const stored = await G.intake.unzipAny(G.zip([{ name: 'a.DFI', data: a }]));
  assert.equal(new TextDecoder().decode(stored[0].data), 'first');
  const ex = await G.intake.expand([{ name: 'all.zip', path: 'all.zip', size: z.length, read: async () => z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) },
    { name: 'photo.jpg', path: 'folder/photo.jpg', size: 1, bulk: true, read: async () => new ArrayBuffer(1) }, { name: 'x.DFI', path: 'folder/x.DFI', size: 1, bulk: true, read: async () => new ArrayBuffer(1) },
    { name: 'oddname', path: 'oddname', size: 1, bulk: false, read: async () => new ArrayBuffer(1) }, { name: 'bad.zip', path: 'bad.zip', size: 3, read: async () => new ArrayBuffer(3) }]);
  assert.deepEqual(ex.items.map((i) => i.name), ['18-1.DFI', '18-2.dfi', 'x.DFI', 'oddname'], 'measurement files from the zip and the folder, plus a file picked by hand whatever its name');
  assert.equal(ex.ignored, 2, 'readme.pdf and photo.jpg'); assert.deepEqual(ex.failed.map((f) => f.name), ['bad.zip']);
  assert.equal(new TextDecoder().decode(new Uint8Array(await ex.items[0].read())), 'first');
});

test('the text of the export view exists in every language', () => {
  const keys = Object.keys(G.DICT.en).filter((k) => /^(x\.|xc\.|mode\.export|err\.(duplicate|notZip|zipUnsupported))/.test(k));
  assert.ok(keys.length > 90);
  for (const l of ['sv', 'fr', 'no']) { const miss = keys.filter((k) => !(k in G.DICT[l])); assert.deepEqual(miss, [], l); }
  G.exportKeys.forEach((k) => assert.ok(G.DICT.en['xc.' + k], 'caption for ' + k));
});

test('grout names matching Object properties receive numeric grout IDs', () => {
  const m = G.exportModel(['constructor', '__proto__', 'normal', 'constructor'].map(grout => itemOf(loadSample(1), { grout })), {});
  assert.deepEqual(m.objs.map(r => r.Grout), [1, 2, 3, 1]);
});

test('ZIP intake rejects bad checksums, incomplete directories and unsupported entries without returning partial data', async () => {
  const make = () => G.zip([{ name: 'a.DFI', data: new TextEncoder().encode('first') }, { name: 'b.DFI', data: new TextEncoder().encode('second') }]);
  const corrupt = make(); corrupt[35] ^= 1;
  await assert.rejects(G.intake.unzipAny(corrupt));
  const broken = make(), end = broken.length - 22, dv = new DataView(broken.buffer), cd = dv.getUint32(end + 16, true);
  dv.setUint32(cd + 46 + 5, 0, true);
  await assert.rejects(G.intake.unzipAny(broken));
  const wrongSize = make(), sizeView = new DataView(wrongSize.buffer), directory = sizeView.getUint32(wrongSize.length - 22 + 16, true);
  sizeView.setUint32(directory + 24, 1000, true);
  await assert.rejects(G.intake.unzipAny(wrongSize), e => e.code === 'notZip');
  const truncated = make();
  await assert.rejects(G.intake.unzipAny(truncated.subarray(0, truncated.length - 5)), e => e.code === 'notZip');
  for (const flags of [false, true]) {
    const z = make(), view = new DataView(z.buffer), c = view.getUint32(z.length - 22 + 16, true);
    if (flags) { view.setUint16(6, 1, true); view.setUint16(c + 8, 1, true); }
    else { view.setUint16(8, 99, true); view.setUint16(c + 10, 99, true); }
    await assert.rejects(G.intake.unzipAny(z), e => e.code === 'zipUnsupported');
  }
});

test('decoded native pressures reproduce both example export rows exactly; defaults for records without injection', () => {
  const eff = { density: 1000, angle: 0, waterDepth: 0 };
  const plain = G.exportModel(items(), { eff, sort: 'date' }).objs, compat = G.exportModel(items(), { eff, compat: true, sort: 'date' }).objs;
  const want = [[2.15, 2.13], [2.24, 1.78]], miss = (rows) => rows.reduce((n, r, i) => n + (r.Average_pressure !== want[i][0]) + (r['30s_pressure'] !== want[i][1]), 0);
  assert.ok(miss(compat) < miss(plain), 'fewer of the four mean pressures differ from the original (' + miss(compat) + ' against ' + miss(plain) + ')');
  assert.equal(compat[0].Average_pressure, 2.15); assert.equal(compat[1].Average_pressure, 2.24); assert.equal(compat[1]['30s_pressure'], 1.78);
  assert.deepEqual(compat.map(r => [r.Average_pressure, r['30s_pressure']]), want);
  assert.deepEqual(compat.map((r) => r.End_pressure), plain.map((r) => r.End_pressure), 'end pressure is never rounded or corrected');
  /* a record without any stop event: the original calls it a manual stop by the operator and gives a flow of 0 */
  const head = 'RecordStart\t\t2026-01-01T10:00:00.000\t0\t0\t100000\t0\t0\n\t\t\t000D0080\t000F0080\t93000780\t93000540\t93000500\n\t\t\ts\ts\tPa\tm3/s\tm3\n';
  const row = (tt, p) => '\t\t\t' + tt + '\t0\t' + p + '\t0\t0\n';
  const rec = G.parseBuffer('REC.TXT', new TextEncoder().encode(head + [0, 0, 0, 0, 5, 5].map((t, i) => row(t, i < 4 ? 34492 : 28290)).join('') + 'RecordStop\t\t2026-01-01T10:03:00.000\n').buffer);
  const r = G.exportRow(itemOf(rec, {}), { eff, compat: true });
  assert.equal(r.Stop_type, 'Manu_Operator'); assert.equal(r.Average_flowrate, 0); assert.equal(r.Injected_volume, 0);
  assert.equal(r.Average_pressure, 0.4, 'all readings round to 0.3 bar, plus 0.1 for the grout column'); assert.equal(r['30s_pressure'], 0.4);
});

// Synthetic recordings isolate the decoded rules without checking private field files into git.
function nativeRow(pressures, endP, step = 1, eff = EFF, headLoss = 0) {
  const rec = { events: [], meta: { trigStep: step, headLoss: String(headLoss * 1e5) }, samples: pressures.map(pBar => ({ pBar })) };
  return G.exportRow({ rec, hdr: {}, st: { endP, vol: 0, avgQ: 0, q30: 0, endQ: 0 } }, { compat: true, eff });
}

test('native export replaces the final reading with reported end pressure before both means', () => {
  const p = Array(40).fill(2.25); p[39] = 80;
  const r = nativeRow(p, 0.6);
  assert.equal(r.Average_pressure, 2.26, '39 readings round halves to even (2.2), final gauge reading becomes 0.6, then +0.1');
  assert.equal(r['30s_pressure'], 2.25, '29 table readings and the reported final pressure, divided by 30');
  assert.equal(r.End_pressure, 0.6, 'the exported end pressure remains a gauge pressure');
});

test('native 30-second pressure counts the storage step and divides short records by readings used', () => {
  const r = nativeRow([...Array(5).fill(100), ...Array(15).fill(1)], 10, 2, null);
  assert.equal(r.Average_pressure, 26.2); assert.equal(r['30s_pressure'], 1.6, '15 readings span 30 seconds');
  const short = nativeRow([2, 4, 50], 6);
  assert.equal(short.Average_pressure, 4.1); assert.equal(short['30s_pressure'], 4.1, 'all three readings used; no division by 30');
  const fractional = nativeRow([...Array(5).fill(100), ...Array(15).fill(1)], 1, 1.5, null);
  assert.equal(fractional['30s_pressure'], 1, 'VB rounds its integer elapsed time after each addition (1.5 becomes 2 seconds)');
});

test('native pressures use Single accumulation and clamp corrected values per reading', () => {
  const long = nativeRow(Array(100000).fill(99.9), 99.9, 1, null);
  assert.equal(long.Average_pressure, 99.98, 'VB Single summation differs from a double-precision mean of 99.9');
  assert.equal(long['30s_pressure'], 99.9);
  const r = nativeRow([-1, 2, 9], 0, 1, EFF);
  assert.equal(r.Average_pressure, 0.73, 'negative effective samples clamp after the column correction');
  const loss = nativeRow([0.1, 2, 9], 0.2, 1, null, 0.5);
  assert.equal(loss.Average_pressure, 0.5, 'head loss and zero clamp apply to each sample, including the reported final pressure');
});
