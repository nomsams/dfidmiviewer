import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANNELS, parseDfiFile, parseTar, parseRecTxt, parseRecBn1, computeExtStats, measurementWindows, csvText, parseConsignes, formatDuration, type DfiRecord } from '../src/lib/dfi.ts';

const load = (n: string) => parseDfiFile(new File([readFileSync(new URL('../public/' + n, import.meta.url))], n));
const entries = parseTar(readFileSync(new URL('../public/sample.DFI', import.meta.url)).buffer as ArrayBuffer);
const find = (n: string) => [...entries].find(([k]) => k.endsWith(n))![1];
function tar(files: Array<[string, Uint8Array | string]>): Uint8Array {
  const encoder = new TextEncoder(), chunks: Uint8Array[] = [];
  for (const [name, data] of files) {
    const b = typeof data === 'string' ? encoder.encode(data) : data, h = new Uint8Array(512);
    const write = (s: string, pos: number) => h.set(encoder.encode(s), pos);
    write(name, 0); write('0000777\0', 100); write('0000000\0', 108); write('0000000\0', 116);
    write(b.length.toString(8).padStart(11, '0') + '\0', 124); write('00000000000\0', 136);
    h.fill(32, 148, 156); h[156] = 48; write('ustar\0', 257);
    write(h.reduce((n, x) => n + x, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    const padded = new Uint8Array(Math.ceil(b.length / 512) * 512); padded.set(b); chunks.push(h, padded);
  }
  chunks.push(new Uint8Array(1024));
  const out = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0)); let pos = 0;
  for (const b of chunks) { out.set(b, pos); pos += b.length; } return out;
}
test('real fixtures preserve all binary samples and last measurement stop', async () => {
  for (const [name, count, windows] of [['sample.DFI', 363, 1], ['sample2.DFI', 483, 5]] as const) {
    const r = await load(name); assert.equal(r.samples.length, count); assert.equal(r.meta.source, 'binary');
    assert.equal(measurementWindows(r).length, windows);
    assert.equal(r.meta.measureStop, r.events.findLast((e) => e.name === 'MeasureDStop')!.date);
    assert.equal(csvText(r).split('\r\n').length, count + 1);
    const st = computeExtStats(r), end = r.events.findLast((e) => e.name === 'MeasureDStop')!;
    assert.equal(st.endPressBar, end.pressPa / 1e5);
    assert.equal(st.endFlowLmin, end.flowM3s * 60000);
  }
});
test('recorder stop values and measured values remain distinct', async () => {
  const st = computeExtStats(await load('sample2.DFI'));
  assert.equal(st.reportedEndPressBar, 1.8); assert.equal(st.reportedEndVolL, 18);
  assert.equal(st.endPressBar, 1.8891196875); assert.equal(st.totalVolL, 18.01200583577156);
  assert.equal(st.reprises, 4); assert.equal(st.reportedEndFlowLmin, 0);
});
test('limits are SI values without arbitrary range clamps', () => {
  assert.deepEqual(parseConsignes('00400000;0;03.000;00800000;0;000'), { pressureLimitBar: 4, volumeLimitL: 3000, safetyPressureBar: 8, raw: '00400000;0;03.000;00800000;0;000' });
  assert.equal(parseConsignes('25000000;0;2;40000000').pressureLimitBar, 250);
  assert.equal(parseConsignes('bad;0;bad;bad').pressureLimitBar, null);
});
test('raw text and binary-only archives both retain metadata and stops', async () => {
  const txt = await parseDfiFile(new File([find('REC.TXT')], 'REC.TXT'));
  assert.equal(txt.meta.kind, 'REC.TXT'); assert.equal(txt.meta.jobName, '18-2'); assert.equal(txt.samples.length, 363);
  const b = await parseDfiFile(new File([tar([...entries].filter(([k]) => !k.endsWith('REC.TXT')))], 'binary.DFI'));
  assert.equal(b.samples.length, 363); assert.equal(b.events.filter((e) => e.name === 'MeasureDStart').length, 1);
  assert.equal(computeExtStats(b).endPressBar, computeExtStats(await load('sample.DFI')).endPressBar);
});
test('single-member update archives are recognized independently of extension', async () => {
  const r = await parseDfiFile(new File([tar([['update/UPDATE.XML', '<Xml/>']])], 'update.DMJ'));
  assert.equal(r.meta.kind, 'DMJ-update'); assert.deepEqual(r.samples, []); assert.ok(r.warnings.includes('dmjWarn'));
});
test('tar checksums, bounds, duplicate names and multiple records are rejected', async () => {
  const checksum = tar([['REC.TXT', find('REC.TXT')]]); checksum[0] ^= 1;
  assert.throws(() => parseTar(checksum.buffer as ArrayBuffer), /invalidArchive/);
  const cut = tar([['REC.TXT', find('REC.TXT')]]).slice(0, 1024);
  assert.throws(() => parseTar(cut.buffer as ArrayBuffer), /invalidArchive/);
  assert.throws(() => parseTar(tar([['REC.TXT', 'a'], ['REC.TXT', 'b']]).buffer as ArrayBuffer), /invalidArchive/);
  await assert.rejects(parseDfiFile(new File([tar([['a/REC.TXT', find('REC.TXT')], ['b/REC.TXT', find('REC.TXT')]])], 'many.DFI')), /multipleRecords/);
});
test('binary corruption is never silently discarded', () => {
  assert.throws(() => parseRecBn1(find('REC.BN1').slice(0, -1)), /invalidBinary/);
  const b = find('REC.BN1').slice(); b[4] = 4; assert.throws(() => parseRecBn1(b), /invalidBinary/);
  const nan = find('REC.BN1').slice(); new DataView(nan.buffer).setFloat32(13, NaN, true);
  assert.throws(() => parseRecBn1(nan), /invalidBinary/);
  const finiteCorruption = find('REC.BN1').slice(); finiteCorruption[13] ^= 1;
  assert.throws(() => parseRecBn1(finiteCorruption), /invalidBinary.*checksum/);
});
const rawText = (channels: string[], units: string[], row: string[]) => ['RecordStart\t\t2026-01-01T00:00:00', '\t\t\t' + channels.join('\t'), '\t\t\t' + units.join('\t'), '\t\t\t' + row.join('\t')].join('\n');
test('reordered channels, decimal commas, scientific notation and extra channels', () => {
  const c = ['93000500', '000F0080', '93000780', '000D0080', '93000540', 'DEADBEEF'];
  const r = parseRecTxt(rawText(c, ['l', 's', 'bar', 's', 'l/min', 'V'], ['1,5', '2', '3e0', '+4', '.5', '12']));
  assert.equal(r.samples[0].volL, 1.5); assert.equal(r.samples[0].pressPa, 300000);
  assert.equal(r.samples[0].tTotal, 4); assert.equal(r.samples[0].flowLmin, .5); assert.equal(r.samples[0].values?.DEADBEEF, 12);
});
test('missing cells and unsupported units/channels are visible errors', () => {
  assert.throws(() => parseRecTxt(rawText(CHANNELS, ['s', 's', 'Pa', 'm3/s', 'm3'], ['0', '0', '', '0', '0'])), /invalidSamples/);
  assert.throws(() => parseRecTxt(rawText(CHANNELS, ['s', 's', 'psi', 'm3/s', 'm3'], ['0', '0', '1', '0', '0'])), /unsupportedUnits/);
  assert.throws(() => parseRecTxt(rawText(CHANNELS.slice(0, 4), ['s', 's', 'Pa', 'm3/s'], ['0', '0', '1', '0'])), /unsupportedChannels/);
});
test('text/binary disagreement and bad event offsets block import', async () => {
  const text = new TextDecoder().decode(find('REC.TXT')).replace('159438.109375', '999999.000000');
  // Change a numeric sample as well as RecordStart.
  const changed = text.replace('159438.109375', '999999.000000');
  const files = [...entries].map(([k, v]) => [k, k.endsWith('REC.TXT') ? changed : v] as [string, string | Uint8Array]);
  await assert.rejects(parseDfiFile(new File([tar(files)], 'bad.DFI')), /sourceMismatch/);
  const xml = new TextDecoder().decode(find('REC.XML')).replace('pos="00000000"', 'pos="00000001"');
  await assert.rejects(parseDfiFile(new File([tar([...entries].map(([k, v]) => [k, k.endsWith('REC.XML') ? xml : v]))], 'bad.DFI')), /invalidXml/);
});
test('XML entities and dates decode without exposing escaped names', async () => {
  const xml = new TextDecoder().decode(find('REC.XML')).replace('HABY', 'Å &amp; Ö');
  const r = await parseDfiFile(new File([tar([...entries].map(([k, v]) => [k, k.endsWith('REC.XML') ? xml : v]))], 'entities.DFI'));
  assert.equal(r.meta.jobSite, 'Å & Ö');
});
test('truncated and malformed XML is rejected', async () => {
  const xml = new TextDecoder().decode(find('REC.XML'));
  for (const changed of [xml.replace('</Xml>', ''), xml.replace('name="RecordStart"', 'name=RecordStart'), xml.replace('</Xml>', '</Wrong>')]) {
    await assert.rejects(parseDfiFile(new File([tar([...entries].map(([k, v]) => [k, k.endsWith('REC.XML') ? changed : v]))], 'bad.DFI')), /invalidXml/);
  }
});
test('averages use time weights and active boundaries, excluding idle tails', async () => {
  const r = await load('sample.DFI');
  const e = (name: string, time: number, pressure: number) => ({ name, data: '', date: '', tTotal: time, tMeas: time, pressPa: pressure * 1e5, flowM3s: 0, volM3: time / 1000 });
  const p = (time: number, pressure: number) => ({ ...e('', time, pressure), pressBar: pressure, flowLmin: 0, volL: time });
  const synthetic: DfiRecord = { ...r, samples: [p(0, 0), p(1, 10), p(10, 10), { ...p(100, 99), tMeas: 10.2 }],
    events: [e('MeasureDStart', 0, 0), e('MeasureDStop', 10, 10)] };
  const st = computeExtStats(synthetic); assert.equal(st.avgPressBar, 9.5); assert.equal(st.p30Bar, 9.5);
  assert.equal(st.durationMeasure, 10); assert.equal(st.totalVolL, 10); assert.equal(st.endPressBar, 10);
});
test('mismatched and incomplete windows fail instead of displaying partial totals', async () => {
  const r = await load('sample.DFI');
  assert.throws(() => computeExtStats({ ...r, events: r.events.filter((e) => e.name !== 'MeasureDStop') }), /incompleteRecord/);
  assert.throws(() => computeExtStats({ ...r, events: r.events.filter((e) => e.name !== 'MeasureDStart') }), /invalidWindows/);
});
test('duration formatting carries seconds safely', () => {
  assert.equal(formatDuration(3599.99), '00:59:59'); assert.equal(formatDuration(3600), '01:00:00'); assert.equal(formatDuration(NaN), '-');
});
