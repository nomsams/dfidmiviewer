/* Additional Original-style reports found in the original software's "Processing" menu.
 *   Distribution of the grouted volumes ("Volume diagram")   - histogram over all loaded injections
 *   Water test diagram (Lugeon)                              - stages, averages and apparent Lugeon value
 * They reuse the page furniture (frame, header, footer) of original.js. They were built from the original's captions and
 * the standard definitions; no printout of these two modes was available, so their page geometry is an interpretation. */
(function (G) {
  'use strict';
  const O_ = G._o, GEO = O_.GEO, t = (k, a) => G.t(k, a), isNum = Number.isFinite;
  const M = GEO.pv;

  function begin(doc, opt, title, first) {
    const P = doc.addPage(GEO.page.w, GEO.page.h); P.orig = true; P.label = '';
    O_.pageHead(P, opt, first.item.hdr, title, M, first.item);
    return P;
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

  /* ---------- distribution of the grouted volumes ---------- */
  O_.extras.hist = function (doc, entries, opt) {
    const P = begin(doc, opt, t('o.rep.vol'), entries[0]), g = GEO.pvg, W = g.x1 - g.x0, H = g.yZero - g.yTop, { dec, trim } = O_;
    P.rect(M.L, GEO.frameTop, M.R - M.L, GEO.frameBottom - GEO.frameTop, { stroke: '#000', w: GEO.frameLw });
    const vols = entries.map((e) => e.st.vol).filter((v) => isNum(v) && v >= 0), maxV = G.maxOf(vols, 0);
    const bw = O_.niceStep(Math.max(maxV, 1e-9) / 10), nb = Math.max(1, Math.min(40, Math.ceil((maxV + 1e-9) / bw))), counts = new Array(nb).fill(0);
    vols.forEach((v) => { counts[Math.min(nb - 1, Math.floor(v / bw))]++; });
    const cMax = Math.max(5, Math.ceil(G.maxOf(counts, 0) / 5) * 5), xMax = nb * bw;
    for (let k = 0; k <= 10; k++) { const y = g.yZero - H * k / 10; P.line(g.x0 - 2, y, g.x1, y, { c: '#000', w: k % 2 ? 0.17 : 0.25 }); if (k % 2 === 0) P.text(String(Math.round(cMax * k / 10)), 23.0, y + 1.22, { size: 9.72, align: 'right' }); }
    const bx = (v) => g.x0 + v / xMax * W;
    counts.forEach((c, i) => {
      const x = bx(i * bw), w = bx((i + 1) * bw) - x, h = c / cMax * H;
      if (c > 0) { P.rect(x + 0.4, g.yZero - h, w - 0.8, h, { fill: opt.o.p.color, stroke: '#000', w: 0.2 }); P.text(String(c), x + w / 2, g.yZero - h - 1.2, { size: 8.88, bold: true, align: 'center' }); }
      P.line(x, g.yZero, x, g.yZero + 2, { c: '#000', w: 0.25 }); P.text(trim(i * bw, 2), x, 162.94, { size: 9.72, align: 'center' });
    });
    P.line(g.x0, g.yZero, g.x1, g.yZero, { c: '#000', w: 0.35 }); P.line(bx(xMax), g.yZero, bx(xMax), g.yZero + 2, { c: '#000', w: 0.25 }); P.text(trim(xMax, 2), bx(xMax), 162.94, { size: 9.72, align: 'center' });
    P.line(g.x0, g.yTop, g.x0, g.yZero, { c: '#000', w: 0.35 });
    P.text(t('o.hist.count'), 8.0, 45.21, { size: 8.88, bold: true }); P.text(t('o.volume'), g.x1, 166.33, { size: 8.88, bold: true, align: 'right' });
    P.text(t('o.hist.total') + ': ' + dec(vols.reduce((n, v) => n + v, 0), 0) + ' l     ' + t('o.hist.n') + ': ' + vols.length + '     ' + t('o.hist.avg') + ': ' + dec(mean(vols), 1) + ' l', M.L + 3, 182, { size: 8.88 });
    return [P];
  };

  /* ---------- water test (Lugeon) ---------- */
  /* Stages: pairs of LugeonStart/LugeonStop events when the file has them (as the import code expects), otherwise pressure plateaus
     inside the measuring windows: a stage is a run whose pressure stays within 10 % (at least 0.2 bar) of its running mean for >= minStage seconds. */
  function findStages(rec, minStage) {
    const S = rec.samples, n = S.length, ev = rec.events, clamp = (i) => Math.min(n - 1, Math.max(0, i | 0)), out = [];
    const starts = ev.filter((e) => /^lugeonstart$/i.test(e.name)), stops = ev.filter((e) => /^lugeonstop$/i.test(e.name));
    starts.forEach((s, i) => {
      const stop = stops.find((x) => x.idx >= s.idx), end = stop ? stop.idx : (starts[i + 1] ? starts[i + 1].idx - 1 : n - 1);
      if (clamp(end) > clamp(s.idx)) out.push({ a: clamp(s.idx), b: clamp(end), src: 'events' });
    });
    if (out.length) return out;
    const wins = G.windows(rec), idx = []; if (wins.length) wins.forEach((w) => { for (let i = w.a; i <= w.b; i++) idx.push(i); }); else for (let i = 0; i < n; i++) idx.push(i);
    let run = null;
    const close = () => { if (run && run.n > 1 && S[run.last].tm - S[run.first].tm >= minStage && run.sum / run.n > 0.3) out.push({ a: run.first, b: run.last, src: 'plateau' }); run = null; };
    idx.forEach((i) => {
      const p = S[i].pBar;
      if (run && Math.abs(p - run.sum / run.n) <= Math.max(0.2, 0.1 * run.sum / run.n)) { run.sum += p; run.n++; run.last = i; } else { close(); run = { first: i, last: i, sum: p, n: 1 }; }
    });
    close();
    return out;
  }
  /* Apparent Lugeon: flow per metre of tested length, scaled to 10 bar of effective pressure (the unit of the original's caption). */
  function lugeon(qLmin, lengthM, pBar, L) {
    const peff = pBar + L.staticM * 0.0981 - L.lossBar;
    return lengthM > 0 && peff > 0 ? (qLmin / lengthM) * (10 / peff) : NaN;
  }
  G.waterTest = function (rec, hdr, lug) {
    const S = rec.samples, L = Object.assign({ staticM: 0, lossBar: 0, lengthM: 0, minStage: 30 }, lug || {});
    const top = G.parseNumber(hdr && hdr.top), bottom = G.parseNumber(hdr && hdr.bottom), length = L.lengthM > 0 ? L.lengthM : (isNum(top) && isNum(bottom) ? Math.abs(bottom - top) : 0);
    const stages = findStages(rec, L.minStage).map((s, i) => {
      const seg = S.slice(s.a, s.b + 1), dur = S[s.b].tm - S[s.a].tm, p = mean(seg.map((x) => x.pBar)), q = mean(seg.map((x) => x.qLmin));
      const tail = seg.filter((x) => x.tm >= S[s.b].tm - 30), q30 = mean(tail.map((x) => x.qLmin)), p30 = mean(tail.map((x) => x.pBar));
      return { n: i + 1, a: s.a, b: s.b, src: s.src, start: S[s.a].tm, dur, p, q, vol: S[s.b].vL - S[s.a].vL, pq: p > 0.05 ? q / p : NaN, lugeon: lugeon(q, length, p, L), lugeon30: lugeon(q30, length, p30, L) };
    }).filter((s) => s.dur > 0);
    const last = stages[stages.length - 1];
    return { stages, length, final: last ? last.lugeon30 : NaN, totalDur: stages.reduce((n, s) => n + s.dur, 0), totalVol: stages.reduce((n, s) => n + s.vol, 0) };
  };

  O_.extras.lug = function (doc, e, opt) {
    const { dec, trim } = O_, hdr = e.item.hdr, w = G.waterTest(e.item.rec, hdr, opt.o.lug), S = e.item.rec.samples, pages = [];
    const P = begin(doc, opt, t('o.rep.lug'), e); pages.push(P);
    P.rect(M.L, GEO.frameTop, M.R - M.L, GEO.frameBottom - GEO.frameTop, { stroke: '#000', w: GEO.frameLw });
    const name = (opt.o.boreholeLabel || t('o.borehole')) + ' ' + (hdr.job || e.item.rec.meta.fileName), wb = G.textWidth(name, 11.88, true), cxm = (M.L + M.R) / 2 - 0.5;
    P.text(name, cxm - wb / 2, 31.83, { size: 11.88, bold: true }); P.text('  ' + t('o.sleeve') + O_.sleeveText(hdr), cxm - wb / 2 + wb, 31.83, { size: 9.72 });
    /* chart: pressure and flow against the measuring clock, stages shaded */
    const x0 = 27.01, x1 = 280.12, yT = 44, yB = 112, Wd = x1 - x0, Ht = yB - yT, tMax = Math.max(e.d.dur, 1), pMax = O_.tightMax(Math.max(e.d.pMax, 0.1)), qMax = O_.tightMax(Math.max(G.maxOf(e.d.series.q, 0), 0.1));
    w.stages.forEach((s, i) => { const xa = x0 + S[s.a].tm / tMax * Wd, xb = x0 + S[s.b].tm / tMax * Wd; P.rect(xa, yT, Math.max(0.3, xb - xa), Ht, { fill: i % 2 ? '#f1f1f1' : '#e3e8f5' }); P.text(String(s.n), (xa + xb) / 2, yT + 3.2, { size: 7, bold: true, align: 'center', c: '#555' }); });
    for (let k = 0; k <= 5; k++) { const y = yB - Ht * k / 5; P.line(x0, y, x1, y, { c: '#9a9a9a', w: 0.13 }); P.text(trim(pMax * k / 5, 2), x0 - 1.5, y + 1.1, { size: 7, align: 'right', c: opt.o.p.color }); P.text(trim(qMax * k / 5, 2), x1 + 1.5, y + 1.1, { size: 7, c: opt.o.q.color }); }
    for (let k = 0; k <= 10; k++) { const x = x0 + Wd * k / 10; P.line(x, yT, x, yB, { c: '#c8c8c8', w: 0.1 }); P.text(G.fmtHMS(tMax * k / 10).replace(/^00:/, ''), x, yB + 4, { size: 6.5, align: 'center' }); }
    P.rect(x0, yT, Wd, Ht, { stroke: '#000', w: 0.3 });
    const idxs = []; for (let i = 0; i < e.d.T.length; i++) idxs.push(i);
    P.poly(idxs.map((i) => [x0 + e.d.T[i] / tMax * Wd, yB - e.d.series.p[i] / pMax * Ht]), { c: opt.o.p.color, w: 0.34 });
    P.poly(idxs.map((i) => [x0 + e.d.T[i] / tMax * Wd, yB - e.d.series.q[i] / qMax * Ht]), { c: opt.o.q.color, w: 0.34 });
    P.text(t('o.pressure').replace('(bar)', '(' + O_.units().PU + ')'), M.L + 2, yT - 2.5, { size: 8.88, bold: true, c: opt.o.p.color }); P.text('Q (l/min)', M.R - 2, yT - 2.5, { size: 8.88, bold: true, align: 'right', c: opt.o.q.color });
    /* table of stages */
    const cols = [[t('o.lug.stage'), 16, 'left'], [t('o.lug.start'), 24, 'right'], [t('o.lug.dur'), 28, 'right'], [t('o.lug.p'), 34, 'right'], [t('o.lug.q'), 34, 'right'], [t('o.lug.vol'), 28, 'right'], [t('o.lug.pq'), 36, 'right'], [t('o.lug.l'), 54, 'right']];
    const tw = cols.reduce((n, c) => n + c[1], 0), tx = x0, rh = 5.6, perPage = 11;
    const drawTable = (Q, y0, rows) => {
      Q.rect(tx, y0, tw, rh + 1, { stroke: '#000', w: GEO.thin, fill: '#ececec' });
      let x = tx; cols.forEach((c) => { Q.text(G.fit(c[0], c[1] - 2, 7.4, true), c[2] === 'right' ? x + c[1] - 1.2 : x + 1.2, y0 + rh - 0.6, { size: 7.4, bold: true, align: c[2] === 'right' ? 'right' : 'left' }); x += c[1]; });
      rows.forEach((s, i) => {
        const y = y0 + rh + 1 + i * rh; Q.rect(tx, y, tw, rh, { stroke: '#000', w: GEO.thin });
        const cells = [String(s.n), G.fmtHMS(s.start).replace(/^00:/, ''), G.fmtHMS(s.dur).replace(/^00:/, ''), dec(s.p, 2), dec(s.q, 2), dec(s.vol, 2), dec(s.pq, 2), isNum(s.lugeon) ? dec(s.lugeon, 1) : '-'];
        let xx = tx; cols.forEach((c, k) => { Q.text(cells[k], c[2] === 'right' ? xx + c[1] - 1.2 : xx + 1.2, y + rh - 1.5, { size: 8.4, align: c[2] === 'right' ? 'right' : 'left' }); xx += c[1]; });
      });
      return y0 + rh + 1 + rows.length * rh;
    };
    let yEnd = drawTable(P, 128, w.stages.slice(0, perPage));
    for (let from = perPage; from < w.stages.length; from += 30) { // very many stages: continue on further pages
      const Q = begin(doc, opt, t('o.rep.lug'), e); pages.push(Q); Q.rect(M.L, GEO.frameTop, M.R - M.L, GEO.frameBottom - GEO.frameTop, { stroke: '#000', w: GEO.frameLw });
      yEnd = drawTable(Q, 44, w.stages.slice(from, from + 30));
    }
    const L = pages[pages.length - 1], yb = Math.min(yEnd + 8, 186);
    L.text(t('o.lug.nstages') + ': ' + w.stages.length + '     ' + t('o.lug.totdur') + ': ' + G.fmtHMS(w.totalDur) + '     ' + t('o.lug.totvol') + ': ' + dec(w.totalVol, 2) + ' l     ' + t('o.lug.final') + ': ' + (isNum(w.final) ? dec(w.final, 1) : '-') + ' (l/min/m, 10 bar)', M.L + 3, yb, { size: 8.88, bold: true });
    L.text(w.stages.length ? t('o.lug.note', { len: w.length > 0 ? dec(w.length, 2) : '?', src: w.stages[0].src === 'events' ? t('o.lug.src.ev') : t('o.lug.src.pl') }) : t('o.lug.none'), M.L + 3, yb + 5, { size: 6.8, c: GEO.grey });
    return pages;
  };
})(window.G = window.G || {});
