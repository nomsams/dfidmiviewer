/* Report engine. Draws printable pages (millimetres) through the backends in draw.js.
 *   classic = the original printout structure: bilan table, centimetre-grid diagram with per-curve scales
 *             ("1 cm = ..."), site setpoints, observation frame, visa boxes, GIN curve, appendices.
 *   modern  = same data with KPI cards, soft grid and filled curves.
 * All page geometry of the classic sheet is in G.CLASSIC so it can be calibrated against a real printout.
 */
(function (G) {
  'use strict';
  const t = (k, a) => G.t(k, a);
  const A4 = { w: 210, h: 297 };

  /* Page geometry of the classic sheet (mm). Calibrate here if a reference printout differs. */
  G.CLASSIC = {
    margin: 10, titleH: 13, cell: 10, axisW: 11, gridMinor: '#cfcfcf', gridMajor: '#8c8c8c', frame: '#000',
    footerY: 291, visaH: 17, obsTitleH: 5,
  };

  G.defaultOptions = function () {
    return {
      layout: 'classic', method: 'original', lang: 'en',
      company: '', comment: '', timeBase: 'total',
      show: { bilan: true, setpoints: true, diagram: true, pressure: true, flow: true, volume: true, d: false, gin: false,
        ginPage: false, markers: true, commentCol: false, observations: true, visas: true, events: false, params: false, table: false, certificate: false },
      colors: { p: '#d62728', q: '#1f77b4', v: '#2a9d3a', d: '#8e44ad', g: '#222222' },
      mono: false,
      scales: { t: 0, p: 0, q: 0, v: 0, d: 0, g: 0 },
      obsHeight: 22, obsTitle: '', visaCount: 2, visaTitles: ['', '', ''],
      ginLimit: 0, summaryCols: null,
      mc: { sort: 'date', asc: true, daily: true, pMode: 'avg', qMode: 'avg', pMin: 0, pMax: 0, qMin: 0, qMax: 0, hMin: 0, hMax: 24, stop: '', pump: '', dateFrom: '', dateTo: '' },
      o: {
        reports: { time: true, pvg: false, pvf: false, hist: false, lug: false },
        axes: 'manual', // 'manual' = scales as entered (original defaults) | 'auto' = fitted to the data
        tcm: 60,
        p: { on: true, scale: 50, color: '#0000ff' }, q: { on: false, scale: 100, color: '#00ff00' }, v: { on: false, scale: 100, color: '#ff8000' },
        d: { on: false, scale: 50, color: '#804040' }, g: { on: false, scale: 100, color: '#000000' },
        smoothP: { on: false, s: 5 }, smoothQ: { on: false, s: 5 },
        title1: '', title2: '', boreholeLabel: '', appTag: 'DLGPVD  6.61', footerLeft: '...', footerText: 'JEAN LUTZ S.A - Jurançon - France - www.jeanlutzsa.fr',
        logo: '', logoW: 0, logoH: 0, density: 1000, angle: 0, waterDepth: 0, dec: '', pvgPen: true, pUnit: 'bar', decimals: 1,
        lug: { staticM: 0, lossBar: 0, lossLin: 0, lossQuad: 0, lengthM: 0, minStage: 30 },
        sel: { oneSleeve: false, cumRerun: false, sleeveInfo: true, limits: true, stopType: true, endTime: false, duration: false, groutType: true, totalVol: true, volLimit: true, avgPQ: false, finalP: false, eff: false },
      },
    };
  };

  /* ---------- helpers ---------- */
  const isNum = Number.isFinite;
  const fmt = (n, d) => (isNum(n) ? n.toFixed(d == null ? 2 : d) : '-');
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }
  const TSTEPS = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 900, 1200, 1800, 3600, 7200, 14400, 28800, 86400];
  const timeStep = (raw) => TSTEPS.find((x) => x >= raw) || niceStep(raw);
  const decimals = (step) => { for (let d = 0; d <= 3; d++) { const k = step * Math.pow(10, d); if (Math.abs(k - Math.round(k)) < 1e-9) return d; } return 3; };
  function ink(opt, c) { return opt.mono ? '#000000' : c; }

  function newPage(doc, w, h, label) { const p = doc.addPage(w, h); p.label = label || ''; return p; }

  /* Series available to the diagram, in left/right axis order. */
  function seriesDefs(opt) {
    const c = opt.colors, s = opt.show, out = [];
    if (s.pressure) out.push({ id: 'p', name: 'P', unit: 'bar', color: ink(opt, c.p), side: 'L', val: (x) => x.pBar });
    if (s.d) out.push({ id: 'd', name: 'D', unit: 'l/min/bar', color: ink(opt, c.d), side: 'L', val: (x) => (x.pBar > 0.05 ? x.qLmin / x.pBar : 0), dash: [1.2, 0.8] });
    if (s.flow) out.push({ id: 'q', name: 'Q', unit: 'l/min', color: ink(opt, c.q), side: 'R', val: (x) => x.qLmin, dash: opt.mono ? [2, 1] : null });
    if (s.volume) out.push({ id: 'v', name: 'V', unit: 'l', color: ink(opt, c.v), side: 'R', val: (x) => x.vL, dash: opt.mono ? [0.6, 0.9] : null });
    if (s.gin) out.push({ id: 'g', name: 'GIN', unit: 'bar·l', color: ink(opt, c.g), side: 'R', val: (x) => x.pBar * x.vL, dash: [3, 1.2] });
    return out;
  }
  const timeOf = (opt) => (opt.timeBase === 'meas' ? (x) => x.tm : (x) => x.tt);

  /* ---------- classic diagram (centimetre grid) ---------- */
  /* Returns number of strips needed when a manual time scale is smaller than the record. */
  function classicDiagram(P, box, item, opt, strip) {
    const C = G.CLASSIC, rec = item.rec, S = rec.samples, defs = seriesDefs(opt), tf = timeOf(opt);
    if (!S.length || !defs.length) return 1;
    const nL = Math.max(1, defs.filter((d) => d.side === 'L').length), nR = defs.filter((d) => d.side === 'R').length;
    const x0 = box.x + C.axisW * nL + 1.5, avail = box.w - C.axisW * (nL + nR) - 3;
    const plotW = Math.floor(avail / C.cell) * C.cell, y0 = box.y + 10;
    const plotH = Math.floor((box.h - 10 - 25) / C.cell) * C.cell, nX = plotW / C.cell, nY = plotH / C.cell;
    const tMax = Math.max(tf(S[S.length - 1]), 1);
    const unitT = opt.scales.t > 0 ? opt.scales.t : timeStep(tMax / nX);
    const useMin = unitT >= 60;
    const strips = Math.max(1, Math.ceil(tMax / (unitT * nX) - 1e-9));
    const tOff = (strip || 0) * unitT * nX;

    /* grid */
    for (let i = 0; i <= nX; i++) {
      const x = x0 + i * C.cell, major = i % 5 === 0;
      P.line(x, y0, x, y0 + plotH, { c: major ? C.gridMajor : C.gridMinor, w: major ? 0.18 : 0.1 });
    }
    for (let j = 0; j <= nY; j++) {
      const y = y0 + plotH - j * C.cell, major = j % 5 === 0;
      P.line(x0, y, x0 + plotW, y, { c: major ? C.gridMajor : C.gridMinor, w: major ? 0.18 : 0.1 });
    }
    P.rect(x0, y0, plotW, plotH, { stroke: C.frame, w: 0.35 });

    /* time axis */
    const dT = useMin ? unitT / 60 : unitT, tDec = decimals(dT);
    for (let i = 0; i <= nX; i += (nX > 18 ? 2 : 1)) {
      const v = (tOff + i * unitT) / (useMin ? 60 : 1);
      P.text(fmt(v, tDec), x0 + i * C.cell, y0 + plotH + 4, { size: 6, align: 'center' });
    }
    P.text(t('ax.time') + ' (' + (useMin ? 'min' : 's') + ')' + (opt.timeBase === 'meas' ? ' – ' + t('ax.meas') : ''), x0 + plotW / 2, y0 + plotH + 8.5, { size: 7, bold: true, align: 'center' });

    /* per-series axes and curves */
    let li = 0, ri = 0;
    const scales = {};
    for (const d of defs) {
      const vals = S.map(d.val), mx = G.maxOf(vals), mn = G.minOf(vals);
      const step = opt.scales[d.id] > 0 ? opt.scales[d.id] : niceStep((mx > 0 ? mx : 1) / nY);
      const lo = mn < 0 ? Math.floor(mn / step) * step : 0;
      scales[d.id] = { step, lo };
      const dec = decimals(step);
      const ax = d.side === 'L' ? x0 - 1.5 - li * C.axisW : x0 + plotW + 1.5 + ri * C.axisW;
      const al = d.side === 'L' ? 'right' : 'left';
      for (let j = 0; j <= nY; j += (nY > 14 ? 2 : 1)) P.text(fmt(lo + j * step, dec), ax, y0 + plotH - j * C.cell + 1.1, { size: 5.8, align: al, c: d.color });
      P.text(d.name, ax, y0 - 6.2, { size: 7.5, bold: true, align: al, c: d.color });
      P.text(d.unit, ax, y0 - 2.6, { size: 5.5, align: al, c: d.color });
      if (d.side === 'L') li++; else ri++;
    }
    const clip = { x: x0, y: y0, w: plotW, h: plotH };
    const X = (s) => x0 + (tf(s) - tOff) / (unitT * nX) * plotW;

    /* markers: measurement start / stop */
    if (opt.show.markers) {
      for (const e of rec.events) {
        if (e.name !== 'MeasureDStart' && e.name !== 'MeasureDStop') continue;
        const x = X(S[Math.min(e.idx, S.length - 1)]); if (x < x0 || x > x0 + plotW) continue;
        P.line(x, y0, x, y0 + plotH, { c: '#666', w: 0.15, dash: [0.8, 0.8] });
      }
    }
    /* site pressure setpoint */
    const sp = G.setpoints(rec.meta.setConsRaw);
    if (opt.show.setpoints && sp.pressureLimitBar != null && scales.p) {
      const y = y0 + plotH - (sp.pressureLimitBar - scales.p.lo) / (scales.p.step * nY) * plotH;
      if (y >= y0 && y <= y0 + plotH) {
        P.line(x0, y, x0 + plotW, y, { c: ink(opt, opt.colors.p), w: 0.2, dash: [3, 1.5] });
        P.text(t('set.pmax') + ' ' + fmt(sp.pressureLimitBar, 1) + ' bar', x0 + plotW - 1, y - 0.8, { size: 5.5, align: 'right', c: ink(opt, opt.colors.p) });
      }
    }
    /* curves */
    for (const d of defs) {
      const sc = scales[d.id];
      const pts = S.map((s) => [X(s), y0 + plotH - (d.val(s) - sc.lo) / (sc.step * nY) * plotH]);
      for (const seg of G.clipPoly(pts, clip)) P.poly(seg, { c: d.color, w: d.id === 'p' ? 0.45 : 0.38, dash: d.dash });
    }
    /* legend with scales: "1 cm = ..." */
    let lx = box.x + 2; const ly = y0 + plotH + 14.5;
    for (const d of defs) {
      const sc = scales[d.id], label = d.name + ' (' + d.unit + ')  1 cm = ' + fmt(sc.step, Math.max(decimals(sc.step), 0)), w = G.textWidth(label, 6.5) + 12;
      if (lx + w > box.x + box.w) { lx = box.x + 2; }
      P.line(lx, ly - 1, lx + 8, ly - 1, { c: d.color, w: 0.5, dash: d.dash });
      P.text(label, lx + 10, ly, { size: 6.5, c: d.color });
      lx += w + 2;
    }
    const tl = t('ax.time') + '  1 cm = ' + fmt(dT, decimals(dT)) + ' ' + (useMin ? 'min' : 's');
    P.text(tl, box.x + box.w - 1, ly + 4.2, { size: 6.5, align: 'right' });
    if (strips > 1) P.text(t('ax.strip', { n: (strip || 0) + 1, m: strips }), box.x + 2, ly + 4.2, { size: 6.5, italic: true });
    return strips;
  }

  /* ---------- GIN curve: pressure against volume with the P*V = GIN envelope ---------- */
  function ginDiagram(P, box, item, opt) {
    const C = G.CLASSIC, S = item.rec.samples; if (!S.length) return;
    const x0 = box.x + 14, y0 = box.y + 8, plotW = Math.floor((box.w - 22) / C.cell) * C.cell, plotH = Math.floor((box.h - 22) / C.cell) * C.cell;
    const nX = plotW / C.cell, nY = plotH / C.cell;
    const vMax = G.maxOf(S.map((s) => s.vL)), pMax = G.maxOf(S.map((s) => s.pBar));
    const gin = opt.ginLimit > 0 ? opt.ginLimit : (Number(item.rec.meta.params.S_G) === 1 ? Number(item.rec.meta.params.C_G) : 0);
    const sv = niceStep((vMax > 0 ? vMax : 1) / nX), sp = niceStep((pMax > 0 ? pMax : 1) / nY);
    for (let i = 0; i <= nX; i++) P.line(x0 + i * C.cell, y0, x0 + i * C.cell, y0 + plotH, { c: i % 5 ? C.gridMinor : C.gridMajor, w: i % 5 ? 0.1 : 0.18 });
    for (let j = 0; j <= nY; j++) P.line(x0, y0 + j * C.cell, x0 + plotW, y0 + j * C.cell, { c: j % 5 ? C.gridMinor : C.gridMajor, w: j % 5 ? 0.1 : 0.18 });
    P.rect(x0, y0, plotW, plotH, { stroke: C.frame, w: 0.35 });
    for (let i = 0; i <= nX; i += (nX > 18 ? 2 : 1)) P.text(fmt(i * sv, decimals(sv)), x0 + i * C.cell, y0 + plotH + 4, { size: 6, align: 'center' });
    for (let j = 0; j <= nY; j += (nY > 14 ? 2 : 1)) P.text(fmt(j * sp, decimals(sp)), x0 - 1.5, y0 + plotH - j * C.cell + 1.1, { size: 6, align: 'right' });
    P.text('P (bar)', x0 - 1.5, y0 - 3, { size: 7.5, bold: true, align: 'right' });
    P.text('V (l)', x0 + plotW / 2, y0 + plotH + 9, { size: 7.5, bold: true, align: 'center' });
    const clip = { x: x0, y: y0, w: plotW, h: plotH };
    const X = (v) => x0 + v / (sv * nX) * plotW, Y = (p) => y0 + plotH - p / (sp * nY) * plotH;
    if (gin > 0) { // envelope P * V = GIN
      const pts = []; for (let i = 1; i <= 200; i++) { const v = (sv * nX) * i / 200; pts.push([X(v), Y(gin / v)]); }
      for (const seg of G.clipPoly(pts, clip)) P.poly(seg, { c: '#555', w: 0.3, dash: [2.5, 1.2] });
      P.text('GIN = ' + fmt(gin, 0) + ' bar·l', x0 + plotW - 1, y0 + 4, { size: 6.5, align: 'right', c: '#444' });
    }
    const pts = S.map((s) => [X(s.vL), Y(s.pBar)]);
    for (const seg of G.clipPoly(pts, clip)) P.poly(seg, { c: ink(opt, opt.colors.p), w: 0.45 });
    P.text('1 cm = ' + fmt(sv, decimals(sv)) + ' l  ·  1 cm = ' + fmt(sp, decimals(sp)) + ' bar', box.x + box.w - 1, y0 + plotH + 14, { size: 6.5, align: 'right' });
  }

  /* ---------- flow layout with pagination ---------- */
  function Flow(doc, w, h, margin, label, head) {
    const f = {
      doc, w, h, m: margin, label, page: newPage(doc, w, h, label), y: margin, head,
      bottom() { return h - margin - 4; },
      ensure(need) { if (f.y + need > f.bottom()) { f.page = newPage(doc, w, h, label); f.y = margin; if (head) f.y = head(f.page, f); return true; } return false; },
    };
    if (head) f.y = head(f.page, f);
    return f;
  }

  function table(flow, spec, opt) {
    const modern = opt.layout === 'cards', size = spec.size || 7, rh = spec.rowH || 5.2, totalW = flow.w - flow.m * 2;
    const fixed = spec.cols.reduce((n, c) => n + (c.w || 0), 0), flex = spec.cols.reduce((n, c) => n + (c.w ? 0 : (c.flex || 1)), 0);
    const widths = spec.cols.map((c) => c.w || (totalW - fixed) * (c.flex || 1) / flex);
    const wrap = (text, w) => {
      const words = G.safe(text).split(' '), lines = []; let line = '';
      for (const wd of words) { const tryS = line ? line + ' ' + wd : wd; if (!line || G.textWidth(tryS, size, true) <= w) line = tryS; else { lines.push(line); line = wd; } }
      if (line) lines.push(line);
      return lines.slice(0, 3).map((l) => G.fit(l, w, size, true));
    };
    const headLines = spec.cols.map((c, i) => wrap(c.label, widths[i] - 2.4)), nLines = Math.max(1, ...headLines.map((l) => l.length));
    const headH = nLines * size * 0.4 + 2.2;
    const drawHead = () => {
      const P = flow.page; let x = flow.m;
      P.rect(x, flow.y, totalW, headH, { fill: modern ? '#1e293b' : '#e6e6e6', stroke: modern ? null : '#000', w: 0.2 });
      spec.cols.forEach((c, i) => {
        const tx = c.align === 'right' ? x + widths[i] - 1.2 : c.align === 'center' ? x + widths[i] / 2 : x + 1.2;
        headLines[i].forEach((ln, k) => P.text(ln, tx, flow.y + 3.3 + k * size * 0.4, { size, bold: true, align: c.align || 'left', c: modern ? '#fff' : '#000' }));
        if (!modern && i > 0) P.line(x, flow.y, x, flow.y + headH, { c: '#000', w: 0.15 });
        x += widths[i];
      });
      flow.y += headH;
    };
    flow.ensure(rh * 3); drawHead();
    spec.rows.forEach((row, ri) => {
      if (flow.ensure(rh)) drawHead();
      const P = flow.page; let x = flow.m;
      if (row && row.span !== undefined) { // subtotal line across the whole table
        P.rect(flow.m, flow.y, totalW, rh, { fill: modern ? '#e2e8f0' : '#ececec', stroke: modern ? null : '#777', w: 0.1 });
        P.text(G.fit(row.span, totalW - 2.4, size, true), flow.m + 1.2, flow.y + rh - 1.4, { size, bold: true, c: '#111' }); flow.y += rh; return;
      }
      if (modern && ri % 2) P.rect(x, flow.y, totalW, rh, { fill: '#f1f5f9' });
      spec.cols.forEach((c, i) => {
        const tx = c.align === 'right' ? x + widths[i] - 1.2 : c.align === 'center' ? x + widths[i] / 2 : x + 1.2;
        P.text(G.fit(row[i], widths[i] - 2.4, size), tx, flow.y + rh - 1.4, { size, align: c.align || 'left', c: '#111' });
        if (!modern && i > 0) P.line(x, flow.y, x, flow.y + rh, { c: '#777', w: 0.1 });
        x += widths[i];
      });
      if (!modern) P.line(flow.m, flow.y + rh, flow.m + totalW, flow.y + rh, { c: '#777', w: 0.1 });
      flow.y += rh;
    });
    if (!modern) flow.page.line(flow.m, flow.y, flow.m + totalW, flow.y, { c: '#000', w: 0.25 });
    flow.y += 3;
  }

  /* ---------- classic record sheet ---------- */
  function cellBox(P, x, y, w, h, label, value, o) {
    o = o || {};
    P.rect(x, y, w, h, { stroke: '#000', w: 0.2, fill: o.fill });
    P.text(G.fit(label, w - 2, 5.6), x + 1.2, y + 3, { size: 5.6, c: '#444' });
    P.text(G.fit(value, w - 2.4, o.size || 9, true), x + 1.2, y + h - 1.9, { size: o.size || 9, bold: true });
  }


  function recordSheet(doc, item, opt) {
    const C = G.CLASSIC, { rec, st, hdr } = item, m = C.margin, W = A4.w - 2 * m;
    const label = hdr.job || rec.meta.fileName;
    const P = newPage(doc, A4.w, A4.h, label);
    let y = m;

    /* title band */
    P.rect(m, y, W, C.titleH, { stroke: '#000', w: 0.4 });
    P.text(G.fit(hdr.company || opt.company || '', 60, 11, true), m + 3, y + 8.5, { size: 11, bold: true });
    P.text(t('rpt.title'), m + W / 2, y + 8.5, { size: 13, bold: true, align: 'center' });
    const rs = (rec.events.find((e) => e.name === 'RecordStart') || {}).date || '';
    P.text(rs.slice(0, 10), m + W - 3, y + 8.5, { size: 10, bold: true, align: 'right' });
    y += C.titleH + 2;

    /* identification */
    const re = ([...rec.events].reverse().find((e) => e.name === 'RecordStop') || {}).date || '';
    const col = W / 4, rowH = 10.5;
    const idRows = [
      [[t('f.site'), hdr.site], [t('f.contract'), hdr.contract], [t('f.borehole'), hdr.job], [t('f.date'), rs.slice(0, 10)]],
      [[t('f.operator'), hdr.operator], [t('f.pump'), hdr.pump], [t('f.grout'), hdr.grout], [t('f.zone'), hdr.zone]],
      [[t('f.start'), rs.slice(11, 19)], [t('f.end'), re.slice(11, 19)], [t('f.total'), G.fmtHMS(st.durTotal)], [t('f.grouting'), G.fmtHMS(st.durMeas)]],
    ];
    idRows.forEach((r) => { r.forEach((c, i) => cellBox(P, m + i * col, y, col, rowH, c[0], c[1] || '')); y += rowH; });
    y += 2.5;

    /* bilan: results table */
    if (opt.show.bilan && st.ok) {
      const cols = [
        [t('st.vol'), fmt(st.vol, 0), 'l'], [t('st.avgP'), fmt(st.avgP), 'bar'], [t('st.p30'), fmt(st.p30), 'bar'], [t('st.endP'), fmt(st.endP), 'bar'], [t('st.maxP'), fmt(st.maxP), 'bar'],
        [t('st.avgQ'), fmt(st.avgQ), 'l/min'], [t('st.q30'), fmt(st.q30), 'l/min'], [t('st.endQ'), fmt(st.endQ), 'l/min'], [t('st.maxQ'), fmt(st.maxQ), 'l/min'],
      ];
      const cw = W / 5;
      P.rect(m, y, W, 5.6, { fill: '#e6e6e6', stroke: '#000', w: 0.2 });
      P.text(t('st.title'), m + 2, y + 4, { size: 7.5, bold: true });
      P.text(t('st.restarts') + ': ' + st.reprises + '   ·   ' + t('st.gin') + ': ' + fmt(st.gin, 1) + ' bar·l   ·   ' + t('st.stop') + ': ' + (st.stopType || '-'), m + W - 2, y + 4, { size: 6.8, align: 'right' });
      y += 5.6;
      const rows = [cols.slice(0, 5), cols.slice(5)];
      rows.forEach((r) => {
        const w = W / r.length;
        r.forEach((c, i) => {
          P.rect(m + i * w, y, w, 11, { stroke: '#000', w: 0.2 });
          P.text(G.fit(c[0], w - 2, 5.6), m + i * w + 1.2, y + 3, { size: 5.6, c: '#444' });
          P.text(c[1], m + i * w + 1.5, y + 9, { size: 11, bold: true });
          P.text(c[2], m + (i + 1) * w - 1.5, y + 9, { size: 6.5, align: 'right', c: '#444' });
        });
        y += 11;
      });
      y += 2.5; void cw;
    }

    /* site setpoints */
    const sp = G.setpoints(rec.meta.setConsRaw);
    if (opt.show.setpoints) {
      const items = [[t('set.pmax'), fmt(sp.pressureLimitBar, 2) + ' bar'], [t('set.vmax'), fmt(sp.volumeLimitL, 0) + ' l'], [t('set.safety'), fmt(sp.safetyBar, 2) + ' bar']];
      items.forEach((c, i) => cellBox(P, m + i * (W / 3), y, W / 3, 9, c[0], c[1], { size: 8.5 }));
      y += 11.5;
    }

    /* reserve space for observations + visas */
    const obsH = opt.show.observations ? opt.obsHeight + C.obsTitleH + 2 : 0, visaH = opt.show.visas ? C.visaH + 2 : 0;
    const footer = 8, diagH = A4.h - m - footer - y - obsH - visaH;
    let strips = 1;
    if (opt.show.diagram && st.ok) {
      if (diagH > 70) strips = classicDiagram(P, { x: m, y, w: W, h: diagH }, item, opt, 0);
      else { // not enough room: the diagram goes to its own page
        const Q = newPage(doc, A4.w, A4.h, label);
        Q.text(label + ' – ' + t('rpt.title'), m, m + 5, { size: 10, bold: true });
        strips = classicDiagram(Q, { x: m, y: m + 10, w: W, h: A4.h - 2 * m - 25 }, item, opt, 0);
      }
    }
    y += diagH + 1;

    if (opt.show.observations) {
      P.rect(m, y, W, C.obsTitleH + opt.obsHeight, { stroke: '#000', w: 0.3 });
      P.rect(m, y, W, C.obsTitleH, { fill: '#e6e6e6', stroke: '#000', w: 0.2 });
      P.text(opt.obsTitle || t('obs.title'), m + 2, y + 3.7, { size: 7.5, bold: true });
      const note = item.comment || opt.comment;
      if (note) {
        const words = G.safe(note).split(' '); let line = '', ly = y + C.obsTitleH + 4;
        for (const w of words) {
          if (G.textWidth(line + ' ' + w, 8) > W - 5) { P.text(line, m + 2.5, ly, { size: 8 }); line = w; ly += 3.8; } else line = (line ? line + ' ' : '') + w;
        }
        if (line) P.text(line, m + 2.5, ly, { size: 8 });
      }
      y += C.obsTitleH + opt.obsHeight + 2;
    }
    if (opt.show.visas) {
      const n = Math.max(1, Math.min(3, opt.visaCount)), defaults = [t('visa.operator'), t('visa.client'), t('visa.date')], gap = 3, bw = (W - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const x = m + i * (bw + gap);
        P.rect(x, y, bw, C.visaH, { stroke: '#000', w: 0.3 });
        P.text(opt.visaTitles[i] || defaults[i], x + 2, y + 4, { size: 7, bold: true });
      }
    }
    if (opt.show.certificate) { P.text(t('rpt.original'), A4.w - m - 1, m + C.titleH + 6.5, { size: 6, align: 'right', italic: true, c: '#555' }); }

    /* continuation strips for manual time scales */
    for (let s = 1; s < strips; s++) {
      const Q = newPage(doc, A4.w, A4.h, label);
      Q.text(label + ' – ' + t('rpt.title'), m, m + 5, { size: 10, bold: true });
      classicDiagram(Q, { x: m, y: m + 10, w: W, h: A4.h - 2 * m - 25 }, item, opt, s);
    }
    if (opt.show.ginPage && st.ok) {
      const Q = newPage(doc, A4.w, A4.h, label);
      Q.text(t('gin.title') + ' – ' + label, m, m + 5, { size: 10, bold: true });
      Q.text(t('gin.note'), m, m + 10, { size: 7, c: '#444' });
      ginDiagram(Q, { x: m, y: m + 14, w: W, h: 150 }, item, opt);
      Q.text(t('st.gin') + ': ' + fmt(st.gin, 1) + ' bar·l', m, m + 175, { size: 9, bold: true });
    }
    appendices(doc, item, opt);
  }

  /* ---------- modern record sheet ---------- */
  function modernSheet(doc, item, opt) {
    const { rec, st, hdr } = item, m = 12, W = A4.w - 2 * m, label = hdr.job || rec.meta.fileName;
    const ACC = '#4f46e5', INK = '#0f172a', MUTE = '#64748b';
    const P = newPage(doc, A4.w, A4.h, label);
    P.rect(0, 0, A4.w, 30, { fill: INK }); P.rect(0, 30, A4.w, 1.4, { fill: ACC });
    P.text(G.fit(hdr.company || opt.company || t('app.name'), 90, 9, true), m, 11, { size: 9, bold: true, c: '#a5b4fc' });
    P.text(t('rpt.title'), m, 21, { size: 17, bold: true, c: '#ffffff' });
    const rs = (rec.events.find((e) => e.name === 'RecordStart') || {}).date || '';
    P.text(rs.slice(0, 10) + '  ' + rs.slice(11, 19), A4.w - m, 21, { size: 9, align: 'right', c: '#cbd5e1' });
    let y = 40;
    P.text(G.fit(hdr.job || rec.meta.fileName, W, 20, true), m, y + 3, { size: 20, bold: true, c: INK });
    P.text(G.fit([hdr.site, hdr.contract, hdr.operator].filter(Boolean).join('  ·  '), W, 9), m, y + 10, { size: 9, c: MUTE });
    y += 17;
    if (st.ok) {
      const cards = [[t('st.vol'), fmt(st.vol, 0), 'l'], [t('st.avgP'), fmt(st.avgP), 'bar'], [t('st.endP'), fmt(st.endP), 'bar'],
        [t('st.avgQ'), fmt(st.avgQ), 'l/min'], [t('f.grouting'), G.fmtHMS(st.durMeas), ''], [t('st.gin'), fmt(st.gin, 1), 'bar·l']];
      const gap = 4, cw = (W - gap * 2) / 3;
      cards.forEach((c, i) => {
        const x = m + (i % 3) * (cw + gap), yy = y + Math.floor(i / 3) * (21 + gap);
        P.rect(x, yy, cw, 21, { fill: '#f1f5f9', r: 2.2 }); P.rect(x, yy + 3, 1.1, 15, { fill: ACC });
        P.text(c[0], x + 5, yy + 6.5, { size: 7, c: MUTE });
        P.text(c[1], x + 5, yy + 16, { size: 16, bold: true, c: INK });
        P.text(c[2], x + cw - 4, yy + 16, { size: 8, align: 'right', c: MUTE });
      });
      y += 21 * 2 + gap + 7;
    }
    /* charts */
    const S = rec.samples;
    if (opt.show.diagram && S.length) {
      const tf = timeOf(opt), tMax = Math.max(tf(S[S.length - 1]), 1);
      const card = (cy, ch, title) => { P.rect(m, cy, W, ch, { stroke: '#e2e8f0', w: 0.3, r: 2.2 }); P.text(title, m + 4, cy + 6, { size: 8.5, bold: true, c: INK }); };
      const panel = (cy, ch, defs, fillId) => {
        card(cy, ch, defs.map((d) => d.name + ' (' + d.unit + ')').join('  ·  '));
        const x0 = m + 16, x1 = m + W - 16 - (defs.length > 1 ? 4 : 0), y0 = cy + 12, y1 = cy + ch - 9, h = y1 - y0;
        for (let i = 0; i <= 4; i++) P.line(x0, y0 + h * i / 4, x1, y0 + h * i / 4, { c: '#e2e8f0', w: 0.15, dash: [1, 1] });
        const ts = timeStep(tMax / 6), inMin = tMax >= 600;
        for (let v = 0; v <= tMax + 1e-9; v += ts) P.text(fmt(inMin ? v / 60 : v, decimals(inMin ? ts / 60 : ts)), x0 + v / tMax * (x1 - x0), y1 + 4.5, { size: 6, align: 'center', c: MUTE });
        P.text(t('ax.time') + (inMin ? ' (min)' : ' (s)'), x1, y1 + 8, { size: 6, align: 'right', c: MUTE });
        defs.forEach((d, k) => {
          const vals = S.map(d.val), mx = G.maxOf(vals) || 1, top = niceStep(mx / 4) * 4;
          const pts = S.map((s) => [x0 + tf(s) / tMax * (x1 - x0), y1 - d.val(s) / top * h]);
          if (d.id === fillId) P.area([[x0, y1], ...pts, [x1, y1]], { fill: d.color, opacity: 0.12 });
          P.poly(pts, { c: d.color, w: 0.5 });
          for (let i = 0; i <= 4; i++) {
            const val = top * (4 - i) / 4, txt = fmt(val, decimals(top / 4));
            if (k === 0) P.text(txt, x0 - 2, y0 + h * i / 4 + 1.2, { size: 6, align: 'right', c: d.color });
            else P.text(txt, x1 + 2, y0 + h * i / 4 + 1.2, { size: 6, c: d.color });
          }
        });
        const sp = G.setpoints(rec.meta.setConsRaw), pd = defs.find((d) => d.id === 'p');
        if (opt.show.setpoints && pd && sp.pressureLimitBar) {
          const top = niceStep((G.maxOf(S.map(pd.val)) || 1) / 4) * 4, yy = y1 - sp.pressureLimitBar / top * h;
          if (yy >= y0) P.line(x0, yy, x1, yy, { c: '#94a3b8', w: 0.25, dash: [2, 1.5] });
        }
      };
      const def = seriesDefs(Object.assign({}, opt, { show: Object.assign({}, opt.show, { gin: false, d: false }) }));
      const pq = def.filter((d) => d.id === 'p' || d.id === 'q');
      if (pq.length) { panel(y, 70, pq, 'p'); y += 74; }
      const vs = def.filter((d) => d.id === 'v');
      if (vs.length) { panel(y, 46, vs, 'v'); y += 50; }
    }
    /* details */
    const kv = [[t('f.contract'), hdr.contract], [t('f.pump'), hdr.pump], [t('f.grout'), hdr.grout], [t('st.stop'), st.stopType], [t('st.p30'), fmt(st.p30) + ' bar'], [t('st.restarts'), String(st.reprises || 0)]];
    if (y < A4.h - 50) {
      kv.forEach((c, i) => { const x = m + (i % 3) * (W / 3); const yy = y + Math.floor(i / 3) * 9; P.text(c[0], x, yy + 3, { size: 6.5, c: MUTE }); P.text(G.fit(c[1] || '-', W / 3 - 4, 9, true), x, yy + 7.5, { size: 9, bold: true, c: INK }); });
      y += 22;
    }
    const note = item.comment || opt.comment;
    if (opt.show.observations && note && y < A4.h - 30) {
      P.text(opt.obsTitle || t('obs.title'), m, y + 2, { size: 7.5, bold: true, c: MUTE });
      let line = '', ly = y + 7;
      for (const w of G.safe(note).split(' ')) { if (G.textWidth(line + ' ' + w, 8.5) > W) { P.text(line, m, ly, { size: 8.5, c: INK }); line = w; ly += 4; } else line = (line ? line + ' ' : '') + w; }
      if (line) P.text(line, m, ly, { size: 8.5, c: INK });
    }
    if (opt.show.visas) {
      const n = Math.max(1, Math.min(3, opt.visaCount)), defaults = [t('visa.operator'), t('visa.client'), t('visa.date')], gap = 4, bw = (W - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) { const x = m + i * (bw + gap); P.rect(x, A4.h - 36, bw, 20, { stroke: '#cbd5e1', w: 0.3, r: 2 }); P.text(opt.visaTitles[i] || defaults[i], x + 3, A4.h - 31, { size: 7, c: MUTE }); }
    }
    if (opt.show.ginPage && st.ok) {
      const Q = newPage(doc, A4.w, A4.h, label);
      Q.text(t('gin.title') + ' – ' + label, m, m + 5, { size: 12, bold: true, c: INK });
      Q.text(t('gin.note'), m, m + 11, { size: 7.5, c: MUTE });
      ginDiagram(Q, { x: m, y: m + 16, w: W, h: 150 }, item, Object.assign({}, opt, { mono: false }));
      Q.text(t('st.gin') + ': ' + fmt(st.gin, 1) + ' bar·l', m, m + 178, { size: 10, bold: true, c: INK });
    }
    appendices(doc, item, opt);
  }

  /* ---------- appendices: events, parameters, every sample ---------- */
  function appendices(doc, item, opt) {
    const { rec, hdr } = item, label = hdr.job || rec.meta.fileName, modern = opt.layout === 'cards';
    const head = (P, f) => {
      P.text(label, f.m, f.m + 4, { size: 9, bold: true, c: modern ? '#0f172a' : '#000' });
      P.line(f.m, f.m + 6, f.w - f.m, f.m + 6, { c: modern ? '#4f46e5' : '#000', w: 0.3 });
      return f.m + 10;
    };
    if (opt.show.events && rec.events.length) {
      const f = Flow(doc, A4.w, A4.h, 12, label, head);
      f.page.text(t('app.events'), f.m, f.y + 1, { size: 10, bold: true }); f.y += 5;
      table(f, { size: 7, cols: [{ label: t('app.events'), w: 34 }, { label: t('app.data'), flex: 2 }, { label: t('app.when'), w: 44 }, { label: 'idx', w: 16, align: 'right' }],
        rows: rec.events.map((e) => [e.name, e.data || '-', e.date || '-', String(e.idx)]) }, opt);
      const w = G.windows(rec);
      if (w.length) table(f, { size: 7, cols: [{ label: '#', w: 10 }, { label: t('f.start'), flex: 1 }, { label: t('f.end'), flex: 1 }, { label: t('f.grouting') + ' (s)', w: 32, align: 'right' }, { label: 'V (l)', w: 26, align: 'right' }],
        rows: w.map((x, i) => [String(i + 1), x.start.date, x.stop.date, fmt(rec.samples[x.b].tm - rec.samples[x.a].tm, 3), fmt(rec.samples[x.b].vL - rec.samples[x.a].vL, 3)]) }, opt);
    }
    if (opt.show.params) {
      const rows = Object.entries(rec.meta.params).map(([k, v]) => [k, String(v).trim() || '-']);
      if (rec.meta.setConsRaw) rows.unshift(['SetCons', rec.meta.setConsRaw]);
      if (rec.meta.ginRaw) rows.unshift(['Gin', rec.meta.ginRaw]);
      rec.meta.channels.forEach((c, i) => rows.push([c, rec.meta.units[i] || '-']));
      const f = Flow(doc, A4.w, A4.h, 12, label, head);
      f.page.text(t('app.params'), f.m, f.y + 1, { size: 10, bold: true }); f.y += 5;
      table(f, { size: 7, cols: [{ label: t('app.name2'), w: 60 }, { label: t('app.value'), flex: 1 }], rows }, opt);
    }
    if (opt.show.table && rec.samples.length) {
      const extra = rec.meta.channels.filter((c) => !Object.values(G.CH).includes(c));
      const f = Flow(doc, A4.w, A4.h, 12, label, head);
      f.page.text(t('app.samples'), f.m, f.y + 1, { size: 10, bold: true }); f.y += 5;
      table(f, { size: 6.5, rowH: 4.2, cols: [{ label: 't tot (s)', flex: 1, align: 'right' }, { label: 't meas (s)', flex: 1, align: 'right' }, { label: 'P (bar)', flex: 1, align: 'right' },
        { label: 'Q (l/min)', flex: 1, align: 'right' }, { label: 'V (l)', flex: 1, align: 'right' }, ...extra.map((c) => ({ label: c, flex: 1, align: 'right' }))],
        rows: rec.samples.map((s) => [fmt(s.tt, 2), fmt(s.tm, 2), fmt(s.pBar, 3), fmt(s.qLmin, 3), fmt(s.vL, 3), ...extra.map((c) => String(s.extra[c]))]) }, opt);
    }
  }

  /* ---------- summary (bilan) table, landscape ---------- */
  const SUMMARY_FIELDS = {
    date: { label: () => t('f.date'), get: (i) => ((i.rec.events.find((e) => e.name === 'RecordStart') || {}).date || '').slice(0, 10), flex: 1.1 },
    job: { label: () => t('f.borehole'), get: (i) => i.hdr.job || i.rec.meta.fileName, flex: 1.3 },
    site: { label: () => t('f.site'), get: (i) => i.hdr.site, flex: 1.1 },
    pump: { label: () => t('f.pump'), get: (i) => i.hdr.pump, flex: 0.7 },
    start: { label: () => t('f.start'), get: (i) => ((i.rec.events.find((e) => e.name === 'RecordStart') || {}).date || '').slice(11, 19), flex: 0.9 },
    end: { label: () => t('f.end'), get: (i) => (([...i.rec.events].reverse().find((e) => e.name === 'RecordStop') || {}).date || '').slice(11, 19), flex: 0.9 },
    grouting: { label: () => t('f.grouting'), get: (i) => G.fmtHMS(i.st.durMeas), flex: 1.25 },
    vol: { label: () => t('st.vol') + ' (l)', get: (i) => fmt(i.st.vol, 0), align: 'right', flex: 0.9 },
    avgP: { label: () => t('st.avgP') + ' (bar)', get: (i) => fmt(i.st.avgP), align: 'right', flex: 0.9 },
    p30: { label: () => t('st.p30') + ' (bar)', get: (i) => fmt(i.st.p30), align: 'right', flex: 0.9 },
    endP: { label: () => t('st.endP') + ' (bar)', get: (i) => fmt(i.st.endP), align: 'right', flex: 0.9 },
    avgQ: { label: () => t('st.avgQ') + ' (l/min)', get: (i) => fmt(i.st.avgQ), align: 'right', flex: 0.9 },
    q30: { label: () => t('st.q30') + ' (l/min)', get: (i) => fmt(i.st.q30), align: 'right', flex: 0.9 },
    endQ: { label: () => t('st.endQ') + ' (l/min)', get: (i) => fmt(i.st.endQ), align: 'right', flex: 0.9 },
    gin: { label: () => t('st.gin'), get: (i) => fmt(i.st.gin, 1), align: 'right', flex: 0.8 },
    restarts: { label: () => t('st.restarts'), get: (i) => String(i.st.reprises || 0), align: 'right', flex: 0.6 },
    stop: { label: () => t('st.stop'), get: (i) => i.st.stopType, flex: 1.4 },
  };
  G.SUMMARY_FIELDS = Object.keys(SUMMARY_FIELDS);
  G.summaryLabel = (k) => SUMMARY_FIELDS[k].label();
  /* Multicriteria selection (the original's "Multicriteria report"): ranges on pressure / flow / start hour / date, stop type, pump; then sort order. */
  const startOf = (i) => (i.rec.events.find((e) => e.name === 'RecordStart') || {}).date || '';
  G.selectItems = function (items, mc) {
    mc = mc || {};
    const pick = (i, mode, k) => (mode === '30s' ? i.st[k + '30'] : mode === 'final' ? i.st[k === 'p' ? 'endP' : 'endQ'] : i.st[k === 'p' ? 'avgP' : 'avgQ']);
    const lc = (s) => String(s || '').toLowerCase();
    let out = items.filter((i) => i.st.ok && i.rec.meta.kind !== 'update').filter((i) => {
      const p = pick(i, mc.pMode, 'p'), q = pick(i, mc.qMode, 'q'), d = startOf(i), hr = /T(\d\d):(\d\d)/.exec(d), hour = hr ? +hr[1] + +hr[2] / 60 : null;
      if (mc.pMin > 0 && !(p >= mc.pMin)) return false; if (mc.pMax > 0 && !(p <= mc.pMax)) return false;
      if (mc.qMin > 0 && !(q >= mc.qMin)) return false; if (mc.qMax > 0 && !(q <= mc.qMax)) return false;
      if (hour != null && ((mc.hMin > 0 && hour < mc.hMin) || (mc.hMax > 0 && mc.hMax < 24 && hour > mc.hMax))) return false;
      if (mc.dateFrom && d.slice(0, 10) < mc.dateFrom) return false; if (mc.dateTo && d.slice(0, 10) > mc.dateTo) return false;
      if (mc.stop && lc(i.st.stopType).indexOf(lc(mc.stop)) < 0) return false;
      if (mc.pump && lc(i.hdr.pump).indexOf(lc(mc.pump)) < 0) return false;
      return true;
    });
    const key = { date: startOf, hole: (i) => i.hdr.job || i.rec.meta.fileName, vol: (i) => i.st.vol, avgP: (i) => i.st.avgP }[mc.sort || 'date'] || startOf, dir = mc.asc === false ? -1 : 1;
    out = out.slice().sort((a, b) => { const x = key(a), y = key(b); return dir * (typeof x === 'number' ? (x - y) : String(x).localeCompare(String(y), undefined, { numeric: true })); });
    return out;
  };
  G.summaryRows = function (usable, keys, mc) {
    const rows = [], daily = !mc || mc.daily !== false; let day = null, dv = 0, dn = 0;
    const flush = () => { if (daily && day !== null && dn) rows.push({ span: day + '     ' + t('mc.daytotal') + ' : ' + fmt(dv, 0) + ' l     ' + t('mc.dayn') + ' : ' + dn }); };
    usable.forEach((i) => { const d = startOf(i).slice(0, 10); if (d !== day) { flush(); day = d; dv = 0; dn = 0; } rows.push(keys.map((k) => SUMMARY_FIELDS[k].get(i))); dv += i.st.vol || 0; dn++; });
    flush();
    return rows;
  };
  G.DEFAULT_SUMMARY = ['date', 'job', 'pump', 'start', 'end', 'grouting', 'vol', 'avgP', 'p30', 'endP', 'avgQ', 'q30', 'endQ', 'stop'];

  function summarySheet(doc, items, opt) {
    const modern = opt.layout === 'cards', W = 297, H = 210, m = 10, usable = G.selectItems(items, opt.mc);
    const keys = (opt.summaryCols && opt.summaryCols.length ? opt.summaryCols : G.DEFAULT_SUMMARY).filter((k) => SUMMARY_FIELDS[k]);
    const head = (P, f) => {
      if (modern) { P.rect(0, 0, W, 20, { fill: '#0f172a' }); P.rect(0, 20, W, 1.2, { fill: '#4f46e5' }); P.text(t('sum.title'), m, 13, { size: 15, bold: true, c: '#fff' }); P.text(String(usable.length) + ' ' + t('sum.holes'), W - m, 13, { size: 9, align: 'right', c: '#cbd5e1' }); return 28; }
      P.rect(m, m, W - 2 * m, 11, { stroke: '#000', w: 0.4 });
      P.text(G.fit(opt.company || (items[0] && items[0].hdr.company) || '', 70, 10, true), m + 3, m + 7.5, { size: 10, bold: true });
      P.text(t('sum.title'), W / 2, m + 7.5, { size: 13, bold: true, align: 'center' });
      P.text(String(usable.length) + ' ' + t('sum.holes'), W - m - 3, m + 7.5, { size: 8, align: 'right' });
      return m + 15;
    };
    const f = Flow(doc, W, H, m, t('sum.title'), head);
    table(f, { size: 7.2, rowH: 5.6, cols: keys.map((k) => ({ label: SUMMARY_FIELDS[k].label(), flex: SUMMARY_FIELDS[k].flex, align: SUMMARY_FIELDS[k].align })), rows: G.summaryRows(usable, keys, opt.mc) }, opt);
    const total = usable.reduce((n, i) => n + (i.st.vol || 0), 0), dur = usable.reduce((n, i) => n + (i.st.durMeas || 0), 0);
    f.ensure(10);
    f.page.text(usable.length ? t('mc.totalv') + ': ' + fmt(total, 0) + ' l     ' + t('mc.totaln') + ': ' + usable.length + '     ' + t('mc.totaldur') + ': ' + G.fmtHMS(dur) : t('mc.none'), m, f.y + 4, { size: 9, bold: true, c: modern ? '#0f172a' : '#000' });
    f.page.text(opt.method === 'weighted' ? t('calc.weighted') : t('calc.original'), m, f.y + 9, { size: 6.5, c: '#555' });
  }

  /* ---------- entry points ---------- */
  G.buildDocument = function (doc, items, opt, kind) {
    G.setLang(opt.lang);
    const sheet = opt.layout === 'cards' ? modernSheet : recordSheet;
    if (kind !== 'summary') {
      if (opt.layout === 'classic') G.buildOriginal(doc, items, opt);
      else items.filter((i) => i.rec.meta.kind !== 'update').forEach((i) => sheet(doc, i, opt));
    }
    if (kind === 'summary' || kind === 'both') summarySheet(doc, items, opt);
    /* footers once the total page count is known */
    const n = doc.count(), stamp = new Date().toLocaleString(G.locale());
    for (let i = 0; i < n; i++) {
      const P = doc.page(i), w = P.w, h = P.h;
      if (P.noFooter) continue;
      P.text(G.fit(P.label || '', 120, 6), 10, h - 5, { size: 6, c: '#666' });
      P.text(t('rpt.generated') + ' ' + stamp + '   ·   ' + t('rpt.page') + ' ' + (i + 1) + ' / ' + n, w - 10, h - 5, { size: 6, align: 'right', c: '#666' });
    }
    return doc;
  };
})(window.G = window.G || {});
