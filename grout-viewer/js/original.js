/* The "Original" printouts: A4 landscape reports laid out like the original software's own output.
 * Geometry (millimetres), fonts, colours and line weights were measured from three real printouts:
 *   "Pressure and flow in accordance to time"  - 5 sleeve columns per page, time down the page
 *   "Pressure/Volume/GIN"                      - pressure and penetrability against volume
 *   "Pressure/Volume/Flow"                     - averages per sleeve against depth (approximated: only a one-sleeve sample existed)
 */
(function (G) {
  'use strict';
  const t = (k, a) => G.t(k, a);
  const isNum = Number.isFinite;

  /* Measured from the specimens. Change here to recalibrate. */
  const GEO = {
    page: { w: 297, h: 210 },
    headY0: 9.99, headY1: 24.95, headLw: 0.423,
    frameTop: 35.98, frameBottom: 202.96, frameLw: 0.423,
    time: { L: 5, R: 291.97, cell: 100.63, cols: 5, head: 9.78, footRow: 2.76 },   // header: 3 text rows, y0 = frameTop + head
    pv: { L: 6.99, R: 289.94, cell: 101.3 },
    thin: 0.132, curveLw: 0.25, grey: '#808080', limitRed: '#ff0000',
    pvg: { x0: 27.01, x1: 280.12, yTop: 51.01, yZero: 155.96, tickOut: 2.0, tickBelow: 2.07 },
  };
  G.ORIGINAL = GEO;

  /* ---------- small helpers ---------- */
  let DEC = ','; // decimal separator of the current build (the original follows the Windows regional setting)
  let UF = 1, PU = 'bar', ACC = 1; // pressure unit factor and label (bar or kg/cm2), decimals of printed values
  const sep = () => DEC;
  const dec = (n, d) => (isNum(n) ? n.toFixed(d).replace('.', sep()) : '-');
  const trim = (n, d) => (isNum(n) ? String(+n.toFixed(d == null ? 2 : d)).replace('.', sep()) : '-');
  const pad2 = (n) => String(n).padStart(2, '0');
  function stamp(iso) { // dd-mm-yy  hh:mm:ss
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d:\d\d:\d\d)/.exec(iso || ''); return m ? m[3] + '-' + m[2] + '-' + m[1].slice(2) + '  ' + m[4] : '';
  }
  function stopLabel(raw) { // "Manu_StopOperator" -> "operator (M)"
    const m = /^(Manu|Auto)_Stop(.*)$/i.exec(raw || ''); if (!m) return raw || '';
    return (m[2] || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() + ' (' + (/^manu/i.test(m[1]) ? 'M' : 'A') + ')';
  }
  const AXIS_STEPS = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000];
  const axisMax = (want, dataMax) => { let a = want > 0 ? want : 10; if (dataMax > a) a = AXIS_STEPS.find((x) => x >= dataMax) || Math.ceil(dataMax); return a; };

  /* Axis scales. Mode "manual" uses the entered values (an empty/0 value means automatic for that curve); mode "auto"
     chooses every scale from the data. In the time chart the full column width is twice the scale (the centre line is the scale). */
  const TSTEPS = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 900, 1200, 1800, 3600, 7200, 14400, 28800, 86400];
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }
  let SC = { tcm: 60, p: 50, q: 100, v: 100, d: 50, g: 100 };
  function computeScales(entries, opt) {
    const O = opt.o, auto = O.axes === 'auto', sc = {};
    const maxCm = Math.floor((GEO.frameBottom - (GEO.frameTop + GEO.time.head) - GEO.time.footRow - 0.4) / 10);
    const maxDur = G.maxOf(entries.map((e) => e.d.dur), 1);
    sc.tcm = !auto && O.tcm > 0 ? O.tcm : (TSTEPS.find((x) => x >= maxDur / maxCm) || Math.ceil(maxDur / maxCm));
    ['p', 'q', 'v', 'd', 'g'].forEach((k) => {
      const mx = G.maxOf(entries.map((e) => G.maxOf(e.d.series[k], 0)), 0);
      sc[k] = !auto && O[k].scale > 0 ? O[k].scale : niceStep(mx * 1.05 / 2);
    });
    return sc;
  }
  /* Axis maximum of the P/V plots: tight fit in auto mode, otherwise the entered value (extended when the data exceeds it). */
  const tightMax = (dataMax) => AXIS_STEPS.find((x) => x >= dataMax * 1.02) || Math.ceil(dataMax * 1.02);
  const axisFor = (O, want, dataMax) => (O.axes === 'auto' || !(want > 0) ? tightMax(dataMax > 0 ? dataMax : 1) : axisMax(want, dataMax));

  function movingAverage(T, V, seconds) {
    if (!(seconds > 0) || V.length < 3) return V;
    const out = new Array(V.length), pre = [0]; for (const v of V) pre.push(pre[pre.length - 1] + v);
    let lo = 0, hi = 0;
    for (let i = 0; i < V.length; i++) {
      while (lo < i && T[lo] < T[i] - seconds / 2) lo++;
      if (hi < i) hi = i; while (hi + 1 < V.length && T[hi + 1] <= T[i] + seconds / 2) hi++;
      out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
    }
    return out;
  }

  /* Samples from the first record up to the last pump stop, plotted against the measuring clock. Time spent idle
     does not advance that clock, so pauses collapse onto one line, exactly as in the original printouts. */
  /* Effective pressure, from DialogDesktop.Injection.CalcPNormal (its inverse): the gauge pressure plus the grout column above the middle of the
     sleeve, minus the ground water above it: P + cosA*(rho/1000)*h/10 - cosA*(h - waterDepth)/10 (bar, metres). Angle is from the vertical. */
  function effOffset(hdr, O) {
    const top = G.parseNumber(hdr.top), bottom = G.parseNumber(hdr.bottom), h = isNum(top) && isNum(bottom) ? (top + bottom) / 2 : isNum(bottom) ? bottom : 0;
    if (!(h > 0)) return 0;
    const cosA = Math.cos((O.angle || 0) * Math.PI / 180), wd = O.waterDepth || 0, grout = cosA * h * ((O.density || 1000) / 1000), water = wd !== 0 && wd < h ? cosA * (h - wd) : 0;
    return (grout - water) / 10;
  }
  function prepare(item, opt) {
    const S = item.rec.samples; if (!S.length) return null;
    let end = S.length - 1;
    for (let i = item.rec.events.length - 1; i >= 0; i--) if (item.rec.events[i].name === 'PumpStop') { end = Math.min(S.length - 1, Math.max(0, item.rec.events[i].idx)); break; }
    const idx = []; for (let i = 0; i <= end; i++) idx.push(i);
    const pts = idx.map((i) => S[i]), t0 = 0, T = pts.map((s) => s.tm), O = opt.o;
    const corr = O.sel.eff ? effOffset(item.hdr, O) : 0;
    const P = pts.map((s) => s.pBar + corr), Q = pts.map((s) => s.qLmin), V = pts.map((s) => s.vL);
    const sp = O.smoothP.on ? movingAverage(T, P, O.smoothP.s) : P, sq = O.smoothQ.on ? movingAverage(T, Q, O.smoothQ.s) : Q;
    const D = sp.map((p, i) => (p > 0.05 ? sq[i] / p : 0)), spu = UF === 1 ? sp : sp.map((v) => v * UF), Gn = spu.map((p, i) => p * V[i]);
    /* pressure limit per sample from the SetCons events */
    const cons = item.rec.events.filter((e) => e.name === 'SetCons').map((e) => ({ idx: e.idx, p: G.setpoints(e.data).pressureLimitBar })).filter((c) => c.p != null);
    const lim = idx.map((i) => { let v = null; for (const c of cons) if (c.idx <= i) v = c.p; if (v == null && cons.length) v = cons[0].p; return v == null ? null : v * UF; });
    return { idx, T, series: { p: spu, q: sq, v: V, d: D, g: Gn }, lim, dur: T[T.length - 1], corr, vMax: G.maxOf(V), pMax: G.maxOf(spu), t0 };
  }

  /* ---------- page furniture ---------- */
  function pageHead(P, opt, hdr, title, m, firstItem) {
    const H = GEO, O = opt.o, L = m.L, R = m.R;
    P.rect(L, H.headY0, R - L, H.headY1 - H.headY0, { stroke: '#000', w: H.headLw });
    P.rect(L, H.headY0, m.cell - L, H.headY1 - H.headY0, { stroke: '#000', w: H.headLw });
    if (O.logo) P.image(O.logo, L + 1, H.headY0 + 1, m.cell - L - 2, H.headY1 - H.headY0 - 2, { w: O.logoW, h: O.logoH });
    const cx = (m.cell + R) / 2;
    P.text(O.title1 || hdr.site || '', cx, 15.62, { size: 14.16, bold: true, align: 'center' });
    P.text(O.title2 || t('o.grouting'), cx, 19.81, { size: 8.88, align: 'center' });
    const contract = hdr.contract || new Date().toISOString().slice(0, 10);
    P.text('(' + t('o.contract') + ' : ' + contract + ')', R, 14.56, { size: 8.16, align: 'right' });
    P.text(title, m.cell + 3.04, 23.79, { size: 8.88 });
    const soft = firstItem && firstItem.rec.meta.softVersion ? firstItem.rec.meta.softVersion : 'DPV';
    if (O.appTag) P.text(O.appTag + '/' + soft, R, 27.56, { size: 8.16, c: H.grey, align: 'right' }); // off by default: the printouts carry no mention of the original program
  }
  const lvl = (s) => { const n = G.parseNumber(s); return isNum(n) ? String(+n.toFixed(2)).replace('.', sep()) : String(s || '').trim(); };
  function levelsText(hdr) { const a = lvl(hdr.top), b = lvl(hdr.bottom); return a || b ? ' (' + (a || b) + '-' + (b || a) + ' m)' : ''; }
  function sleeveText(hdr) { return ' ' + (hdr.sleeve || '1') + levelsText(hdr); }

  /* ---------- report 1: pressure and flow in accordance to time ---------- */
  function curvesOn(O) { return ['p', 'q', 'v', 'd', 'g'].filter((k) => O[k].on); }
  const CURVE_LABEL = { p: () => '(' + trim(SC.p, 3) + ' ' + PU + ')', q: () => '(' + trim(SC.q, 3) + ' l/min)', v: () => '(' + trim(SC.v, 3) + ' l)', d: () => '(' + trim(SC.d, 3) + ' l/min/bar)', g: () => '(' + trim(SC.g, 3) + ' ' + PU + '.l)' };

  function timeColumns(entries, opt) {
    const O = opt.o, unit = SC.tcm, maxH = Math.floor((GEO.frameBottom - (GEO.frameTop + GEO.time.head) - GEO.time.footRow - 0.4) / 10) * 10, cols = [];
    entries.forEach((e) => {
      const hMm = e.d.dur / unit * 10, n = Math.max(1, Math.ceil(hMm / maxH - 1e-9));
      for (let s = 0; s < n; s++) cols.push({ e, t0: s * maxH / 10 * unit, t1: Math.min(e.d.dur, (s + 1) * maxH / 10 * unit), last: s === n - 1, first: s === 0 });
    });
    return cols;
  }

  function drawTimeColumn(P, cx, w, col, opt, showTicks) {
    const O = opt.o, E = col.e, { item, d } = E, hdr = item.hdr, unit = SC.tcm;
    const y0 = GEO.frameTop + GEO.time.head, hPlot = Math.max(0, (col.t1 - col.t0) / unit * 10), th = { c: '#000', w: GEO.thin };
    /* header rows */
    const hole = hdr.job || item.rec.meta.fileName;
    P.text(G.fit(hole, w - 1, 8.16, true), cx + 0.38, 38.65, { size: 8.16, bold: true });
    if (O.sel.sleeveInfo) P.text(G.fit(sleeveText(hdr), w - 1 - G.textWidth(hole, 8.16, true), 8.16), cx + 0.38 + G.textWidth(hole, 8.16, true), 38.57, { size: 8.16 });
    const on = curvesOn(O).slice(0, 2);
    on.forEach((k, i) => P.text(CURVE_LABEL[k](), cx + w * (i === 0 ? 0.25 : 0.75), 41.57, { size: 6.72, c: O[k].color, align: 'center' }));
    P.line(cx, 42.29, cx + w, 42.29, th);
    const start = (item.rec.events.find((x) => x.name === 'RecordStart') || {}).date;
    P.text(stamp(start), cx + w / 2, 45.08, { size: 8.88, align: 'center' });
    P.line(cx, y0, cx + w, y0, th);
    /* grid: ten dashed divisions, solid centre line */
    for (let k = 1; k <= 10; k++) P.line(cx + k * w / 10, y0, cx + k * w / 10, y0 + hPlot, { c: '#000', w: GEO.thin, dash: [0.5, 0.5] });
    P.line(cx + w / 2, y0, cx + w / 2, y0 + hPlot, th); P.line(cx + w, y0, cx + w, y0 + hPlot, th);
    /* time ticks in the page margin of the first column */
    if (showTicks) for (let k = 1; k * 10 <= hPlot + 0.01; k++) {
      const y = y0 + k * 10, sec = col.t0 + k * unit;
      P.line(cx - 0.47, y, cx, y, { c: '#000', w: 0.25 });
      const lab = sec % 60 === 0 ? String(sec / 60) : G.fmtHMS(sec).replace(/^0?0:/, '').replace(/^0(\d:)/, '$1'), lw = G.textWidth(lab, 6.72);
      P.text(lab, cx - 0.47, y + 0.85, { size: lw > 4.2 ? Math.max(3.5, 6.72 * 4.2 / lw) : 6.72, align: 'right' }); // must fit the 5 mm page margin
    }
    /* curves: x = value / (2 * scale) of the column width, y = time */
    const clip = { x: cx, y: y0, w: w, h: hPlot }, lo = col.t0 - 2 * unit, hi = col.t1 + 2 * unit;
    const xy = (arr, k) => { const out = []; for (let i = 0; i < d.T.length; i++) { if (d.T[i] < lo || d.T[i] > hi) continue; if (!out.length && col.first) out.push([cx, y0 + (d.T[i] - col.t0) / unit * 10]); out.push([cx + arr[i] / (2 * SC[k]) * w, y0 + (d.T[i] - col.t0) / unit * 10]); } return out; };
    if (O.sel.limits && d.lim.some((v) => v != null) && O.p.on) {
      const out = []; for (let i = 0; i < d.T.length; i++) { if (d.T[i] < lo || d.T[i] > hi || d.lim[i] == null) continue; out.push([cx + d.lim[i] / (2 * SC.p) * w, y0 + (d.T[i] - col.t0) / unit * 10]); }
      for (const seg of G.clipPoly(out, clip)) P.poly(seg, { c: GEO.limitRed, w: GEO.curveLw });
    }
    curvesOn(O).forEach((k) => { for (const seg of G.clipPoly(xy(d.series[k], k), clip)) P.poly(seg, { c: O[k].color, w: GEO.curveLw }); });
    /* footer row of the column */
    if (col.last) {
      const yb = y0 + hPlot, fr = GEO.time.footRow, base = yb + 2.2, st = E.st;
      P.line(cx, yb, cx + w, yb, th); P.line(cx, yb + fr, cx + w, yb + fr, th);
      let x = cx; const put = (s, c) => { if (!s) return; const wd = G.textWidth(s, 6.72); if (x + wd > cx + w) return; P.text(s, x, base, { size: 6.72, c: c || '#000' }); x += wd + 1.0; };
      if (O.sel.stopType) put(stopLabel(st.stopType), '#ff0000');
      if (O.sel.endTime) put(((item.rec.events.slice().reverse().find((x) => x.name === 'RecordStop') || {}).date || '').slice(11, 19));
      if (O.sel.duration) put(G.fmtHMS(st.durMeas));
      if (O.sel.totalVol) put(dec(Math.round(d.vMax), ACC) + ' l');
      if (O.sel.volLimit) { const sp = G.setpoints(item.rec.meta.setConsRaw); if (sp.volumeLimitL != null) put('(' + trim(sp.volumeLimitL, 0) + ')', '#ff0000'); }
      if (O.sel.avgPQ) put(dec((st.avgP + d.corr) * UF, ACC) + ' ' + PU + ' ' + dec(st.avgQ, ACC) + ' l/min');
      if (O.sel.finalP) put(dec(st.endP * UF, ACC) + ' ' + PU);
      if (O.sel.groutType) { const g = hdr.grout || t('o.unknown'); const wd = G.textWidth(g, 6.72); P.text(g, cx + w - wd - 0.6, base, { size: 6.72 }); }
    }
  }

  function timeReport(doc, entries, opt) {
    const m = GEO.time, O = opt.o, w = (m.R - m.L) / m.cols, perPage = O.sel.oneSleeve ? 1 : m.cols, cols = timeColumns(entries, opt), pages = [];
    for (let i = 0; i < cols.length || i === 0; i += perPage) {
      const slice = cols.slice(i, i + perPage), P = doc.addPage(GEO.page.w, GEO.page.h); P.orig = true; P.label = ''; pages.push(P);
      pageHead(P, opt, slice[0] ? slice[0].e.item.hdr : {}, t('o.rep.time'), m, slice[0] && slice[0].e.item);
      P.text(t('col.cm') + ' ' + trim(SC.tcm, 3) + ' s', m.L, 28.79, { size: 8.88, c: GEO.grey });
      P.rect(m.L, GEO.frameTop, m.R - m.L, GEO.frameBottom - GEO.frameTop, { stroke: '#000', w: GEO.frameLw });
      for (let k = 1; k < m.cols; k++) P.line(m.L + k * w, GEO.frameTop, m.L + k * w, GEO.frameBottom, { c: '#000', w: GEO.frameLw });
      slice.forEach((col, j) => drawTimeColumn(P, m.L + j * w, w, col, opt, j === 0));
    }
    return pages;
  }

  /* ---------- report 2: pressure / volume / GIN ---------- */
  function pvgPage(doc, E, opt) {
    const O = opt.o, m = GEO.pv, g = GEO.pvg, P = doc.addPage(GEO.page.w, GEO.page.h), { item, d } = E, hdr = item.hdr; P.orig = true; P.label = '';
    pageHead(P, opt, hdr, t('o.rep.pvg'), m, item);
    P.rect(m.L, GEO.frameTop, m.R - m.L, GEO.frameBottom - GEO.frameTop, { stroke: '#000', w: GEO.frameLw });
    /* sub-title: bold centred hole, then sleeve */
    const hole = (O.boreholeLabel || t('o.borehole')) + ' ' + (hdr.job || item.rec.meta.fileName), wb = G.textWidth(hole, 11.88, true), cxm = (m.L + m.R) / 2 - 0.5;
    P.text(hole, cxm - wb / 2, 31.83, { size: 11.88, bold: true }); P.text('  ' + t('o.sleeve') + sleeveText(hdr), cxm - wb / 2 + wb, 31.83, { size: 9.72 });
    const showD = O.d.on || O.pvgPen !== false;
    const aP = axisFor(O, O.p.scale, d.pMax), aV = axisFor(O, O.v.scale, d.vMax), aD = axisFor(O, O.d.scale, G.maxOf(d.series.d)), W = g.x1 - g.x0, H = g.yZero - g.yTop;
    /* grid: major every tenth, minor in between */
    for (let k = 0; k <= 10; k++) { const x = g.x0 + W * k / 10; P.line(x, g.yTop, x, g.yZero + g.tickBelow, { c: '#000', w: 0.25 }); if (k < 10) P.line(x + W / 20, g.yTop, x + W / 20, g.yZero + g.tickBelow, { c: '#000', w: 0.17 }); }
    for (let k = 0; k <= 10; k++) { const y = g.yZero - H * k / 10; P.line(g.x0 - g.tickOut, y, g.x1 - 0.13, y, { c: '#000', w: 0.25 }); if (k < 10) P.line(g.x0 - g.tickOut, y - H / 20, g.x1 - 0.13, y - H / 20, { c: '#000', w: 0.17 }); }
    for (let k = 0; k <= 10; k++) {
      const y = g.yZero - H * k / 10 + 1.22, x = g.x0 + W * k / 10;
      P.text(trim(aV * k / 10, 2), x, 162.94, { size: 9.72, align: 'center' });
      if (O.p.on) P.text(trim(aP * k / 10, 2), 23.0, y, { size: 9.72, align: 'right' });
      if (showD) P.text(trim(aD * k / 10, 2), 17.03, y, { size: 9.72, align: 'right', c: O.d.color });
    }
    if (showD) P.text(t('o.pen'), 8.0, 41.02, { size: 8.88, bold: true, c: O.d.color });
    if (O.p.on) P.text(t('o.pressure').replace('(bar)', '(' + PU + ')'), 16.98, 45.21, { size: 8.88, bold: true });
    P.text(t('o.volume'), g.x1 - 0.13, 166.33, { size: 8.88, bold: true, align: 'right' });
    const clip = { x: g.x0, y: g.yTop, w: W, h: H }, X = (v) => g.x0 + v / aV * W;
    const cap = isNum(item.st.vol) && item.st.vol > 0 ? item.st.vol + 1e-6 : Infinity;
    const line = (arr, a) => { const out = []; for (let i = 0; i < d.T.length; i++) { if (d.series.v[i] > cap) continue; out.push([X(d.series.v[i]), g.yZero - arr[i] / a * H]); } return out; };
    const gin = O.ginLimit > 0 ? O.ginLimit : (Number(item.rec.meta.params.S_G) === 1 ? Number(item.rec.meta.params.C_G) : G.parseNumber(item.rec.meta.ginRaw)) || 0;
    if (O.g.on && gin > 0) { const pts = []; for (let k = 1; k <= 300; k++) { const v = aV * k / 300; pts.push([X(v), g.yZero - gin / v / aP * H]); } for (const seg of G.clipPoly(pts, clip)) P.poly(seg, { c: O.g.color, w: 0.25, dash: [1.5, 1] }); }
    if (O.p.on) for (const seg of G.clipPoly(line(d.series.p, aP), clip)) P.poly(seg, { c: O.p.color, w: 0.34 });
    if (showD) for (const seg of G.clipPoly(line(d.series.d, aD), clip)) P.poly(seg, { c: O.d.color, w: 0.55 });
    return P;
  }

  /* ---------- report 3: pressure / volume / flow against depth (approximation) ---------- */
  function pvfPage(doc, group, opt) {
    const O = opt.o, m = GEO.pv, P = doc.addPage(GEO.page.w, GEO.page.h); P.orig = true; P.label = '';
    const first = group[0].item, hdr0 = first.hdr;
    pageHead(P, opt, hdr0, t('o.rep.pvf'), m, first);
    const name = (O.boreholeLabel || t('o.borehole')) + ' ' + (hdr0.job || first.rec.meta.fileName), wb = G.textWidth(name, 11.88, true);
    P.text(name, (m.L + m.R) / 2 - wb / 2 - 0.2, 31.83, { size: 11.88, bold: true });
    P.text(t('o.depth'), 0, 43.18, { size: 5.88 });
    const rows = group.map((e, i) => { const dep = G.parseNumber(e.item.hdr.bottom); return { e, depth: isNum(dep) ? dep : (G.parseNumber(e.item.hdr.sleeve) || i + 1), top: G.parseNumber(e.item.hdr.top) }; }).sort((a, b) => a.depth - b.depth);
    const dMin = rows[0].depth, dMax = rows[rows.length - 1].depth, y0 = 46.02, plotW = 87.0, xs = [m.L, 104.01, 201.0];
    /* 1 m = 10 mm (1/100) as in the specimen; a deeper range is compressed so that the table below still fits the frame */
    const sc = Math.min(10, (GEO.frameBottom - y0 - 6.26 - 6.9 - 2) / Math.max(dMax - dMin, 0.001));
    P.text('1/' + Math.round(1000 / sc), m.L - 0.01, 28.79, { size: 8.88, c: '#f0f0f0' });
    const charts = [
      { title: t('o.avgP'), unit: '(' + PU + ')', get: (r) => (r.e.st.avgP + (O.sel.eff ? effOffset(r.e.item.hdr, O) : 0)) * UF, color: O.p.color, want: 10 },
      { title: t('o.cumVol'), unit: '(l)', get: (r) => r.e.st.vol, color: O.d.color, want: 10 },
      { title: t('o.avgQ'), unit: '(l/min)', get: (r) => r.e.st.avgQ, color: O.q.color, want: 10, noLabel: true },
    ];
    charts.forEach((c, i) => {
      const x0 = xs[i], mx = axisFor(O, c.want, G.maxOf(rows.map(c.get).filter(isNum), 0)), cx = x0 + plotW / 2;
      P.text(c.title, cx, 39.58, { size: 7.44, align: 'center' }); P.text(c.unit, cx, 42.5, { size: 7.44, align: 'center' });
      for (let k = 0; k <= 4; k++) { const x = x0 + plotW * k / 4; P.text(trim(mx * k / 4, 2), x, 45.47, { size: 6.72, align: 'center' }); P.line(x, 45.72, x, y0, { c: '#000', w: k === 0 || k === 4 ? 0.25 : 0.13 }); }
      rows.forEach((r) => {
        const y = y0 + (r.depth - dMin) * sc, v = c.get(r), hBar = isNum(r.top) ? Math.max(0, (r.depth - r.top) * sc) : 0;
        P.line(x0 - 0.42, y, x0, y, { c: '#000', w: 0.25 });
        P.text(dec(r.depth, 2), x0 - 5.07, y + 0.8, { size: 6.72 });
        if (isNum(v) && v > 0 && hBar > 0) P.rect(x0, y - hBar, Math.min(plotW, v / mx * plotW), hBar, { fill: c.color });
        if (!c.noLabel) { P.text(dec(v, ACC), x0 + plotW - 2.7, y + 0.6, { size: 5.16, align: 'center' }); P.text('(*)', x0 + plotW - 2.7, y - 1.4, { size: 5.16, align: 'center' }); }
      });
    });
    const yT = y0 + (dMax - dMin) * sc + 6.26, totVol = rows.reduce((n, r) => n + (r.e.st.vol || 0), 0);
    P.rect(m.L, yT, m.R - m.L, 3.43, { stroke: '#000', w: GEO.thin }); P.rect(m.L, yT + 3.47, m.R - m.L, 3.43, { stroke: '#000', w: GEO.thin });
    P.text(' ' + t('o.cumVolGr'), m.L, yT + 2.8, { size: 8.88 }); P.text(': ' + trim(totVol, 0) + ' l', 52.5, yT + 2.8, { size: 8.88 });
    P.text(t('o.nSleeves') + ': ' + rows.length + ' ', m.R, yT + 2.8, { size: 8.88, align: 'right' });
    P.text(' ' + t('o.sampling'), m.L, yT + 6.27, { size: 8.88 }); P.text(': ' + trim(first.rec.meta.trigStep > 0 ? first.rec.meta.trigStep : 1, 3) + ' s', 52.5, yT + 6.27, { size: 8.88 });
    P.text(t('o.measured'), 82.3, yT + 6.27, { size: 8.88 });
    return P;
  }

  /* ---------- entry point ---------- */
  /* helpers shared with js/original2.js (histogram and water-test reports) */
  G._o = { GEO, pageHead, prepare, effOffset, dec, trim, sleeveText, niceStep, tightMax, stopLabel, extras: {}, units: () => ({ UF, PU, ACC }) };

  G.buildOriginal = function (doc, items, opt) {
    const O = opt.o; DEC = O.dec === '.' || O.dec === ',' ? O.dec : (G.lang === 'en' ? '.' : ',');
    UF = O.pUnit === 'kgcm2' ? 1.0197162 : 1; PU = O.pUnit === 'kgcm2' ? 'kg/cm\u00b2' : 'bar'; ACC = O.decimals >= 0 && O.decimals <= 4 ? Math.round(O.decimals) : 1;
    const usable = items.filter((it) => it.rec.meta.kind !== 'update' && it.st.ok).map((item) => ({ item, st: item.st, d: prepare(item, opt) })).filter((e) => e.d);
    const pages = [];
    if (!usable.length) return pages;
    SC = computeScales(usable, opt);
    if (O.reports.time) pages.push(...timeReport(doc, usable, opt));
    if (O.reports.pvg) usable.forEach((e) => pages.push(pvgPage(doc, e, opt)));
    if (O.reports.pvf) {
      const groups = {}; usable.forEach((e) => { const k = e.item.hdr.job || e.item.rec.meta.fileName; (groups[k] = groups[k] || []).push(e); });
      Object.keys(groups).forEach((k) => pages.push(pvfPage(doc, groups[k], opt)));
    }
    if (O.reports.hist && G._o.extras.hist) pages.push(...G._o.extras.hist(doc, usable, opt));
    if (O.reports.lug && G._o.extras.lug) usable.forEach((e) => pages.push(...G._o.extras.lug(doc, e, opt)));
    /* footer: text line and page number (as on the specimens) */
    pages.forEach((P, i) => {
      if (O.footerLeft) P.text(O.footerLeft, 5.0, 207.35, { size: 8.16, c: GEO.grey });
      if (O.footerText) P.text(O.footerText, 212.09, 207.35, { size: 8.16, c: GEO.grey });
      P.text((i + 1) + '/' + pages.length, 291.99, 207.35, { size: 8.16, align: 'right', bold: true });
      P.noFooter = true;
    });
    return pages;
  };
})(window.G = window.G || {});
