import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { G, loadSample, itemOf, options } from './harness.mjs';

// Read the content streams actually written by jsPDF, not just drawing-call mocks.
function streams(doc) {
  const bytes = Buffer.from(doc.raw().output('arraybuffer')), text = bytes.toString('latin1'), result = [];
  const re = /<<[^>]*\/Length\s+(\d+)[^>]*>>\s*stream\r?\n/g;
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].length, body = bytes.subarray(start, start + Number(m[1]));
    result.push((/\/FlateDecode/.test(m[0]) ? zlib.inflateSync(body) : body).toString('latin1'));
  }
  assert.ok(result.length, 'PDF contains a readable drawing stream');
  return result.join('\n');
}

test('actual PDF and SVG encode the original grid dash units and round line caps', () => {
  const opt = options({ layout: 'classic' }), item = itemOf(loadSample(1));
  const pdf = G.pdfDoc(); G.buildDocument(pdf, [item], opt, 'records');
  const encoded = streams(pdf), dash = /\[([0-9. ]+)\]\s+0(?:\.0*)? d/.exec(encoded);
  assert.ok(dash, 'time-grid dash pattern was encoded');
  const values = dash[1].trim().split(/\s+/).map(Number);
  assert.ok(values.every(x => Math.abs(x - 0.375) < 0.000001), 'source 0.5 user units × 0.75 point = 0.375 point; not 0.5 mm');
  assert.match(encoded, /1 J/, 'round line caps bridge the very short grid gaps as in the original PDF');
  const svg = G.svgDoc(); G.buildDocument(svg, [item], opt, 'records');
  const xml = svg.pages[0].svg();
  assert.match(xml, /font-family="Arial, Helvetica, sans-serif"/, 'browser printing selects the original Arial face');
  assert.match(xml, /stroke-linecap="round"/);
  const svgDash = /stroke-dasharray="([0-9.]+) ([0-9.]+)"/.exec(xml);
  assert.ok(svgDash && svgDash.slice(1).every(v => Math.abs(Number(v) - 0.13229166666666667) < 1e-12), 'SVG uses the same physical dash length');
  assert.match(xml, /font-weight="400"[^>]*>1\/1<\/text>/, 'original specimen page number uses the regular font');
});

test('the vector PDF contains every original pressure/volume sample at its measured position', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const { root } = await import('./harness.mjs');
  const specimen = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/spec-pvg.json'), 'utf8'));
  const opt = options({ layout: 'classic' }); opt.o.reports = { time: false, pvg: true, pvf: false };
  const doc = G.pdfDoc(); G.buildDocument(doc, [itemOf(loadSample(1))], opt, 'records');
  const paths = []; let color = [], points = [];
  for (const line of streams(doc).split('\n')) {
    const tokens = line.trim().split(/\s+/), op = tokens.pop(), nums = tokens.map(Number);
    if (op === 'RG') color = nums;
    if (op === 'm') points = [[nums[0] * 25.4 / 72, 210 - nums[1] * 25.4 / 72]];
    if (op === 'l') points.push([nums[0] * 25.4 / 72, 210 - nums[1] * 25.4 / 72]);
    if (op === 'S' && color.join(',') === '0,0,1') paths.push(points);
  }
  const actual = paths.flat(), expected = specimen.lines.filter(l => l.stroke === '#0000ff');
  assert.equal(actual.length, expected.length + 1, 'all 363 original pressure segments are in the saved PDF');
  expected.forEach((line, i) => {
    assert.ok(Math.abs(actual[i + 1][0] - line.x2) <= 0.05, 'PDF sample ' + i + ' x');
    assert.ok(Math.abs(actual[i + 1][1] - line.y2) <= 0.05, 'PDF sample ' + i + ' y');
  });
});

test('PDF line and rectangle styles do not inherit round caps or joins from an earlier curve', () => {
  const doc = G.pdfDoc(), p = doc.addPage(210, 297);
  p.poly([[10, 10], [20, 20]], { c: '#0000ff' });
  p.line(10, 25, 20, 25, { c: '#000' });
  p.rect(10, 30, 10, 10, { stroke: '#000' });
  const encoded = streams(doc);
  assert.match(encoded, /1 J[\s\S]*0 J[\s\S]*0 j/, 'ordinary line cap and rectangle join are reset after drawing a curve');
});
