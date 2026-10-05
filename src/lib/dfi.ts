// Verified five-channel SI format. Unsupported formats fail instead of guessing.
export const CHANNELS = ['000D0080', '000F0080', '93000780', '93000540', '93000500'];
const SI = ['s', 's', 'Pa', 'm3/s', 'm3'];
export interface DfiSample {
  tTotal: number; tMeas: number; pressPa: number; flowM3s: number; volM3: number;
  pressBar: number; flowLmin: number; volL: number;
  values?: Record<string, number>;
}
export interface DfiEvent {
  name: string; data: string; date: string;
  tTotal: number; tMeas: number; pressPa: number; flowM3s: number; volM3: number;
}
export interface DfiMeta {
  fileName: string; kind: 'DFI-measurement' | 'DMJ-update' | 'REC.TXT' | 'unknown';
  softVersion: string; jobSite: string; contract: string; jobName: string; jobNumber: string;
  operator: string; groutName: string; recordStart: string; recordStop: string;
  phaseStart: string; phaseStop: string; pumpStart: string; pumpStop: string;
  measureStart: string; measureStop: string; setConsRaw: string; ginRaw: string;
  trig: string; trigStep: string; channels: string[]; units: string[];
  params: Record<string, string>; paramsRawXml: string; cfgRawXml: string; infoProc: string; infoVer: string;
  source: 'binary' | 'text' | 'none';
}
export interface DfiRecord { meta: DfiMeta; samples: DfiSample[]; events: DfiEvent[]; warnings: string[] }
function fail(code: string, detail = ''): never { throw new Error(code + (detail ? ` (${detail})` : '')); }
function decode(b: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { return new TextDecoder('windows-1252').decode(b); }
}
const field = (b: Uint8Array) => decode(b).split('\0')[0].trim();
export function parseTar(buf: ArrayBuffer): Map<string, Uint8Array> {
  const b = new Uint8Array(buf), out = new Map<string, Uint8Array>();
  let off = 0;
  while (off + 512 <= b.length) {
    const h = b.subarray(off, off + 512);
    if (h.every((v) => v === 0)) {
      if (b.subarray(off).some((v) => v !== 0)) fail('invalidArchive', 'end');
      break;
    }
    if (!field(h.subarray(257, 263)).startsWith('ustar')) fail('invalidArchive', 'ustar');
    const sizes = field(h.subarray(124, 136)), sums = field(h.subarray(148, 156));
    if (!/^[0-7]+$/.test(sizes) || !/^[0-7]+$/.test(sums)) fail('invalidArchive', 'size/checksum');
    const size = parseInt(sizes, 8), end = off + 512 + Math.ceil(size / 512) * 512;
    const sum = h.reduce((n, v, i) => n + (i >= 148 && i < 156 ? 32 : v), 0);
    if (sum !== parseInt(sums, 8)) fail('invalidArchive', 'checksum');
    if (!Number.isSafeInteger(size) || end > b.length) fail('invalidArchive', 'truncated');
    const name = [field(h.subarray(345, 500)), field(h.subarray(0, 100))].filter(Boolean).join('/').replace(/\\/g, '/');
    if (h[156] === 0 || h[156] === 48) {
      if (out.has(name)) fail('invalidArchive', name);
      out.set(name, b.slice(off + 512, off + 512 + size));
    } else if (h[156] !== 53) fail('unsupportedArchive', name);
    off = end;
  }
  if (!out.size) fail('invalidArchive');
  return out;
}
function xmlValue(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (n > 0x10ffff || n < 0 || (n >= 0xd800 && n <= 0xdfff)) fail('invalidXml');
      return String.fromCodePoint(n);
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()];
  });
}
function tags(xml: string, tag: string): Record<string, string>[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('invalidXml');
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  if (!clean.trim()) return [];
  const stack: string[] = []; let end = 0, roots = 0;
  for (const match of clean.matchAll(/<(?:"[^"]*"|'[^']*'|[^'">])*>/g)) {
    if (clean.slice(end, match.index).includes('<')) fail('invalidXml');
    const token = match[0], name = token.match(/^<\/?([\w:.-]+)/)?.[1];
    if (!name) fail('invalidXml');
    if (token.startsWith('</')) { if (stack.pop() !== name || !/^<\/[\w:.-]+\s*>$/.test(token)) fail('invalidXml'); }
    else {
      if (!stack.length) roots++;
      const attrText = token.slice(name.length + 1).replace(/\/?\s*>$/, '');
      const residue = attrText.replace(/\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*')/g, '');
      if (residue.trim() || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(attrText)) fail('invalidXml');
      if (!token.endsWith('/>')) stack.push(name);
    }
    end = match.index! + token.length;
  }
  if (stack.length || roots !== 1 || clean.slice(end).trim()) fail('invalidXml');
  return [...clean.matchAll(new RegExp(`<${tag}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, 'g'))].map((m) =>
    Object.fromEntries([...m[0].matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map((a) => [a[1], xmlValue(a[3])])));
}
function params(xml: string): Record<string, string> { return Object.assign({}, ...tags(xml, 'Param[LDS]')); }
function num(s: string): number {
  return /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(s.trim()) ? Number(s.trim().replace(',', '.')) : NaN;
}
function sample(values: number[], channels: string[], units: string[]): DfiSample {
  const factors: Record<string, number>[] = [{ s: 1, sec: 1, min: 60 }, { s: 1, sec: 1, min: 60 },
    { pa: 1, kpa: 1000, mpa: 1e6, bar: 1e5 }, { 'm3/s': 1, 'm3/min': 1 / 60, 'l/min': 1 / 60000, 'l/s': .001 }, { m3: 1, l: .001 }];
  const [tTotal, tMeas, pressPa, flowM3s, volM3] = CHANNELS.map((c, i) => {
    const j = channels.indexOf(c), u = (units[j] ?? '').replace(/³/g, '3').replace(/\s/g, '').toLowerCase();
    if (j < 0 || !Number.isFinite(values[j])) fail('invalidSamples', c);
    if (factors[i][u] === undefined) fail('unsupportedUnits', `${c}: ${u}`);
    return values[j] * factors[i][u];
  });
  if (tTotal < 0 || tMeas < 0 || volM3 < 0) fail('invalidSamples');
  return { tTotal, tMeas, pressPa, flowM3s, volM3, pressBar: pressPa / 1e5, flowLmin: flowM3s * 60000, volL: volM3 * 1000,
    values: Object.fromEntries(channels.map((c, i) => [c, values[i]])) };
}
function validate(s: DfiSample[]) {
  for (let i = 1; i < s.length; i++) if (s[i].tTotal < s[i - 1].tTotal || s[i].tMeas < s[i - 1].tMeas || s[i].volM3 + 1e-9 < s[i - 1].volM3) fail('resetCounters', String(i + 1));
}
export function parseRecTxt(text: string): { samples: DfiSample[]; events: DfiEvent[]; channels: string[]; units: string[] } {
  const samples: DfiSample[] = [], events: DfiEvent[] = [];
  let channels: string[] = [], units: string[] = [], column = -1;
  const lines = text.replace(/^\ufeff/, '').split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = lines[i].split('\t').map((c) => c.trim());
    if (!cells[0]) {
      const start = cells.findIndex(Boolean);
      if (start < 0) continue;
      if (/^[\da-f]{8}$/i.test(cells[start]) && cells.some((c) => c.toUpperCase() === '000D0080')) {
        channels = cells.slice(start).filter(Boolean).map((c) => c.toUpperCase()); column = start; units = [];
        if (new Set(channels).size !== channels.length || CHANNELS.some((c) => !channels.includes(c))) fail('unsupportedChannels');
        continue;
      }
      if (column < 0) fail('unsupportedChannels');
      if (!units.length) { units = cells.slice(column, column + channels.length); continue; }
      const values = cells.slice(column, column + channels.length).map(num);
      if (values.length !== channels.length || !values.every(Number.isFinite)) fail('invalidSamples', `REC.TXT: ${i + 1}`);
      samples.push(sample(values, channels, units));
    } else {
      const snapshot = column >= 0 && cells.length >= column + channels.length ? sample(cells.slice(column, column + channels.length).map(num), channels, units) : null;
      events.push({ name: cells[0], data: cells[1] ?? '', date: /^\d{4}-\d{2}-\d{2}T/.test(cells[2] ?? '') ? cells[2] : '',
        tTotal: snapshot?.tTotal ?? NaN, tMeas: snapshot?.tMeas ?? NaN, pressPa: snapshot?.pressPa ?? NaN, flowM3s: snapshot?.flowM3s ?? NaN, volM3: snapshot?.volM3 ?? NaN });
    }
  }
  const first = lines.find((l) => l.startsWith('RecordStart\t'))?.split('\t') ?? [];
  if (column >= 0 && units.length && first.length >= column + channels.length) Object.assign(events.find((e) => e.name === 'RecordStart')!, sample(first.slice(column, column + channels.length).map(num), channels, units));
  validate(samples);
  return { samples, events, channels, units };
}
export function parseRecBn1(bytes: Uint8Array, channels = CHANNELS): DfiSample[] {
  const width = 7 + channels.length * 4;
  if (!bytes.length || bytes.length % width) fail('invalidBinary', 'length');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out: DfiSample[] = [];
  for (let off = 0; off < bytes.length; off += width) {
    if (bytes[off + 4] !== channels.length) fail('invalidBinary', String(off));
    const checksum = bytes.subarray(off, off + width - 2).reduce((sum, byte) => sum + byte, 0) & 0xffff;
    if (view.getUint16(off + width - 2, true) !== checksum) fail('invalidBinary', `checksum ${off}`);
    const values = channels.map((_, i) => view.getFloat32(off + 5 + i * 4, true));
    if (!values.every(Number.isFinite)) fail('invalidBinary', String(off));
    out.push(sample(values, channels, channels.map((c) => SI[CHANNELS.indexOf(c)] ?? '')));
  }
  validate(out); return out;
}
function emptyMeta(fileName: string): DfiMeta {
  return { fileName, kind: 'unknown', softVersion: '', jobSite: '', contract: '', jobName: '', jobNumber: '', operator: '', groutName: '', recordStart: '', recordStop: '', phaseStart: '', phaseStop: '', pumpStart: '', pumpStop: '', measureStart: '', measureStop: '', setConsRaw: '', ginRaw: '', trig: '', trigStep: '', channels: [], units: [], params: {}, paramsRawXml: '', cfgRawXml: '', infoProc: '', infoVer: '', source: 'none' };
}
export async function parseDfiFile(file: File): Promise<DfiRecord> {
  if (file.size > 100 * 1024 * 1024) fail('fileTooLarge');
  const buf = await file.arrayBuffer(), bytes = new Uint8Array(buf);
  const isTar = bytes.length >= 512 && field(bytes.subarray(257, 263)).startsWith('ustar');
  const entries = isTar ? parseTar(buf) : new Map<string, Uint8Array>();
  let parsed: ReturnType<typeof parseRecTxt> | undefined;
  if (!isTar) {
    const text = decode(bytes);
    if (!text.includes('RecordStart\t') || !text.toUpperCase().includes('000D0080')) fail('unrecognizedFile');
    parsed = parseRecTxt(text);
  }
  const get = (name: string) => {
    const matches = [...entries.keys()].filter((k) => k.split('/').pop()!.toUpperCase() === name);
    if (matches.length > 1) fail('multipleRecords', name);
    return matches.length ? entries.get(matches[0]) : undefined;
  };
  const xml = (name: string) => { const b = get(name); return b ? decode(b) : ''; };
  const meta = emptyMeta(file.name), warnings: string[] = [], bn = get('REC.BN1'), txt = get('REC.TXT'), recXml = xml('REC.XML');
  if (!bn && !txt && !parsed && [...entries.keys()].some((k) => /(?:UPDATE\.XML|\.HEX)$/i.test(k))) {
    meta.kind = 'DMJ-update'; meta.paramsRawXml = xml('UPDATE.XML'); meta.params = params(xml('PARAMS.XML') || xml('PARAM.XML'));
    return { meta, samples: [], events: [], warnings: ['dmjWarn'] };
  }
  if (txt) parsed = parseRecTxt(decode(txt));
  const attrs = tags(recXml, 'Rec')[0] ?? {};
  const declared = (attrs.mes ?? '').split(';').filter(Boolean).map((c) => c.toUpperCase());
  const channels = declared.length ? declared : parsed?.channels ?? [];
  if (!channels.length || CHANNELS.some((c) => !channels.includes(c))) fail('unsupportedChannels');
  let samples = parsed?.samples ?? [], events = parsed?.events ?? [];
  if (bn) {
    if (channels.length !== 5) fail('unsupportedChannels', 'REC.BN1');
    const binary = parseRecBn1(bn, channels);
    if (parsed && samples.length !== binary.length) fail('sourceMismatch', 'count');
    if (parsed) for (let i = 0; i < samples.length; i++) for (const key of ['tTotal', 'tMeas', 'pressPa', 'flowM3s', 'volM3'] as const) {
      if (Math.abs(samples[i][key] - binary[i][key]) > 1.01e-6 + Math.abs(binary[i][key]) * 1e-12) fail('sourceMismatch', `${i + 1}: ${key}`);
    }
    samples = binary; meta.source = 'binary'; if (!txt) warnings.push('binarySource');
  } else { meta.source = 'text'; warnings.push('textSource'); }
  const xmlEvents = tags(recXml, 'Event');
  if (xmlEvents.length) {
    const indexed = xmlEvents.map((e): DfiEvent => {
      let snapshot: DfiSample | DfiEvent | undefined;
      if (bn) {
        if (!/^\d+$/.test(e.pos ?? '')) fail('invalidXml', 'Event.pos');
        const pos = Number(e.pos), width = 7 + channels.length * 4;
        if (pos % width || pos / width >= samples.length) fail('invalidXml', 'Event.pos');
        snapshot = samples[pos / width];
      } else snapshot = events.find((v) => v.name === e.name && v.date === e.date);
      return { name: e.name ?? '', date: e.date ?? '', data: e.data ?? '', tTotal: snapshot?.tTotal ?? NaN, tMeas: snapshot?.tMeas ?? NaN,
        pressPa: snapshot?.pressPa ?? NaN, flowM3s: snapshot?.flowM3s ?? NaN, volM3: snapshot?.volM3 ?? NaN };
    });
    events = [...events.filter((v) => !indexed.some((e) => e.name === v.name && e.date === v.date)), ...indexed];
  }
  const configs = Object.fromEntries(events.filter((e) => !e.date).map((e) => [e.name, e.data]));
  for (const c of tags(recXml, 'Config')) configs[c.name] = c.data ?? '';
  meta.kind = isTar ? 'DFI-measurement' : 'REC.TXT'; meta.channels = channels;
  meta.units = bn ? channels.map((c) => SI[CHANNELS.indexOf(c)]) : parsed?.units ?? [];
  meta.trig = attrs.trig ?? ''; meta.trigStep = attrs.trigstep ?? '';
  meta.paramsRawXml = xml('PARAMS.XML') || xml('PARAM.XML'); meta.params = params(meta.paramsRawXml); meta.cfgRawXml = xml('CFG.XML');
  meta.softVersion = configs.SoftVersion ?? ''; meta.jobSite = (configs.JobSite || meta.params.N_S || '').trim();
  meta.jobName = (configs.JobName || meta.params.N_I || '').trim(); meta.contract = (configs.Contract ?? '').trim();
  meta.jobNumber = (configs.JobNumber ?? '').trim(); meta.operator = (configs.Operator || meta.params.N_O || '').trim();
  meta.groutName = (configs['Grout Name'] || configs.GroutName || '').trim();
  const first = (n: string) => events.find((e) => e.name === n), last = (n: string) => events.findLast((e) => e.name === n);
  meta.recordStart = first('RecordStart')?.date ?? ''; meta.recordStop = last('RecordStop')?.date ?? '';
  meta.phaseStart = first('PhaseStart')?.date ?? ''; meta.phaseStop = last('PhaseStop')?.date ?? '';
  meta.pumpStart = first('PumpStart')?.date ?? ''; meta.pumpStop = last('PumpStop')?.date ?? '';
  meta.measureStart = first('MeasureDStart')?.date ?? ''; meta.measureStop = last('MeasureDStop')?.date ?? '';
  meta.setConsRaw = last('SetCons')?.data ?? ''; meta.ginRaw = last('Gin')?.data ?? '';
  const info = tags(xml('INFO.XML'), 'Proc')[0] ?? {}; meta.infoProc = info.Txt ?? ''; meta.infoVer = info.Ver ?? '';
  if (!samples.length) warnings.push('noData');
  if (samples.length && !first('MeasureDStart')) warnings.push('missingWindows');
  if (first('MeasureDStart') && !last('MeasureDStop')) warnings.push('incompleteRecord');
  if (events.filter((e) => e.name === 'SetCons').length > 1) warnings.push('changedSetpoints');
  if (bn && !xmlEvents.length && events.length) warnings.push('textEvents');
  return { meta, samples, events, warnings };
}

export interface MeasureWindow { start: DfiEvent; stop: DfiEvent }
export function measurementWindows(rec: DfiRecord): MeasureWindow[] {
  const out: MeasureWindow[] = []; let start: DfiEvent | undefined;
  for (const e of rec.events) {
    if (e.name === 'MeasureDStart') { if (start) fail('invalidWindows'); start = e; }
    if (e.name === 'MeasureDStop') {
      if (!start || !Number.isFinite(start.tMeas) || !Number.isFinite(e.tMeas) || e.tTotal < start.tTotal || e.tMeas < start.tMeas) fail('invalidWindows');
      out.push({ start, stop: e }); start = undefined;
    }
  }
  if (start) fail('incompleteRecord');
  return out;
}
export interface DfiStats {
  n: number; durationTotal: number; durationMeasure: number; maxPressBar: number; maxPressPa: number;
  maxFlowLmin: number; totalVolL: number; totalVolM3: number; avgFlowLmin: number; endPressureBar: number;
}
export interface ExtStats extends DfiStats {
  avgPressBar: number; endPressBar: number; endFlowLmin: number; p30Bar: number; q30Lmin: number;
  phases: number; reprises: number; stopType: string; ginEnd: number;
  reportedEndPressBar: number | null; reportedEndFlowLmin: number | null; reportedEndVolL: number | null;
}
function integral(points: Array<Pick<DfiSample, 'tMeas' | 'pressPa' | 'flowM3s'>>, from: number, to: number, key: 'pressPa' | 'flowM3s'): [number, number] {
  let sum = 0, duration = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]; if (b.tMeas <= a.tMeas) continue;
    const l = Math.max(from, a.tMeas), r = Math.min(to, b.tMeas); if (r <= l) continue;
    const at = (t: number) => a[key] + (b[key] - a[key]) * (t - a.tMeas) / (b.tMeas - a.tMeas);
    sum += (at(l) + at(r)) / 2 * (r - l); duration += r - l;
  }
  return [sum, duration];
}
export function computeExtStats(rec: DfiRecord): ExtStats {
  const s = rec.samples, windows = measurementWindows(rec), last = s.at(-1), end = windows.at(-1)?.stop ?? last;
  const volume = end?.volM3 ?? 0;
  const duration = windows.length ? windows.reduce((n, w) => n + w.stop.tMeas - w.start.tMeas, 0) : last?.tMeas ?? 0;
  const segments = windows.length ? windows.map((w) => ({ from: w.start.tMeas, to: w.stop.tMeas,
    points: [w.start, ...s.filter((p) => p.tTotal > w.start.tTotal && p.tTotal < w.stop.tTotal), w.stop] })) : [{ from: 0, to: last?.tMeas ?? 0, points: s }];
  let pi = 0, pd = 0, p30 = 0, q30 = 0, d30 = 0;
  for (const w of segments) {
    const [p, d] = integral(w.points, w.from, w.to, 'pressPa'); pi += p; pd += d;
    const from = Math.max((end?.tMeas ?? 0) - 30, w.from);
    const [p3, d3] = integral(w.points, from, w.to, 'pressPa'), [q3] = integral(w.points, from, w.to, 'flowM3s');
    p30 += p3; q30 += q3; d30 += d3;
  }
  let maxP = -Infinity, maxQ = -Infinity;
  for (const p of s) { maxP = Math.max(maxP, p.pressPa); maxQ = Math.max(maxQ, p.flowLmin); }
  const reported = (rec.events.findLast((e) => e.name === 'PumpStop')?.data ?? '').split(';').map(num);
  const phases = rec.events.filter((e) => e.name === 'MeasureDStart').length, endP = (end?.pressPa ?? 0) / 1e5;
  return { n: s.length, durationTotal: last?.tTotal ?? 0, durationMeasure: duration, maxPressPa: s.length ? maxP : 0,
    maxPressBar: s.length ? maxP / 1e5 : 0, maxFlowLmin: s.length ? maxQ : 0, totalVolM3: volume, totalVolL: volume * 1000,
    avgFlowLmin: duration > 0 ? volume * 60000 / duration : 0, endPressureBar: endP, endPressBar: endP,
    endFlowLmin: (end?.flowM3s ?? 0) * 60000, avgPressBar: pd > 0 ? pi / pd / 1e5 : NaN,
    p30Bar: d30 > 0 ? p30 / d30 / 1e5 : NaN, q30Lmin: d30 > 0 ? q30 / d30 * 60000 : NaN,
    phases, reprises: Math.max(0, phases - 1), stopType: rec.events.findLast((e) => e.name === 'SetStop')?.data ?? '', ginEnd: endP * volume * 1000,
    reportedEndPressBar: reported.length >= 3 && Number.isFinite(reported[0]) ? reported[0] / 1e5 : null,
    reportedEndFlowLmin: reported.length >= 3 && Number.isFinite(reported[1]) ? reported[1] * 60000 : null,
    reportedEndVolL: reported.length >= 3 && Number.isFinite(reported[2]) ? reported[2] * 1000 : null };
}
export function computeStats(rec: DfiRecord): DfiStats { return computeExtStats(rec); }
/** UI preview only. PDF and CSV use every sample. */
export function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  if (max < 2) return arr.length ? [arr[0]] : [];
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * (arr.length - 1) / (max - 1))]);
}
export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return '-'; const n = Math.floor(Math.max(0, s));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map((v) => String(v).padStart(2, '0')).join(':');
}
export interface Consignes { pressureLimitBar: number | null; volumeLimitL: number | null; safetyPressureBar: number | null; raw: string }
export function parseConsignes(raw: string): Consignes {
  const p = raw.split(';').map(num), valid = (v: number) => Number.isFinite(v) && v >= 0 ? v : null;
  return { pressureLimitBar: valid(p[0] / 1e5), volumeLimitL: valid(p[2] * 1000), safetyPressureBar: valid(p[3] / 1e5), raw };
}
export function parseSetpointBar(raw: string) { return parseConsignes(raw).pressureLimitBar; }
export function sanitizeStem(s: string): string { return s.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 80) || 'record'; }
export function csvText(rec: DfiRecord): string {
  const extras = rec.meta.channels.filter((c) => !CHANNELS.includes(c));
  const rows = [['t_total_s', 't_meas_s', 'press_Pa', 'press_bar', 'flow_m3s', 'flow_lmin', 'vol_m3', 'vol_l', ...extras].join(';')];
  for (const s of rec.samples) rows.push([s.tTotal, s.tMeas, s.pressPa, s.pressBar, s.flowM3s, s.flowLmin, s.volM3, s.volL, ...extras.map((c) => s.values?.[c] ?? '')].join(';'));
  return '\ufeff' + rows.join('\r\n');
}
