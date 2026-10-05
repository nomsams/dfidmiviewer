import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDfiFile } from '../src/lib/dfi.ts';
import { emptyHeader, generateReportPdf, generateSummaryPdf, drawCombinedChart, type ReportOptions } from '../src/lib/pdf.ts';
import { STR } from '../src/lib/i18n.ts';

const record = await parseDfiFile(new File([readFileSync(new URL('../public/sample2.DFI', import.meta.url))], 'sample2.DFI'));
const options: ReportOptions = { company: 'Ångström Øresund', language: 'sv', layout: 'classic', includeTable: false, includeGin: false, includeEvents: false, includeSettings: false, includeVisas: false, comment: '', header: emptyHeader() };
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
  const lines: number[][] = [];
  doc.line = ((...args: number[]) => { lines.push(args); return doc; }) as typeof doc.line;
  const many = Array.from({ length: 1000 }, (_, i) => ({ ...record.samples[0], tTotal: i, pressBar: i === 501 ? 100 : 0, flowLmin: 0, volL: i }));
  drawCombinedChart(doc, { ...record, samples: many, events: [] }, 30, 84, STR.sv, true);
  assert.ok(lines.length >= 3 * (many.length - 1));
  // P is first plotted series, after ten grid lines and three legend lines.
  assert.ok(lines.some((a) => Math.abs(a[1] - 42) < .001 || Math.abs(a[3] - 42) < .001));
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
