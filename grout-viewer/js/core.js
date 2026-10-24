/* Core: file parsing and statistics. Pure JavaScript, no dependencies, no network.
 *
 * File format (verified against fixtures and the original import module):
 *   .DFI  = ustar tar archive holding  <name>/REC.BN1  REC.TXT  REC.XML  PROC/{CFG,PARAMS,INFO,CONS}.XML
 *   REC.BN1 record = int32 trigger | uint8 channelCount | float32 x channelCount | uint16 additive checksum
 *   Units in the file are SI: Pa, m3/s, m3, s. The viewer shows bar, l/min, litres.
 */
(function (G) {
  'use strict';

  const CH = { TT: '000D0080', TM: '000F0080', P: '93000780', Q: '93000540', V: '93000500' };
  const REQUIRED = [CH.TT, CH.TM, CH.P, CH.Q, CH.V];
  const SI_UNITS = ['s', 's', 'Pa', 'm3/s', 'm3'];
  const MAX_BYTES = 200 * 1024 * 1024;

  class GVError extends Error {
    constructor(code, detail) { super(code + (detail ? ' (' + detail + ')' : '')); this.code = code; this.detail = detail || ''; }
  }
  const fail = (code, detail) => { throw new GVError(code, detail); };

  /* ---------- text helpers ---------- */
  function decode(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  }
  const cstr = (b) => decode(b).split('\0')[0].trim();

  function parseNumber(s) {
    s = String(s == null ? '' : s).trim();
    return /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(s) ? Number(s.replace(',', '.')) : NaN;
  }

  /* ---------- tar ---------- */
  function parseTar(bytes) {
    const out = new Map();
    let off = 0;
    while (off + 512 <= bytes.length) {
      const h = bytes.subarray(off, off + 512);
      if (h.every((v) => v === 0)) break;
      if (!cstr(h.subarray(257, 263)).startsWith('ustar')) fail('invalidArchive', 'header');
      const sizeTxt = cstr(h.subarray(124, 136)), sumTxt = cstr(h.subarray(148, 156));
      if (!/^[0-7]+$/.test(sizeTxt) || !/^[0-7]+$/.test(sumTxt)) fail('invalidArchive', 'size');
      const size = parseInt(sizeTxt, 8), end = off + 512 + Math.ceil(size / 512) * 512;
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : h[i];
      if (sum !== parseInt(sumTxt, 8)) fail('invalidArchive', 'checksum');
      if (off + 512 + size > bytes.length) fail('invalidArchive', 'truncated');
      const name = [cstr(h.subarray(345, 500)), cstr(h.subarray(0, 100))].filter(Boolean).join('/').replace(/\\/g, '/');
      const type = h[156];
      if (type === 0 || type === 48) out.set(name, bytes.slice(off + 512, off + 512 + size));
      else if (type !== 53) fail('unsupportedArchive', name);
      off = end;
    }
    if (!out.size) fail('invalidArchive', 'empty');
    return out;
  }

  /* ---------- XML ---------- */
  /* Minimal reader for the device's attribute-only XML. Returns a flat list of elements {tag, a}. */
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function unescapeXml(v) {
    return v.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e.charAt(0) === '#') {
        const n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!(n > 0 && n <= 0x10ffff) || (n >= 0xd800 && n <= 0xdfff)) fail('invalidXml');
        return String.fromCodePoint ? String.fromCodePoint(n) : String.fromCharCode(n);
      }
      return ENT[e.toLowerCase()];
    });
  }
  function xmlDoc(text) {
    text = String(text || '').replace(/^\ufeff/, '');
    if (!text.trim()) return null;
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('invalidXml');
    const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
    const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g, out = [], stack = [];
    let last = 0, m, roots = 0;
    while ((m = tag.exec(body))) {
      if (body.slice(last, m.index).indexOf('<') >= 0) fail('invalidXml');
      last = m.index + m[0].length;
      if (m[1]) { if (stack.pop() !== m[2] || m[4] || m[3].trim()) fail('invalidXml'); continue; }
      const a = {}; m[3].replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (x, k, d, q) => { if (/<|&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-f]+);)/i.test(d == null ? q : d)) fail('invalidXml'); a[k] = unescapeXml(d == null ? q : d); return ''; });
      if (!stack.length && ++roots > 1) fail('invalidXml');
      out.push({ tag: m[2], a });
      if (!m[4]) stack.push(m[2]);
    }
    if (stack.length || body.slice(last).indexOf('<') >= 0 || !out.length) fail('invalidXml');
    return out;
  }
  const tagList = (doc, name) => (doc ? doc.filter((e) => e.tag === name).map((e) => e.a) : []);
  function paramMap(doc) {
    const o = {};
    if (doc) doc.forEach((e) => { if (/^Param[LDS]$/.test(e.tag)) Object.assign(o, e.a); });
    return o;
  }

  /* ---------- samples ---------- */
  const FACTORS = [
    { s: 1, sec: 1, min: 60 }, { s: 1, sec: 1, min: 60 },
    { pa: 1, kpa: 1e3, mpa: 1e6, bar: 1e5 },
    { 'm3/s': 1, 'm3/min': 1 / 60, 'l/min': 1 / 60000, 'l/s': 0.001 },
    { m3: 1, l: 0.001 },
  ];
  function makeSample(values, channels, units) {
    const si = REQUIRED.map((c, i) => {
      const j = channels.indexOf(c);
      if (j < 0 || !Number.isFinite(values[j])) fail('invalidSamples', c);
      const u = String(units[j] || '').replace(/³/g, '3').replace(/\s/g, '').toLowerCase();
      if (FACTORS[i][u] === undefined) fail('unsupportedUnits', c + ': ' + u);
      return values[j] * FACTORS[i][u];
    });
    const [tt, tm, p, q, v] = si;
    if (tt < 0 || tm < 0 || v < 0) fail('invalidSamples');
    const extra = {};
    channels.forEach((c, i) => { if (!REQUIRED.includes(c)) extra[c] = values[i]; });
    return { tt, tm, p, q, v, pBar: p / 1e5, qLmin: q * 60000, vL: v * 1000, extra };
  }
  function validateOrder(s) {
    for (let i = 1; i < s.length; i++) {
      if (s[i].tt < s[i - 1].tt || s[i].tm < s[i - 1].tm || s[i].v + 1e-9 < s[i - 1].v) fail('resetCounters', 'row ' + (i + 1));
    }
  }

  function parseRecTxt(text) {
    const samples = [], events = [];
    let channels = [], units = [], col = -1;
    const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = lines[i].split('\t').map((c) => c.trim());
      if (!cells[0]) {
        const start = cells.findIndex(Boolean);
        if (start < 0) continue;
        if (/^[\da-f]{8}$/i.test(cells[start]) && cells.some((c) => c.toUpperCase() === CH.TT)) {
          channels = cells.slice(start).filter(Boolean).map((c) => c.toUpperCase());
          col = start; units = [];
          if (new Set(channels).size !== channels.length || REQUIRED.some((c) => !channels.includes(c))) fail('unsupportedChannels');
          continue;
        }
        if (col < 0) fail('unsupportedChannels');
        if (!units.length) { units = cells.slice(col, col + channels.length); continue; }
        const vals = cells.slice(col, col + channels.length).map(parseNumber);
        if (vals.length !== channels.length || !vals.every(Number.isFinite)) fail('invalidSamples', 'REC.TXT line ' + (i + 1));
        samples.push(makeSample(vals, channels, units));
      } else {
        events.push({
          name: cells[0], data: cells[1] || '', idx: samples.length,
          date: /^\d{4}-\d{2}-\d{2}T/.test(cells[2] || '') ? cells[2] : '',
        });
      }
    }
    validateOrder(samples);
    return { samples, events, channels, units };
  }

  function parseBn1(bytes, channels) {
    const width = 7 + channels.length * 4;
    if (!bytes.length || bytes.length % width) fail('invalidBinary', 'length');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
    const units = channels.map((c) => { const k = REQUIRED.indexOf(c); return k >= 0 ? SI_UNITS[k] : ''; });
    for (let off = 0; off < bytes.length; off += width) {
      if (bytes[off + 4] !== channels.length) fail('invalidBinary', 'record at byte ' + off);
      let sum = 0;
      for (let i = off; i < off + width - 2; i++) sum += bytes[i];
      if (view.getUint16(off + width - 2, true) !== (sum & 0xffff)) fail('invalidBinary', 'checksum at byte ' + off);
      const vals = channels.map((_, i) => view.getFloat32(off + 5 + i * 4, true));
      if (!vals.every(Number.isFinite)) fail('invalidBinary', 'value at byte ' + off);
      out.push(makeSample(vals, channels, units));
    }
    validateOrder(out);
    return { samples: out, width };
  }

  /* ---------- whole file ---------- */
  function parseBuffer(name, buffer) {
    if (buffer.byteLength > MAX_BYTES) fail('fileTooLarge');
    const bytes = new Uint8Array(buffer);
    const isTar = bytes.length >= 512 && cstr(bytes.subarray(257, 263)).startsWith('ustar');
    const entries = isTar ? parseTar(bytes) : new Map();
    let parsedTxt = null;
    if (!isTar) {
      const t = decode(bytes);
      if (!t.includes('RecordStart\t') || !t.toUpperCase().includes(CH.TT)) fail('unrecognizedFile');
      parsedTxt = parseRecTxt(t);
    }
    const find = (n) => {
      const hits = [...entries.keys()].filter((k) => k.split('/').pop().toUpperCase() === n);
      if (hits.length > 1) fail('multipleRecords', n);
      return hits.length ? entries.get(hits[0]) : undefined;
    };
    const xmlText = (n) => { const b = find(n); return b ? decode(b) : ''; };

    const meta = {
      fileName: name, kind: 'unknown', source: 'none', softVersion: '', jobSite: '', contract: '', jobName: '', jobNumber: '',
      operator: '', groutName: '', params: {}, setConsRaw: '', ginRaw: '', trig: '', trigStep: NaN, channels: [], units: [],
      infoProc: '', topDepth: '', bottomDepth: '', stageNumber: '', headLoss: '', fan: '', method: '', size: buffer.byteLength,
    };
    const rec = { meta, samples: [], events: [], warnings: [], id: Math.random().toString(36).slice(2) };

    const bn = find('REC.BN1'), txt = find('REC.TXT');
    if (!bn && !txt && !parsedTxt && [...entries.keys()].some((k) => /(?:UPDATE\.XML|\.HEX|UPDATE\.BIN)$/i.test(k))) {
      meta.kind = 'update';
      meta.params = paramMap(xmlDoc(xmlText('PARAM.XML') || xmlText('PARAMS.XML')));
      rec.warnings.push('updatePack');
      return rec;
    }
    if (txt) parsedTxt = parseRecTxt(decode(txt));
    const recDoc = xmlDoc(xmlText('REC.XML'));
    const recAttr = tagList(recDoc, 'Rec')[0] || {};
    const declared = (recAttr.mes || '').split(';').filter(Boolean).map((c) => c.toUpperCase());
    const channels = declared.length ? declared : (parsedTxt ? parsedTxt.channels : []);
    if (!channels.length || REQUIRED.some((c) => !channels.includes(c))) fail('unsupportedChannels');

    let samples = parsedTxt ? parsedTxt.samples : [], width = 0;
    if (bn) {
      const bin = parseBn1(bn, channels);
      if (parsedTxt) {
        if (parsedTxt.samples.length !== bin.samples.length) fail('sourceMismatch', 'sample count');
        /* the text record is rounded; allow only rounding-sized differences (SI units) */
        parsedTxt.samples.forEach((s, i) => {
          for (const k of ['tt', 'tm', 'p', 'q', 'v']) {
            if (Math.abs(s[k] - bin.samples[i][k]) > 1.01e-6 + Math.abs(bin.samples[i][k]) * 1e-6) fail('sourceMismatch', 'row ' + (i + 1) + ' ' + k);
          }
        });
      }
      samples = bin.samples; width = bin.width; meta.source = 'binary';
    } else { meta.source = 'text'; rec.warnings.push('textSource'); }

    /* events: XML positions are byte offsets into REC.BN1 */
    let events = parsedTxt ? parsedTxt.events : [];
    const xmlEvents = tagList(recDoc, 'Event');
    if (xmlEvents.length && bn) {
      events = xmlEvents.map((e) => {
        const pos = Number(e.pos);
        if (!Number.isInteger(pos) || pos % width || pos / width >= samples.length) fail('invalidXml', 'Event.pos');
        return { name: e.name || '', data: e.data || '', date: e.date || '', idx: pos / width, ref: Number(e.ref) };
      });
    }
    const configs = {};
    events.filter((e) => !e.date).forEach((e) => { configs[e.name] = e.data; });
    tagList(recDoc, 'Config').forEach((c) => { configs[c.name] = c.data || ''; });

    meta.kind = isTar ? 'dfi' : 'text';
    meta.channels = channels; meta.units = channels.map((c) => { const k = REQUIRED.indexOf(c); return k >= 0 ? SI_UNITS[k] : ''; });
    meta.trig = recAttr.trig || ''; meta.trigStep = parseNumber(recAttr.trigstep);
    meta.params = paramMap(xmlDoc(xmlText('PARAMS.XML') || xmlText('PARAM.XML')));
    meta.softVersion = configs.SoftVersion || '';
    const t = (v) => String(v || '').trim();
    meta.jobSite = t(configs.JobSite || meta.params.N_S); meta.jobName = t(configs.JobName || meta.params.N_I);
    meta.contract = t(configs.Contract || meta.params.M_T); meta.jobNumber = t(configs.JobNumber);
    const cfg = (k) => { for (const key in configs) if (key.toLowerCase() === k) return String(configs[key] || '').trim(); return ''; };
    meta.topDepth = cfg('top depth'); meta.bottomDepth = cfg('bottom depth'); meta.stageNumber = cfg('stagenumber'); meta.headLoss = cfg('headloss'); meta.fan = cfg('fan'); meta.method = cfg('method');
    meta.operator = t(configs.Operator || meta.params.N_O); meta.groutName = t(configs['Grout Name'] || configs.GroutName || meta.params.CL);
    meta.company = t(meta.params.N_E);
    const lastOf = (n) => { for (let i = events.length - 1; i >= 0; i--) if (events[i].name === n) return events[i]; };
    meta.setConsRaw = (lastOf('SetCons') || {}).data || ''; meta.ginRaw = (lastOf('Gin') || {}).data || '';
    meta.infoProc = (tagList(xmlDoc(xmlText('INFO.XML')), 'Proc')[0] || {}).Txt || '';

    rec.samples = samples; rec.events = events;
    const starts = events.filter((e) => e.name === 'MeasureDStart').length, stops = events.filter((e) => e.name === 'MeasureDStop').length;
    if (!samples.length) rec.warnings.push('noData');
    else if (!starts) rec.warnings.push('missingWindows');
    if (starts !== stops) rec.warnings.push('incompleteRecord');
    return rec;
  }

  /* ---------- derived data ---------- */
  function windows(rec) {
    const out = [], n = rec.samples.length; let start = null;
    if (!n) return out;
    const clamp = (i) => Math.min(n - 1, Math.max(0, i | 0)); // event positions may point just past the last sample
    for (const e of rec.events) {
      if (e.name === 'MeasureDStart') start = e;
      else if (e.name === 'MeasureDStop' && start) { out.push({ a: clamp(start.idx), b: Math.max(clamp(start.idx), clamp(e.idx)), start, stop: e }); start = null; }
    }
    return out;
  }
  function setpoints(raw) {
    const p = String(raw || '').split(';').map(parseNumber), ok = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
    return { pressureLimitBar: ok(p[0] / 1e5), volumeLimitL: ok(p[2] * 1000), safetyBar: ok(p[3] / 1e5), raw: raw || '' };
  }
  function pumpStopValues(rec) {
    for (let i = rec.events.length - 1; i >= 0; i--) {
      if (rec.events[i].name !== 'PumpStop') continue;
      const v = rec.events[i].data.split(';').map(parseNumber);
      if (v.length >= 3 && v.every(Number.isFinite)) return { pBar: Math.max(0, v[0] / 1e5), qLmin: Math.max(0, v[1] * 60000), vL: Math.max(0, v[2] * 1000) };
    }
    return null;
  }
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  const maxOf = (a, fb) => { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m === -Infinity ? (fb == null ? 0 : fb) : m; };
  const minOf = (a, fb) => { let m = Infinity; for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m === Infinity ? (fb == null ? 0 : fb) : m; };
  /* Whole-second difference of two timestamps (the original software subtracts the displayed hh:mm:ss values). */
  const dateSeconds = (a, b) => { const d = Math.floor(new Date(b).getTime() / 1000) - Math.floor(new Date(a).getTime() / 1000); return Number.isFinite(d) ? d : NaN; };
  const fmtHMS = (s) => {
    if (!Number.isFinite(s)) return '-'; const n = Math.floor(Math.max(0, s));
    return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map((v) => String(v).padStart(2, '0')).join(':');
  };

  /* Trapezoid integral of key over [from,to] on the measurement clock. */
  function integrate(points, from, to, key) {
    let sum = 0, dur = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]; if (b.tm <= a.tm) continue;
      const l = Math.max(from, a.tm), r = Math.min(to, b.tm); if (r <= l) continue;
      const at = (t) => a[key] + (b[key] - a[key]) * (t - a.tm) / (b.tm - a.tm);
      sum += (at(l) + at(r)) / 2 * (r - l); dur += r - l;
    }
    return [sum, dur];
  }

  /* method 'original': formulas of the original import module (sample mean, last-N-samples, PumpStop end values).
   * method 'weighted': time-weighted means inside the recorded measurement windows. */
  function stats(rec, method) {
    method = method || 'original';
    const s = rec.samples, N = s.length, w = windows(rec), last = s[N - 1];
    const R = { method, n: N, ok: N > 0 };
    if (!N) return R;
    R.maxP = maxOf(s.map((x) => x.pBar)); R.maxQ = maxOf(s.map((x) => x.qLmin));
    R.vMeasured = s[Math.min(N - 1, w.length ? w[w.length - 1].b : N - 1)].vL;
    let dur = 0; for (let i = 1; i < N; i++) dur += Math.max(s[i].tm - s[i - 1].tm, 0);
    R.durMeas = dur;
    const rs = rec.events.find((e) => e.name === 'RecordStart'), re = [...rec.events].reverse().find((e) => e.name === 'RecordStop');
    const dTot = rs && re ? dateSeconds(rs.date, re.date) : NaN;
    R.durTotal = Number.isFinite(dTot) ? dTot : last.tt;
    R.stopType = ([...rec.events].reverse().find((e) => e.name === 'SetStop') || {}).data || '';
    R.reprises = Math.max(0, w.length - 1);
    const rep = pumpStopValues(rec); R.reported = rep;
    const stopSnap = w.length ? s[w[w.length - 1].b] : last;

    if (method === 'weighted' && w.length) {
      let pI = 0, pD = 0, p30 = 0, q30 = 0, d30 = 0, act = 0;
      const endTm = stopSnap.tm;
      w.forEach((win) => {
        const pts = s.slice(win.a, win.b + 1), from = pts[0].tm, to = pts[pts.length - 1].tm; act += to - from;
        const [a, b] = integrate(pts, from, to, 'p'); pI += a; pD += b;
        const f30 = Math.max(endTm - 30, from);
        const [a3, b3] = integrate(pts, f30, to, 'p'), [q3] = integrate(pts, f30, to, 'q'); p30 += a3; q30 += q3; d30 += b3;
      });
      R.avgP = pD > 0 ? pI / pD / 1e5 : NaN; R.p30 = d30 > 0 ? p30 / d30 / 1e5 : NaN; R.q30 = d30 > 0 ? q30 / d30 * 60000 : NaN;
      R.durMeas = act; R.endP = stopSnap.pBar; R.endQ = stopSnap.qLmin; R.vol = stopSnap.vL;
    } else {
      const step = rec.meta.trigStep > 0 ? rec.meta.trigStep : 1, n30 = Math.max(1, Math.trunc(30 / step));
      const tail = (key) => { let sum = 0; for (let k = 1; k <= n30; k++) if (N - k > 0) sum += s[N - k][key]; return sum / n30; };
      R.avgP = mean(s.map((x) => x.pBar)); R.p30 = tail('pBar'); R.q30 = tail('qLmin');
      R.endP = rep ? rep.pBar : stopSnap.pBar; R.endQ = rep ? rep.qLmin : stopSnap.qLmin; R.vol = rep ? rep.vL : R.vMeasured;
    }
    R.avgQ = R.durMeas > 0 ? R.vol / R.durMeas * 60 : NaN;
    R.gin = R.endP * R.vol;
    return R;
  }

  /* Header values after applying the user's edits to the file's own values. */
  function header(rec, ov) {
    ov = ov || {}; const m = rec.meta, pick = (k, d) => (ov[k] && ov[k].trim()) || d || '';
    return {
      company: pick('company', m.company), site: pick('site', m.jobSite), contract: pick('contract', m.contract),
      job: pick('job', m.jobName), operator: pick('operator', m.operator), pump: pick('pump', ''), grout: pick('grout', m.groutName),
      zone: pick('zone', ''), sleeve: pick('sleeve', m.stageNumber), top: pick('top', m.topDepth), bottom: pick('bottom', m.bottomDepth), fan: pick('fan', m.fan),
    };
  }

  /* Column set and decimal style of the original daily summary export (".TXT" / ".csv" of the bilan). */
  const BILAN_COLUMNS = ['Start_date', 'Borehole', 'Fan', 'Sleeve', 'Regrout', 'Grout', 'Zone', 'X_coord', 'Y_coord', 'Pump', 'Start_time', 'End_time',
    'Total_duration', 'Grouting_duration', 'Top_level', 'Bottom_level', 'Injected_volume', 'Average_pressure', '30s_pressure', 'End_pressure',
    'Average_flowrate', '30s_flowrate', 'End_flowrate', 'Stop_type', 'Dry_weights', 'Coeff_Headloss', 'Head_loss', 'Water_depth', 'Inclination'];
  function bilanRow(rec, st, hdr) {
    const rs = (rec.events.find((e) => e.name === 'RecordStart') || {}).date || '', re = ([...rec.events].reverse().find((e) => e.name === 'RecordStop') || {}).date || '';
    /* the original export prints at most d decimals with trailing zeros removed and a decimal comma */
    const r1 = (n, d) => (Number.isFinite(n) ? String(Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).replace('.', ',') : '');
    const row = {
      Start_date: rs.slice(0, 10), Borehole: hdr.job, Fan: '', Sleeve: hdr.sleeve, Regrout: '', Grout: hdr.grout, Zone: hdr.zone, X_coord: '', Y_coord: '',
      Pump: hdr.pump, Start_time: rs.slice(11, 19), End_time: re.slice(11, 19), Total_duration: fmtHMS(st.durTotal), Grouting_duration: fmtHMS(st.durMeas),
      Top_level: '', Bottom_level: '', Injected_volume: r1(st.vol, 0), Average_pressure: r1(st.avgP, 2), '30s_pressure': r1(st.p30, 2),
      End_pressure: r1(st.endP, 2), Average_flowrate: r1(st.avgQ, 2), '30s_flowrate': r1(st.q30, 2), End_flowrate: r1(st.endQ, 2),
      Stop_type: st.stopType, Dry_weights: '', Coeff_Headloss: '', Head_loss: '', Water_depth: '', Inclination: '',
    };
    return row;
  }

  function sanitizeStem(s) { return String(s).trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 80) || 'record'; }
  function csvEscape(v) { v = String(v == null ? '' : v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function samplesCsv(rec) {
    const extra = rec.meta.channels.filter((c) => !REQUIRED.includes(c));
    const rows = [['t_total_s', 't_meas_s', 'press_Pa', 'press_bar', 'flow_m3s', 'flow_lmin', 'vol_m3', 'vol_l', ...extra].join(';')];
    for (const s of rec.samples) rows.push([s.tt, s.tm, s.p, s.pBar, s.q, s.qLmin, s.v, s.vL, ...extra.map((c) => s.extra[c])].join(';'));
    return '﻿' + rows.join('\r\n');
  }
  function bilanCsv(items) {
    const rows = [BILAN_COLUMNS.join(';')];
    items.forEach((it) => rows.push(BILAN_COLUMNS.map((c) => csvEscape(bilanRow(it.rec, it.st, it.hdr)[c])).join(';')));
    return '﻿' + rows.join('\r\n');
  }

  function b64ToBuffer(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

  Object.assign(G, { CH, GVError, parseBuffer, parseTar, parseRecTxt, parseBn1, windows, setpoints, stats, header, bilanRow, BILAN_COLUMNS,
    sanitizeStem, samplesCsv, bilanCsv, fmtHMS, b64ToBuffer, parseNumber, mean, maxOf, minOf, xmlDoc });
})(window.G = window.G || {});
