import { jsPDF } from 'jspdf';
import autoTable, { type UserOptions } from 'jspdf-autotable';
import { regular, bold } from '../assets/report-font';
import { computeExtStats, formatDuration, measurementWindows, parseConsignes, sanitizeStem, type DfiRecord, type DfiSample } from './dfi';
import { describeIssue, STR, type Lang } from './i18n';

export interface HeaderOverride { site: string; contract: string; job: string; operator: string; pump: string; grout: string }
export interface ReportOptions {
  company: string; language: Lang; layout: 'modern' | 'classic';
  includeTable: boolean; includeGin: boolean; includeEvents: boolean; includeSettings: boolean; includeVisas: boolean;
  comment: string; header: HeaderOverride;
}
export const emptyHeader = (): HeaderOverride => ({ site: '', contract: '', job: '', operator: '', pump: '', grout: '' });
type T = (typeof STR)[Lang];
const f = (n: number | null, digits = 2) => n !== null && Number.isFinite(n) ? n.toFixed(digits) : '-';
const safe = (s: string) => s.replace(/[—–]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/→/g, '->');
function supported(doc: jsPDF, text: string) {
  const font = doc.getFont().metadata as unknown as { characterToGlyph(code: number): number };
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (![9, 10, 13].includes(code) && !font.characterToGlyph(code)) throw new Error(`unsupportedText (U+${code.toString(16).toUpperCase()})`);
  }
}
export function resolvedHeader(rec: DfiRecord, h = emptyHeader()): HeaderOverride {
  return { site: h.site || rec.meta.jobSite, contract: h.contract || rec.meta.contract,
    job: h.job || rec.meta.jobName, operator: h.operator || rec.meta.operator, pump: h.pump, grout: h.grout || rec.meta.groutName };
}
function document(landscape = false): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait', putOnlyUsedFonts: true });
  doc.addFileToVFS('Report.ttf', regular); doc.addFont('Report.ttf', 'Report', 'normal');
  doc.addFileToVFS('Report-Bold.ttf', bold); doc.addFont('Report-Bold.ttf', 'Report', 'bold');
  doc.setFont('Report', 'normal');
  return doc;
}
function fit(doc: jsPDF, text: string, x: number, y: number, width: number, size: number, align: 'left' | 'center' | 'right' = 'left') {
  text = safe(text).replace(/[\r\n\t]+/g, ' '); supported(doc, text); doc.setFontSize(size);
  while (doc.getTextWidth(text) > width && size > 5) { size -= .25; doc.setFontSize(size); }
  // Wrapping belongs in tables; short page headings are fitted without cutting characters.
  if (doc.getTextWidth(text) > width) {
    // Full values remain in metadata cells. A long heading is safely wrapped.
    doc.setFontSize(5); doc.text(doc.splitTextToSize(text, width), x, y, { align, lineHeightFactor: 1 });
  } else doc.text(text, x, y, { align });
}
function pageHeader(doc: jsPDF, opt: ReportOptions, title: string, sub: string) {
  const width = doc.internal.pageSize.getWidth(), modern = opt.layout === 'modern';
  doc.setFillColor(...(modern ? [17, 24, 39] : [255, 255, 255]) as [number, number, number]);
  doc.rect(0, 0, width, 24, 'F'); doc.setTextColor(modern ? 255 : 0);
  doc.setFont('Report', 'bold'); fit(doc, opt.company || STR[opt.language].appName, 12, 8, width - 24, 10);
  fit(doc, title, width / 2, 15, width - 24, 12, 'center');
  doc.setFont('Report', 'normal'); fit(doc, sub, width / 2, 21, width - 24, 7, 'center');
  doc.setDrawColor(0); doc.setLineWidth(.3); doc.line(12, 25, width - 12, 25); doc.setTextColor(0);
}
function decorate(doc: jsPDF, opt: ReportOptions, title: string, sub: string) {
  const t = STR[opt.language], lang = opt.language;
  const stamp = new Date().toLocaleString({ sv: 'sv-SE', en: 'en-GB', no: 'nb-NO' }[lang]);
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i); pageHeader(doc, opt, title, sub);
    doc.setFont('Report', 'normal'); doc.setFontSize(6.5); doc.setTextColor(80);
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    doc.text(`${t.generated} ${stamp}`, 12, h - 8);
    doc.text(`${t.page} ${i} / ${doc.getNumberOfPages()}`, w - 12, h - 8, { align: 'right' });
  }
}
function table(doc: jsPDF, opt: ReportOptions, title: string, sub: string, y: number, config: UserOptions): number {
  for (const rows of [config.head, config.body]) for (const row of rows ?? []) {
    if (Array.isArray(row)) for (let i = 0; i < row.length; i++) if (typeof row[i] === 'string') {
      row[i] = safe(row[i] as string); supported(doc, row[i] as string);
    }
  }
  y = room(doc, opt, title, sub, y, config.head?.length ? 22 : 10);
  autoTable(doc, {
    startY: y, margin: { left: 12, right: 12, top: 30, bottom: 16 }, theme: 'grid',
    styles: { font: 'Report', fontSize: 7.5, cellPadding: 1.5, textColor: 0, lineColor: 150, overflow: 'linebreak' },
    headStyles: { fillColor: opt.layout === 'classic' ? [235, 235, 235] : [30, 41, 59], textColor: opt.layout === 'classic' ? 0 : 255 },
    rowPageBreak: 'avoid',
    ...config,
  });
  return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
}
function room(doc: jsPDF, _opt: ReportOptions, _title: string, _sub: string, y: number, need: number): number {
  if (y + need <= doc.internal.pageSize.getHeight() - 16) return y;
  doc.addPage(); return 30;
}
function paragraph(doc: jsPDF, opt: ReportOptions, title: string, sub: string, y: number, text: string): number {
  doc.setFont('Report', 'normal'); doc.setFontSize(7); doc.setTextColor(40);
  text = safe(text); supported(doc, text);
  const lines: string[] = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - 24);
  for (const line of lines) { y = room(doc, opt, title, sub, y, 4); doc.text(line, 12, y + 3); y += 4; }
  return y + 2;
}
function range(values: number[], extra = 0) {
  let low = 0, high = extra;
  for (const v of values) { low = Math.min(low, v); high = Math.max(high, v); }
  const raw = (high - low) / 4 || .25, power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((n) => n * power >= raw)! * power;
  return { low: Math.floor(low / step) * step, high: Math.ceil(high / step) * step || step };
}
function path(doc: jsPDF, points: Array<[number, number]>) {
  for (let i = 1; i < points.length; i++) doc.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
}

/** Every source point, numeric scales and independent P/Q/V axes. No smoothing or decimation. */
export function drawCombinedChart(doc: jsPDF, rec: DfiRecord, y: number, height: number, t: T, classic: boolean): void {
  const pts = rec.samples; if (!pts.length) return;
  const limits = rec.events.filter((e) => e.name === 'SetCons').map((e) => parseConsignes(e.data).pressureLimitBar ?? 0);
  const pressure = range([...pts.map((s) => s.pressBar), ...limits], parseConsignes(rec.meta.setConsRaw).pressureLimitBar ?? 0);
  const flow = range(pts.map((s) => s.flowLmin)), volume = range(pts.map((s) => s.volL));
  const x = 26, top = y + 12, w = 137, h = height - 28;
  const maxT = Math.max(pts.at(-1)!.tTotal, 1);
  const mx = (s: DfiSample) => x + s.tTotal / maxT * w;
  const my = (v: number, r: { low: number; high: number }) => top + h - (v - r.low) / (r.high - r.low) * h;
  doc.setFont('Report', 'bold'); doc.setFontSize(9); doc.setTextColor(0); doc.text(t.diagramPVQ, 105, y + 4, { align: 'center' });
  doc.setFont('Report', 'normal'); doc.setFontSize(6.5);
  doc.text('P (bar)', x - 2, top - 3, { align: 'right' }); doc.text('Q (l/min)', x + w + 3, top - 3); doc.text('V (l)', 186, top - 3);
  for (let i = 0; i <= 4; i++) {
    const fraction = i / 4, gy = top + h * (1 - fraction), gx = x + w * fraction;
    doc.setLineWidth(.15); doc.setDrawColor(200); doc.line(x, gy, x + w, gy); doc.line(gx, top, gx, top + h);
    doc.setTextColor(0); doc.text(f(pressure.low + fraction * (pressure.high - pressure.low), 2), x - 2, gy + 1, { align: 'right' });
    doc.text(f(flow.low + fraction * (flow.high - flow.low), 2), x + w + 3, gy + 1);
    doc.text(f(volume.low + fraction * (volume.high - volume.low), 2), 186, gy + 1);
    doc.text(f(maxT * fraction, 1), gx, top + h + 4, { align: 'center' });
  }
  doc.setDrawColor(0); doc.rect(x, top, w, h); doc.text(`${t.timeTotal}`, x + w / 2, top + h + 8, { align: 'center' });
  const series = [
    { key: 'pressBar' as const, scale: pressure, dash: [], color: [0, 0, 0], label: 'P (bar)' },
    { key: 'flowLmin' as const, scale: flow, dash: [2, 1], color: classic ? [0, 0, 0] : [5, 150, 105], label: 'Q (l/min)' },
    { key: 'volL' as const, scale: volume, dash: [.4, 1], color: classic ? [0, 0, 0] : [217, 119, 6], label: 'V (l)' },
  ];
  series.forEach((series, i) => {
    doc.setDrawColor(...series.color as [number, number, number]); doc.setLineWidth(.35); doc.setLineDashPattern(series.dash, 0);
    path(doc, pts.map((s) => [mx(s), my(s[series.key], series.scale)]));
    const lx = 35 + i * 48; doc.line(lx, y + height - 2, lx + 9, y + height - 2);
    doc.setTextColor(0); doc.text(series.label, lx + 11, y + height - 1);
  });
  doc.setLineDashPattern([], 0);
  // Setpoint history is drawn over its actual time intervals, including changes.
  const changes = rec.events.filter((e) => e.name === 'SetCons' && Number.isFinite(e.tTotal));
  changes.forEach((e, i) => {
    const p = parseConsignes(e.data).pressureLimitBar;
    if (p === null || p < pressure.low || p > pressure.high) return;
    const end = changes[i + 1]?.tTotal ?? maxT;
    doc.setDrawColor(120); doc.setLineWidth(.2); doc.setLineDashPattern([4, 2], 0);
    doc.line(x + e.tTotal / maxT * w, my(p, pressure), x + end / maxT * w, my(p, pressure));
  });
  doc.setLineDashPattern([], 0);
}
function ginChart(doc: jsPDF, rec: DfiRecord, y: number, t: T, classic: boolean) {
  const st = computeExtStats(rec), pts = rec.samples;
  doc.setFont('Report', 'bold'); doc.setFontSize(9); doc.setTextColor(0); doc.text(t.ginTitle, 12, y + 4);
  doc.setFont('Report', 'normal'); doc.setFontSize(7); doc.text(safe(t.ginHint), 12, y + 9);
  const p = range(pts.map((s) => s.pressBar)), v = range(pts.map((s) => s.volL));
  const x = 26, top = y + 16, w = 160, h = 48;
  for (let i = 0; i <= 4; i++) {
    const q = i / 4; doc.setDrawColor(200); doc.setLineWidth(.15);
    doc.line(x, top + h * q, x + w, top + h * q);
    doc.text(f(p.high - q * (p.high - p.low)), x - 2, top + h * q + 1, { align: 'right' });
    doc.text(f(v.low + q * (v.high - v.low)), x + w * q, top + h + 4, { align: 'center' });
  }
  doc.setDrawColor(classic ? 0 : 79, classic ? 0 : 70, classic ? 0 : 229); doc.setLineWidth(.35);
  path(doc, pts.map((s) => [x + (s.volL - v.low) / (v.high - v.low) * w, top + h - (s.pressBar - p.low) / (p.high - p.low) * h]));
  doc.setLineDashPattern([2, 1], 0); const curve: Array<[number, number]> = [];
  for (let i = 1; i <= 160; i++) { const vv = v.high * i / 160, pp = st.ginEnd / vv;
    if (pp >= p.low && pp <= p.high) curve.push([x + (vv - v.low) / (v.high - v.low) * w, top + h - (pp - p.low) / (p.high - p.low) * h]); }
  path(doc, curve); doc.setLineDashPattern([], 0); doc.setTextColor(0); doc.text('V (l)', 186, top + h + 9, { align: 'right' });
}
export function reportFileName(rec: DfiRecord): string {
  const job = rec.meta.jobName.trim() ? sanitizeStem(rec.meta.jobName) + '_' : '';
  return `${job}${sanitizeStem(rec.meta.fileName.replace(/\.(DFI|DMJ|TXT)$/i, ''))}.pdf`;
}
export function generateReportPdf(rec: DfiRecord, opt: ReportOptions): jsPDF {
  const t = STR[opt.language], doc = document(), st = computeExtStats(rec), h = resolvedHeader(rec, opt.header), cons = parseConsignes(rec.meta.setConsRaw);
  const title = `${t.groutingRecord} · ${h.job || rec.meta.fileName}`;
  const sub = `${t.file}: ${rec.meta.fileName} · ${t.software}: ${rec.meta.softVersion || '-'}`;
  let y = 30;
  const info = [
    [t.site, h.site || '-', t.borehole, h.job || '-'],
    [t.contract, h.contract || '-', t.operator, h.operator || '-'],
    [t.pump, h.pump || '-', t.grout, h.grout || '-'],
    [t.start, rec.meta.recordStart || '-', t.end, rec.meta.recordStop || '-'],
    [t.measureWindow, `${rec.meta.measureStart || '-'} -> ${rec.meta.measureStop || '-'}`, t.stopType, st.stopType || '-'],
    [t.pressureLimit, `${f(cons.pressureLimitBar)} bar`, t.volumeLimit, `${f(cons.volumeLimitL)} l`],
    [t.safetyPressure, `${f(cons.safetyPressureBar)} bar`, t.reprises, String(st.reprises)],
  ];
  if (opt.comment) info.push([t.comment, opt.comment, '', '']);
  y = table(doc, opt, title, sub, y, { body: info.map((row) => row.map(safe)), columnStyles: { 0: { fontStyle: 'bold', cellWidth: 34 }, 1: { cellWidth: 59 }, 2: { fontStyle: 'bold', cellWidth: 34 }, 3: { cellWidth: 59 } } });
  if (rec.samples.length) {
    y = table(doc, opt, title, sub, y, { head: [['', 'P (bar)', 'Q (l/min)', 'V (l) / t (s)']], body: [
      [t.avgP + ' / ' + t.avgQ, f(st.avgPressBar), f(st.avgFlowLmin), `${f(st.totalVolL, 3)} l / ${f(st.durationMeasure, 3)} s`],
      [t.maxP + ' / ' + t.maxQ, f(st.maxPressBar), f(st.maxFlowLmin), `${t.durationTotal}: ${formatDuration(st.durationTotal)}`],
      [t.measuredEnd, f(st.endPressBar), f(st.endFlowLmin), `${f(st.totalVolL, 3)} l`],
      [t.reportedStop, f(st.reportedEndPressBar), f(st.reportedEndFlowLmin), `${f(st.reportedEndVolL, 3)} l`],
      [t.p30, f(st.p30Bar), f(st.q30Lmin), `${t.measDur}: ${formatDuration(st.durationMeasure)}`],
    ] });
    y = paragraph(doc, opt, title, sub, y, t.calcHint);
    y = room(doc, opt, title, sub, y, 88); drawCombinedChart(doc, rec, y, 84, t, opt.layout === 'classic'); y += 88;
  } else y = paragraph(doc, opt, title, sub, y, t.noData);
  y = paragraph(doc, opt, title, sub, y, `${t.sourceLabel}: ${rec.meta.source === 'binary' ? t.binarySource : rec.meta.source === 'text' ? t.textSource : '-'}`);
  for (const warning of rec.warnings.filter((w) => !['binarySource', 'textSource'].includes(w))) y = paragraph(doc, opt, title, sub, y, describeIssue(warning, opt.language));
  if (opt.includeVisas) {
    y = room(doc, opt, title, sub, y, 28); doc.setFontSize(8);
    [t.signOperator, t.signClient, t.date].forEach((label, i) => { const x = 12 + i * 63; doc.setDrawColor(120); doc.rect(x, y, 60, 23); doc.text(label, x + 3, y + 5); });
    y += 28;
  }
  // Appendices always start on a clean page, leaving the main sheet usable as a printout.
  const appendix = () => { doc.addPage(); y = 30; };
  if (opt.includeEvents && rec.events.length) {
    appendix();
    y = table(doc, opt, title, sub, y, { head: [[t.events, t.dataValue, t.dateCol, t.timeTotal]],
      body: rec.events.map((e) => [e.name, safe(e.data || '-'), e.date || '-', f(e.tTotal, 6)]),
      columnStyles: { 0: { cellWidth: 36 }, 1: { cellWidth: 76 }, 2: { cellWidth: 47 }, 3: { cellWidth: 27 } } });
    const windows = measurementWindows(rec);
    if (windows.length) y = table(doc, opt, title, sub, y, { head: [[t.measureWindow, t.start, t.end, t.measDur, 'V (l)']],
      body: windows.map((w, i) => [String(i + 1), w.start.date, w.stop.date, f(w.stop.tMeas - w.start.tMeas, 6), f((w.stop.volM3 - w.start.volM3) * 1000, 6)]) });
  }
  if (opt.includeSettings) {
    const rows = Object.entries(rec.meta.params).map(([k, v]) => [k, safe(v)]);
    if (rec.meta.setConsRaw) rows.unshift(['SetCons', rec.meta.setConsRaw]);
    if (rec.meta.ginRaw) rows.unshift(['Gin', rec.meta.ginRaw]);
    if (rec.meta.trig) rows.unshift(['Trig', `${rec.meta.trig}; ${rec.meta.trigStep}`]);
    rec.meta.channels.forEach((c, i) => rows.push([c, rec.meta.units[i] ?? '-']));
    if (rows.length) { appendix(); y = table(doc, opt, title, sub, y, { head: [[t.settings, t.valueCol]], body: rows }); }
  }
  if (opt.includeGin && st.ginEnd > 0 && rec.samples.length) {
    appendix(); ginChart(doc, rec, y, t, opt.layout === 'classic');
    y = paragraph(doc, opt, title, sub, y + 80, `${t.ginValue}: ${f(st.ginEnd)} bar·l`);
  }
  if (opt.includeTable && rec.samples.length) {
    appendix();
    const extra = rec.meta.channels.filter((c) => !['000D0080', '000F0080', '93000780', '93000540', '93000500'].includes(c));
    table(doc, opt, title, sub, y, { head: [[t.timeTotal, t.timeMeas, 'P (Pa)', 'Q (m3/s)', 'V (m3)', ...extra]],
      body: rec.samples.map((s) => [String(s.tTotal), String(s.tMeas), String(s.pressPa), String(s.flowM3s), String(s.volM3), ...extra.map((c) => String(s.values?.[c] ?? '-'))]),
      styles: { font: 'Report', fontSize: 6.5, cellPadding: 1.2, textColor: 0, overflow: 'linebreak' } });
  }
  decorate(doc, opt, title, sub); return doc;
}
export function generateClassicPdf(rec: DfiRecord, opt: ReportOptions): jsPDF { return generateReportPdf(rec, { ...opt, layout: 'classic' }); }
export function generateSummaryPdf(recs: DfiRecord[], opt: ReportOptions): jsPDF {
  const t = STR[opt.language], doc = document(true), title = t.bilan;
  const usable = recs.filter((r) => r.samples.length), sub = `${usable.length} ${t.files}`;
  let y = table(doc, opt, title, sub, 30, { head: [[t.borehole, t.site, t.start, t.measDur, 'V (l)', `${t.avgP} (bar)`, `${t.endP} (bar)`, `${t.reportedStop} P (bar)`, `${t.avgQ} (l/min)`, t.reprises, t.stopType]],
    body: usable.map((r) => { const s = computeExtStats(r); return [r.meta.jobName || r.meta.fileName, r.meta.jobSite, r.meta.recordStart,
      formatDuration(s.durationMeasure), f(s.totalVolL, 3), f(s.avgPressBar), f(s.endPressBar), f(s.reportedEndPressBar), f(s.avgFlowLmin), String(s.reprises), s.stopType || '-']; }),
    styles: { font: 'Report', fontSize: 7, cellPadding: 1.2, overflow: 'linebreak' } });
  y = paragraph(doc, opt, title, sub, y, `${t.totalVol}: ${f(usable.reduce((n, r) => n + computeExtStats(r).totalVolL, 0), 3)} l`);
  paragraph(doc, opt, title, sub, y, t.calcHint); decorate(doc, opt, title, sub); return doc;
}
