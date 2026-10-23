/* Interactive chart on <canvas>: pressure, flow and volume with independent axes.
 * Wheel = zoom, drag = pan, double-click = reset, hover = read-out. Colours follow the active theme. */
(function (G) {
  'use strict';
  const niceMax = (v) => {
    if (!(v > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 8 ? 8 : 10) * e;
  };
  const css = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();

  G.Chart = function (canvas, tip) {
    const ctx = canvas.getContext('2d');
    const st = { rec: null, show: { p: true, q: true, v: true }, xmode: 'tt', markers: true, view: null, hover: -1, setpoint: true, windows: true, axisMode: 'auto', maxes: {} };
    let geom = null, drag = null;

    const xOf = (s) => (st.xmode === 'tm' ? s.tm : s.tt);
    const full = () => { const S = st.rec.samples; return [0, Math.max(xOf(S[S.length - 1]), 1)]; };

    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(10, Math.round(r.width * dpr)); canvas.height = Math.max(10, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
    }

    function draw() {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);
      if (!st.rec || !st.rec.samples.length) {
        ctx.fillStyle = css('--muted'); ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(G.t('chart.nodata'), W / 2, H / 2); geom = null; return;
      }
      const S = st.rec.samples, view = st.view || full();
      const col = { p: css('--c-p'), q: css('--c-q'), v: css('--c-v') }, grid = css('--grid'), txt = css('--muted'), fg = css('--text');
      const axes = [
        { id: 'p', side: 'L', unit: 'bar', get: (s) => s.pBar }, { id: 'q', side: 'R', unit: 'l/min', get: (s) => s.qLmin }, { id: 'v', side: 'R', unit: 'l', get: (s) => s.vL },
      ].filter((a) => st.show[a.id]);
      const nR = axes.filter((a) => a.side === 'R').length, nL = axes.filter((a) => a.side === 'L').length;
      const AX = 60, pad = { l: 12 + AX * Math.max(nL, 0), r: 8 + AX * nR, t: 26, b: 34 };
      const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
      geom = { pad, pw, ph, view, W, H };
      const X = (x) => pad.l + (x - view[0]) / (view[1] - view[0]) * pw;
      /* max values are taken over the whole record so scales stay stable while zooming */
      axes.forEach((a) => { const manual = st.axisMode === 'manual' && st.maxes && st.maxes[a.id] > 0; a.max = manual ? st.maxes[a.id] : niceMax(G.maxOf(S.map(a.get))); a.Y = (v) => pad.t + ph - v / a.max * ph; });

      /* measurement windows */
      if (st.windows) {
        ctx.fillStyle = css('--band');
        for (const w of G.windows(st.rec)) {
          const xa = X(xOf(S[w.a])), xb = X(xOf(S[w.b]));
          ctx.fillRect(Math.max(pad.l, xa), pad.t, Math.min(pad.l + pw, xb) - Math.max(pad.l, xa), ph);
        }
      }
      /* grid */
      ctx.lineWidth = 1; ctx.strokeStyle = grid; ctx.fillStyle = txt; ctx.font = '11px system-ui, sans-serif';
      for (let i = 0; i <= 5; i++) { const y = pad.t + ph * i / 5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke(); }
      const span = view[1] - view[0], tstep = niceMax(span / 8) / (niceMax(span / 8) > span / 8 * 2 ? 2 : 1);
      ctx.textAlign = 'center';
      for (let x = Math.ceil(view[0] / tstep) * tstep; x <= view[1] + 1e-9; x += tstep) {
        const px = X(x); ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + ph); ctx.stroke();
        ctx.fillText(span >= 600 ? (x / 60).toFixed(x % 60 ? 1 : 0) + ' min' : x.toFixed(span < 20 ? 1 : 0) + ' s', px, pad.t + ph + 15);
      }
      ctx.fillStyle = txt; ctx.fillText(G.t('ax.time') + (st.xmode === 'tm' ? ' (' + G.t('ax.meas') + ')' : ''), pad.l + pw / 2, H - 6);
      /* axes labels */
      let li = 0, ri = 0;
      for (const a of axes) {
        const x = a.side === 'L' ? pad.l - 6 - li * AX : pad.l + pw + 6 + ri * AX;
        ctx.fillStyle = col[a.id]; ctx.textAlign = a.side === 'L' ? 'right' : 'left'; ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillText(a.id.toUpperCase() + ' (' + a.unit + ')', x, pad.t - 10);
        ctx.font = '11px system-ui, sans-serif';
        for (let i = 0; i <= 5; i++) { const v = a.max * (5 - i) / 5; ctx.fillText(v.toFixed(a.max < 10 ? 2 : a.max < 100 ? 1 : 0), x, pad.t + ph * i / 5 + 4); }
        if (a.side === 'L') li++; else ri++;
      }
      /* setpoint */
      const sp = G.setpoints(st.rec.meta.setConsRaw), pa = axes.find((a) => a.id === 'p');
      if (st.setpoint && pa && sp.pressureLimitBar && sp.pressureLimitBar <= pa.max) {
        ctx.setLineDash([6, 4]); ctx.strokeStyle = col.p; ctx.globalAlpha = 0.6; ctx.beginPath();
        const y = pa.Y(sp.pressureLimitBar); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      /* event markers */
      if (st.markers) {
        ctx.setLineDash([2, 4]); ctx.strokeStyle = txt; ctx.fillStyle = txt; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left';
        for (const e of st.rec.events) {
          if (!/^(PumpStart|PumpStop)$/.test(e.name)) continue;
          const px = X(xOf(S[Math.min(e.idx, S.length - 1)])); if (px < pad.l || px > pad.l + pw) continue;
          ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + ph); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      /* curves (clipped to plot) */
      ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, pw, ph); ctx.clip(); ctx.lineJoin = 'round';
      for (const a of axes) {
        ctx.strokeStyle = col[a.id]; ctx.lineWidth = a.id === 'p' ? 2.2 : 1.8; ctx.beginPath();
        let started = false;
        for (let i = 0; i < S.length; i++) {
          const px = X(xOf(S[i])); if (px < pad.l - 40 || px > pad.l + pw + 40) { started = false; continue; }
          const py = a.Y(a.get(S[i])); if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();
      /* hover */
      if (st.hover >= 0) {
        const s = S[st.hover], px = X(xOf(s));
        ctx.strokeStyle = fg; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + ph); ctx.stroke(); ctx.globalAlpha = 1;
        for (const a of axes) { ctx.fillStyle = col[a.id]; ctx.beginPath(); ctx.arc(px, a.Y(a.get(s)), 4, 0, 6.3); ctx.fill(); }
      }
    }

    function indexAt(clientX) {
      if (!geom) return -1;
      const r = canvas.getBoundingClientRect(), x = clientX - r.left, S = st.rec.samples, view = geom.view;
      const target = view[0] + (x - geom.pad.l) / geom.pw * (view[1] - view[0]);
      let lo = 0, hi = S.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (xOf(S[mid]) < target) lo = mid + 1; else hi = mid; }
      if (lo > 0 && Math.abs(xOf(S[lo - 1]) - target) < Math.abs(xOf(S[lo]) - target)) lo--;
      return lo;
    }
    function showTip(clientX, clientY) {
      if (!tip) return;
      if (st.hover < 0) { tip.hidden = true; return; }
      const s = st.rec.samples[st.hover], r = canvas.getBoundingClientRect();
      tip.innerHTML = '<b>' + xFmt(xOf(s)) + '</b>' + (st.show.p ? '<br><i style="background:var(--c-p)"></i>P ' + s.pBar.toFixed(2) + ' bar' : '') +
        (st.show.q ? '<br><i style="background:var(--c-q)"></i>Q ' + s.qLmin.toFixed(2) + ' l/min' : '') + (st.show.v ? '<br><i style="background:var(--c-v)"></i>V ' + s.vL.toFixed(2) + ' l' : '');
      tip.hidden = false;
      const tx = clientX - r.left + 14, flip = tx + 150 > r.width;
      tip.style.left = (flip ? clientX - r.left - 150 : tx) + 'px'; tip.style.top = Math.max(4, clientY - r.top - 20) + 'px';
    }
    const xFmt = (x) => G.fmtHMS(x) + '  (' + x.toFixed(1) + ' s)';

    canvas.addEventListener('mousemove', (e) => {
      if (!st.rec || !st.rec.samples.length) return;
      if (drag && geom) {
        const dx = (e.clientX - drag.x) / geom.pw * (drag.view[1] - drag.view[0]), f = full();
        let a = drag.view[0] - dx, b = drag.view[1] - dx; const span = b - a;
        if (a < f[0]) { a = f[0]; b = a + span; } if (b > f[1]) { b = f[1]; a = b - span; }
        st.view = [a, b];
      }
      st.hover = indexAt(e.clientX); draw(); showTip(e.clientX, e.clientY);
    });
    canvas.addEventListener('mouseleave', () => { st.hover = -1; drag = null; draw(); showTip(); });
    canvas.addEventListener('mousedown', (e) => { if (geom) drag = { x: e.clientX, view: (st.view || full()).slice() }; });
    window.addEventListener('mouseup', () => { drag = null; });
    canvas.addEventListener('dblclick', () => { st.view = null; draw(); });
    canvas.addEventListener('wheel', (e) => {
      if (!geom || !st.rec) return; e.preventDefault();
      const f = full(), v = st.view || f, r = canvas.getBoundingClientRect();
      const frac = (e.clientX - r.left - geom.pad.l) / geom.pw, cx = v[0] + Math.min(1, Math.max(0, frac)) * (v[1] - v[0]);
      const k = e.deltaY < 0 ? 0.8 : 1.25; let a = cx - (cx - v[0]) * k, b = cx + (v[1] - cx) * k;
      if (b - a >= f[1] - f[0]) { st.view = null; } else { if (a < f[0]) { b += f[0] - a; a = f[0]; } if (b > f[1]) { a -= b - f[1]; b = f[1]; } st.view = [Math.max(f[0], a), b]; }
      draw();
    }, { passive: false });
    /* touch: one finger hover/pan is handled by mouse emulation; keep scrolling usable */
    canvas.style.touchAction = 'pan-y';
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener('resize', resize);

    return {
      set(patch) { Object.assign(st, patch); if (patch.rec || patch.xmode) st.view = null; draw(); },
      reset() { st.view = null; draw(); },
      redraw: draw, resize,
      get zoomed() { return !!st.view; },
    };
  };
})(window.G = window.G || {});
