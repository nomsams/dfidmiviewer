import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDfiFile } from '../src/lib/dfi.ts';
import { emptyHeader, generateReportPdf, generateSummaryPdf, drawCombinedChart, drawGinChart, type ReportOptions } from '../src/lib/pdf.ts';
import { ginPlot, axisTicks } from '../src/lib/charts.ts';
import { STR } from '../src/lib/i18n.ts';

const record = await parseDfiFile(new File([readFileSync(new URL('../public/sample2.DFI', import.meta.url))], 'sample2.DFI'));
const options: ReportOptions = { company: 'Ångström Øresund', language: 'sv', layout: 'classic', classicColour: false, includeTable: false, includeGin: false, includeEvents: false, includeSettings: false, includeVisas: false, comment: '', header: emptyHeader() };
test('all report layouts/languages generate a compact main sheet', () => {
  for (const layout of ['modern', 'classic'] as const) for (const language of ['sv', 'en', 'no'] as const) {
    const doc = generateReportPdf(record, { ...options, layout, language });
    assert.equal(doc.getNumberOfPages(), 1, `${layout}/${language}`);
    assert.ok(doc.output('arraybuffer').byteLength > 10000);
  }
});
test('unsupported Unicode fails visibly rather than dropping glyphs', () => {
  assert.throws(() => generateReportPdf(record, { ...options, header: { ...emptyHeader(), site: '東京' } }), /unsupportedText/);
});
test('print curves retain every sample including a narrow spike', () => {
  const doc = generateReportPdf(record, options);
  const paths: Array<{ steps: number[][]; x: number; y: number }> = [];
  doc.lines = ((steps: number[][], x: number, y: number) => { if (steps.length > 1) paths.push({ steps, x, y }); return doc; }) as typeof doc.lines;
  const many = Array.from({ length: 1000 }, (_, i) => ({ ...record.samples[0], tTotal: i, pressBar: i === 501 ? 100 : 0, flowLmin: 0, volL: i }));
  drawCombinedChart(doc, { ...record, samples: many, events: [] }, 30, 84, STR.sv, true);
  assert.equal(paths.length, 3);
  assert.ok(paths.every((p) => p.steps.length === many.length - 1));
  // Reconstruct the pressure vertices: the single spike must reach the top.
  let y = paths[0].y;
  const heights = [y, ...paths[0].steps.map((step) => y += step[1])];
  assert.ok(Math.abs(heights[501] - 42) < .001);
  assert.ok(Math.abs(heights[500] - 98) < .001 && Math.abs(heights[502] - 98) < .001);
});

test('GIN print uses only the recorded trace and the browser scales', () => {
  const doc = generateReportPdf(record, options);
  const paths: Array<{ steps: number[][]; x: number; y: number }> = [];
  doc.lines = ((steps: number[][], x: number, y: number) => { if (steps.length > 1) paths.push({ steps, x, y }); return doc; }) as typeof doc.lines;
  drawGinChart(doc, record, 30, STR.sv, true);
  assert.equal(paths.length, 1, 'No synthetic reference line');
  const plot = ginPlot(record);
  assert.equal(plot.points.length, record.samples.length);
  assert.deepEqual(axisTicks(plot.pressure), [0, 1, 2, 3, 4]);
  assert.deepEqual(axisTicks(plot.volume), [0, 5, 10, 15, 20]);
  let x = paths[0].x, y = paths[0].y;
  const actual = [[x, y], ...paths[0].steps.map((step) => [x += step[0], y += step[1]])];
  record.samples.forEach((s, i) => {
    assert.ok(Math.abs(actual[i][0] - (26 + s.volL / 20 * 160)) < 1e-8);
    assert.ok(Math.abs(actual[i][1] - (94 - s.pressBar / 4 * 48)) < 1e-8);
  });
});

test('Classic colour is optional and does not change recorded curve geometry', () => {
  const mono = generateReportPdf(record, { ...options, includeGin: true }).output();
  const colour = generateReportPdf(record, { ...options, includeGin: true, classicColour: true }).output();
  const strokes = (pdf: string) => pdf.split('\n').filter((line) => line.endsWith(' RG'));
  assert.equal(strokes(mono).length, 0);
  assert.ok(strokes(colour).length >= 4, 'P/Q/V and GIN have coloured strokes');
  const vertices = (pdf: string) => pdf.split('\n').filter((line) => / (?:m|l)$/.test(line));
  assert.deepEqual(vertices(colour), vertices(mono));
});

test('GIN trace is included even when its end pressure is zero', () => {
  const zeroEnd = { ...record, events: record.events.map((e) => e.name === 'MeasureDStop' ? { ...e, pressPa: 0 } : e) };
  assert.equal(generateReportPdf(zeroEnd, { ...options, includeGin: true }).getNumberOfPages(), 2);
});
test('events, settings and raw rows have no silent caps', () => {
  const doc = generateReportPdf({ ...record, events: [...record.events, ...Array.from({ length: 70 }, (_, i) => ({ ...record.events[0], name: 'Extra_' + i, date: '', data: 'kept' }))],
    meta: { ...record.meta, params: { ...record.meta.params, ...Object.fromEntries(Array.from({ length: 70 }, (_, i) => ['Extra_' + i, 'kept'])) } } },
    { ...options, includeTable: true, includeEvents: true, includeSettings: true });
  assert.ok(doc.getNumberOfPages() > 10);
});
test('landscape summary paginates many records', () => {
  const doc = generateSummaryPdf(Array.from({ length: 75 }, () => record), options);
  assert.ok(doc.getNumberOfPages() > 1); assert.ok(doc.internal.pageSize.getWidth() > 290);
});
