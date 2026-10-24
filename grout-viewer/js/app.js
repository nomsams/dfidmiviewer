/* Application: file intake, Simple and Advanced views, report designer, preview / print / PDF. */
(function (G) {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const t = (k, a) => G.t(k, a);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (n, d) => (Number.isFinite(n) ? n.toFixed(d == null ? 2 : d) : '-');

  const THEMES = ['auto', 'light', 'dark', 'forest', 'ocean', 'sunset', 'contrast'];
  const TABS = ['overview', 'chart', 'data', 'events', 'params', 'report', 'summary', 'export'];
  const PREF_KEY = 'groutviewer.prefs.v1';

  const S = {
    entries: [], cur: null, mode: 'simple', theme: 'auto', tab: 'overview', errors: [],
    show: { p: true, q: true, v: true }, opt: G.defaultOptions(), pageRange: '', dataPage: 0, designerPage: 0, ov: null, notices: [],
  };
  G.S = S;

  /* ---------- preferences (best effort: storage can be unavailable) ---------- */
  function deepMerge(base, extra) {
    if (!extra || typeof extra !== 'object') return base;
    for (const k of Object.keys(base)) {
      if (!(k in extra)) continue;
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) deepMerge(base[k], extra[k]);
      else if (Array.isArray(base[k])) { if (Array.isArray(extra[k])) base[k] = extra[k]; }
      else if (typeof base[k] === typeof extra[k]) base[k] = extra[k];
    }
    if ('summaryCols' in extra && Array.isArray(extra.summaryCols)) base.summaryCols = extra.summaryCols;
    return base;
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (p) { if (THEMES.includes(p.theme)) S.theme = p.theme; if (p.mode === 'advanced') S.mode = 'advanced'; if (G.LANGS[p.lang]) G.setLang(p.lang); deepMerge(S.opt, p.opt); }
    } catch (e) { /* ignore */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ theme: S.theme, mode: S.mode, lang: G.lang, opt: S.opt })); } catch (e) { /* ignore */ }
  }
  const toast = (msg) => { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { el.hidden = true; }, 3200); };

  /* ---------- records ---------- */
  const cur = () => S.entries.find((e) => e.id === S.cur) || null;
  function ovOf(e) {
    const o = {}; for (const k of Object.keys(e.ov)) if (e.ov[k] && e.ov[k].trim()) o[k] = e.ov[k];
    if (S.opt.company && !o.company) o.company = S.opt.company; return o;
  }
  const itemOf = (e) => { const hdr = G.header(e.rec, ovOf(e)), O = S.opt.o; return { rec: e.rec, st: G.stats(e.rec, S.opt.method), hdr, comment: e.comment, eff: O.sel.eff ? { off: G._o.effOffset(hdr, O), waterDepth: O.waterDepth, angle: O.angle } : null }; };
  const label = (e) => G.header(e.rec, ovOf(e)).job || e.rec.meta.fileName;
  const isUpdate = (e) => e && e.rec.meta.kind === 'update';

  function errorText(e) {
    if (e && e.code) { const m = t('err.' + e.code); return (m.startsWith('err.') ? t('err.unknown') : m) + (S.mode === 'advanced' && e.detail ? ' [' + e.detail + ']' : ''); }
    return t('err.unknown') + (e && e.message ? ' [' + e.message + ']' : '');
  }
  function addBuffer(name, buf) {
    const rec = G.parseBuffer(name, buf);
    const entry = { id: rec.id, rec, ov: {}, comment: '' };
    S.entries.push(entry); S.cur = entry.id;
    return entry;
  }
  function readFile(f) {
    if (f.arrayBuffer) return f.arrayBuffer();
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('read')); r.readAsArrayBuffer(f); });
  }
  async function addFiles(files) {
    let added = 0;
    for (const f of files) {
      try { addBuffer(f.name, await readFile(f)); added++; }
      catch (e) { S.errors.push({ name: f.name, text: errorText(e) }); }
    }
    if (added && S.mode === 'simple') S.tab = 'overview';
    render();
  }
  function loadSamples() {
    for (const s of window.GV_SAMPLES || []) { try { addBuffer(s.name, G.b64ToBuffer(s.b64)); } catch (e) { S.errors.push({ name: s.name, text: errorText(e) }); } }
    render();
  }

  /* ---------- building documents ---------- */
  function build(backend, kind, entries, layout) {
    const opt = Object.assign({}, S.opt, { lang: G.lang, layout: layout || S.opt.layout });
    const items = entries.map(itemOf);
    if (kind !== 'records') items.sort((a, b) => String((a.rec.events[0] || {}).date).localeCompare(String((b.rec.events[0] || {}).date)));
    return G.buildDocument(backend, items, opt, kind);
  }
  const pdfName = (kind, entries) => {
    if (kind === 'summary') return 'summary.pdf';
    if (entries.length === 1) { const e = entries[0]; return G.sanitizeStem(label(e) + '_' + e.rec.meta.fileName.replace(/\.(dfi|dmj|txt)$/i, '')) + '.pdf'; }
    return 'grout-reports.pdf';
  };
  function savePdf(kind, entries, layout) {
    try { const d = build(G.pdfDoc(), kind, entries, layout); const sel = parseRange(S.pageRange, d.count()); if (sel === 'bad') { toast(t('err.range')); return; }
      if (sel) for (let i = d.count() - 1; i >= 0; i--) if (sel.indexOf(i) < 0) d.raw().deletePage(i + 1);
      d.save(pdfName(kind, entries)); toast(t('toast.pdf')); }
    catch (e) { console.error(e); toast(t('err.pdf') + ' ' + (e.message || '')); }
  }
  function printDoc(kind, entries, layout) {
    const d = build(G.svgDoc(), kind, entries, layout), root = $('#printRoot');
    const sel = parseRange(S.pageRange, d.count()); if (sel === 'bad') { toast(t('err.range')); return; }
    const pages = sel ? sel.map((i) => d.pages[i]) : d.pages;
    root.innerHTML = pages.map((p) => '<div class="pgwrap' + (p.w > p.h ? ' land' : '') + '">' + p.svg() + '</div>').join('');
    /* paper orientation: set it for the whole job when all pages agree (works in every browser); mixed jobs rely on named pages */
    const land = pages.filter((p) => p.w > p.h).length, style = document.createElement('style');
    style.id = 'printPageStyle'; style.textContent = '@page { size: A4 ' + (land === pages.length ? 'landscape' : 'portrait') + '; margin: 0; }';
    document.head.appendChild(style);
    let finished = false;
    const done = () => { if (finished) return; finished = true; root.innerHTML = ''; if (style.parentNode) style.parentNode.removeChild(style); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { try { window.print(); } catch (e) { done(); } if (!('onafterprint' in window)) setTimeout(done, 2000); }, 60);
  }
  function openPreview(kind, entries, layout) {
    S.ov = { kind, entries, layout: layout || S.opt.layout };
    $('#overlay').hidden = false; document.body.style.overflow = 'hidden'; $('#ovRange').value = S.pageRange; renderPreview();
    $('#ovClose').focus();
  }
  function renderPreview() {
    const o = S.ov; if (!o) return;
    const d = build(G.svgDoc(), o.kind, o.entries, o.layout);
    $('#ovPages').innerHTML = d.pages.map((p) => p.svg()).join('');
    $('#ovTitle').textContent = (o.kind === 'summary' ? t('sum.title') : o.entries.length === 1 ? label(o.entries[0]) : t('rpt.title')) + ' · ' + d.count() + ' ' + t('pages');
    $$('#ovLay button').forEach((b) => b.classList.toggle('on', b.dataset.lay === o.layout));
  }
  function closePreview() { S.ov = null; $('#overlay').hidden = true; document.body.style.overflow = ''; $('#ovPages').innerHTML = ''; }

  /* ---------- shared UI pieces ---------- */
  let simpleChart = null, advChart = null;
  function applyI18n() {
    $$('[data-i]').forEach((el) => { el.textContent = t(el.dataset.i); });
    $$('[data-i-ph]').forEach((el) => { el.placeholder = t(el.dataset.iPh); });
    document.documentElement.lang = G.lang;
    $('#themeSel').innerHTML = THEMES.map((k) => '<option value="' + k + '"' + (k === S.theme ? ' selected' : '') + '>' + esc(t('theme.' + k)) + '</option>').join('');
    $('#langSel').innerHTML = Object.keys(G.LANGS).map((k) => '<option value="' + k + '"' + (k === G.lang ? ' selected' : '') + '>' + esc(G.LANGS[k]) + '</option>').join('');
    $('#themeSel').setAttribute('aria-label', t('ui.theme')); $('#langSel').setAttribute('aria-label', t('ui.language'));
    document.title = t('app.name');
  }

  function chipsHtml() {
    const dots = { p: 'var(--c-p)', q: 'var(--c-q)', v: 'var(--c-v)' };
    return ['p', 'q', 'v'].map((k) => '<button type="button" class="chip" data-series="' + k + '" aria-pressed="' + S.show[k] + '" style="--dot:' + dots[k] + '"><i></i>' + esc(t('cv.' + k)) + '</button>').join('');
  }
  function bindChips(box, charts) {
    box.innerHTML = chipsHtml();
    box.onclick = (ev) => {
      const b = ev.target.closest('[data-series]'); if (!b) return;
      S.show[b.dataset.series] = !S.show[b.dataset.series];
      $$('#sChips,#aChips').forEach((x) => { if (x.innerHTML) x.innerHTML = chipsHtml(); });
      charts().forEach((c) => c && c.set({ show: Object.assign({}, S.show) }));
    };
  }

  function renderNotices() {
    const e = cur(), box = $('#notices'), items = [];
    S.errors.forEach((x, i) => items.push('<div class="notice err" role="alert"><button data-dismiss="' + i + '" aria-label="' + esc(t('btn.close')) + '">×</button><b>' + esc(x.name) + '</b> — ' + esc(x.text) + '</div>'));
    if (e) e.rec.warnings.forEach((w) => { if (S.mode === 'simple' && /^(textSource|binarySource)$/.test(w)) return; items.push('<div class="notice">' + esc(t('warn.' + w)) + '</div>'); });
    box.innerHTML = items.join('');
    box.onclick = (ev) => { const b = ev.target.closest('[data-dismiss]'); if (b) { S.errors.splice(Number(b.dataset.dismiss), 1); renderNotices(); } };
  }

  function renderRecbar() {
    const bar = $('#recbar');
    bar.innerHTML = S.entries.map((e) => '<button type="button" class="chip file" data-id="' + e.id + '" aria-pressed="' + (e.id === S.cur) + '">' + esc(label(e)) + '</button>').join('') +
      '<button type="button" class="btn small" id="addMore">+ ' + esc(t('btn.addfiles')) + '</button>' +
      (S.entries.filter((e) => !isUpdate(e)).length > 1 ? '<button type="button" class="btn small" id="goSummary">' + esc(t('sum.title')) + '</button>' : '') +
      '<button type="button" class="btn small" id="clearAll">' + esc(t('btn.clear')) + '</button>';
    bar.onclick = (ev) => {
      const c = ev.target.closest('[data-id]');
      if (c) { S.cur = c.dataset.id; S.dataPage = 0; S.designerPage = 0; render(); return; }
      if (ev.target.id === 'addMore') $('#fileInput').click();
      if (ev.target.id === 'goSummary') { if (S.mode === 'simple') openPreview('summary', S.entries); else setTab('summary'); }
      if (ev.target.id === 'clearAll') { S.entries = []; S.cur = null; S.errors = []; render(); }
    };
  }

  /* ---------- SIMPLE ---------- */
  function renderSimple() {
    const e = cur(); if (!e) return;
    const upd = isUpdate(e), it = itemOf(e), st = it.st;
    $('#sTitle').textContent = upd ? e.rec.meta.fileName : it.hdr.job || e.rec.meta.fileName;
    const rs = (e.rec.events.find((x) => x.name === 'RecordStart') || {}).date || '';
    $('#sSub').textContent = upd ? t('upd.note') : [it.hdr.site, rs ? rs.slice(0, 10) + ' ' + rs.slice(11, 19) : '', it.hdr.operator].filter(Boolean).join('  ·  ');
    $$('#simple .card').forEach((c, i) => { if (i > 0) c.hidden = upd; });
    $('#sKpis').innerHTML = upd || !st.ok ? '' : [
      ['v', t('st.vol'), fmt(st.vol, 0), 'l'], ['p', t('st.avgP'), fmt(st.avgP), 'bar'], ['p', t('st.endP'), fmt(st.endP), 'bar'], ['', t('f.grouting'), G.fmtHMS(st.durMeas), ''], ['q', t('st.avgQ'), fmt(st.avgQ), 'l/min'],
    ].map((k) => '<div class="kpi ' + k[0] + '"><small>' + esc(k[1]) + '</small><b>' + esc(k[2]) + '</b><span>' + esc(k[3]) + '</span></div>').join('');
    if (upd) return;
    if (!simpleChart) simpleChart = new G.Chart($('#sChart'), $('#sTip'));
    bindChips($('#sChips'), () => [simpleChart, advChart]);
    simpleChart.set({ rec: e.rec, show: Object.assign({}, S.show), xmode: 'tt', markers: true });
    $$('input[name=sLay]').forEach((r) => { r.checked = r.value === S.opt.layout; });
    const O = S.opt.o; $('#sOrigOpts').hidden = S.opt.layout !== 'classic';
    $('#sReport').value = O.reports.time ? 'time' : O.reports.pvg ? 'pvg' : 'pvf'; $('#sFlow').checked = !!O.q.on; $('#sAuto').checked = O.axes === 'auto';
    $('#sComment').value = e.comment;
    $('#sMore').innerHTML = '<button type="button" class="btn small" id="sCsv">' + esc(t('btn.csv')) + '</button><button type="button" class="btn small" id="sAdv">' + esc(t('btn.moreopts')) + '</button>' +
      (S.entries.filter((x) => !isUpdate(x)).length > 1 ? '<button type="button" class="btn small" id="sAll">' + esc(t('btn.allpdf')) + '</button>' : '');
    $('#sMore').onclick = (ev) => {
      if (ev.target.id === 'sCsv') download(G.sanitizeStem(label(e)) + '.csv', G.samplesCsv(e.rec), 'text/csv');
      if (ev.target.id === 'sAdv') setMode('advanced');
      if (ev.target.id === 'sAll') savePdf('records', S.entries.filter((x) => !isUpdate(x)));
    };
  }

  /* ---------- ADVANCED ---------- */
  function setTab(k) { S.tab = k; renderAdvanced(); }
  function renderAdvanced() {
    const e = cur(); if (!e) return;
    $('#tabs').innerHTML = TABS.map((k) => '<button type="button" role="tab" data-tab="' + k + '" aria-selected="' + (k === S.tab) + '">' + esc(t('tab.' + k)) + '</button>').join('');
    $('#tabs').onclick = (ev) => { const b = ev.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); };
    $$('#panels .panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === S.tab));
    if (isUpdate(e) && !['overview', 'params', 'summary', 'export'].includes(S.tab)) { S.tab = 'overview'; return renderAdvanced(); }
    const fn = { overview: pOverview, chart: pChart, data: pData, events: pEvents, params: pParams, report: pReport, summary: pSummary, export: pExport }[S.tab];
    fn(e);
  }
  const panel = (k) => $('[data-panel="' + k + '"]');
  const kv = (rows) => '<dl class="kv">' + rows.filter((r) => r[1] !== undefined).map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1] === '' ? '-' : r[1]) + '</dd>').join('') + '</dl>';

  function pOverview(e) {
    const it = itemOf(e), m = e.rec.meta, h = it.hdr, st = it.st;
    const a = G.stats(e.rec, 'original'), b = G.stats(e.rec, 'weighted');
    const sp = G.setpoints(m.setConsRaw);
    const rows = st.ok ? [
      [t('st.vol') + ' (l)', fmt(a.vol, 3), fmt(b.vol, 3)], [t('st.avgP') + ' (bar)', fmt(a.avgP, 3), fmt(b.avgP, 3)], [t('st.p30') + ' (bar)', fmt(a.p30, 3), fmt(b.p30, 3)],
      [t('st.endP') + ' (bar)', fmt(a.endP, 3), fmt(b.endP, 3)], [t('st.maxP') + ' (bar)', fmt(a.maxP, 3), fmt(b.maxP, 3)],
      [t('st.avgQ') + ' (l/min)', fmt(a.avgQ, 3), fmt(b.avgQ, 3)], [t('st.q30') + ' (l/min)', fmt(a.q30, 3), fmt(b.q30, 3)], [t('st.endQ') + ' (l/min)', fmt(a.endQ, 3), fmt(b.endQ, 3)],
      [t('st.maxQ') + ' (l/min)', fmt(a.maxQ, 3), fmt(b.maxQ, 3)], [t('f.grouting'), G.fmtHMS(a.durMeas) + ' (' + fmt(a.durMeas, 1) + ' s)', G.fmtHMS(b.durMeas) + ' (' + fmt(b.durMeas, 1) + ' s)'],
      [t('f.total'), G.fmtHMS(a.durTotal), G.fmtHMS(b.durTotal)], [t('st.gin') + ' (bar·l)', fmt(a.gin, 2), fmt(b.gin, 2)], [t('st.restarts'), String(a.reprises), String(b.reprises)], [t('st.stop'), a.stopType || '-', b.stopType || '-'],
    ] : [];
    panel('overview').innerHTML = '<div class="cmp ov"><div class="card"><h3>' + esc(t('ov.file')) + '</h3><br>' + kv([
      [t('ov.name'), m.fileName], [t('ov.size'), (m.size / 1024).toFixed(1) + ' kB'], [t('ov.source'), m.source === 'binary' ? t('src.binary') : m.source === 'text' ? t('src.text') : '-'], [t('ov.software'), m.softVersion],
      [t('ov.process'), m.infoProc], [t('f.site'), h.site], [t('f.contract'), h.contract], [t('f.borehole'), h.job], [t('f.operator'), h.operator], [t('f.grout'), h.grout],
      [t('app.samples'), String(e.rec.samples.length)], [t('set.pmax'), sp.pressureLimitBar != null ? fmt(sp.pressureLimitBar) + ' bar' : '-'], [t('set.vmax'), sp.volumeLimitL != null ? fmt(sp.volumeLimitL, 0) + ' l' : '-'], [t('set.safety'), sp.safetyBar != null ? fmt(sp.safetyBar) + ' bar' : '-'],
    ]) + '</div>' + (st.ok ? '<div class="card"><h3>' + esc(t('ov.results')) + '</h3><br><div class="scroll"><table class="t"><thead><tr><th></th><th class="r">' + esc(t('calc.short.original')) + (S.opt.method === 'original' ? ' ✓' : '') + '</th><th class="r">' + esc(t('calc.short.weighted')) + (S.opt.method === 'weighted' ? ' ✓' : '') + '</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td class="r">' + esc(r[1]) + '</td><td class="r">' + esc(r[2]) + '</td></tr>').join('') + '</tbody></table></div><p class="fine" style="margin-top:10px">' + esc(t('calc.explain')) + '</p></div>' : '') + '</div>';
  }

  /* interactive chart axes: automatic, or manual maxima (an empty box keeps that axis automatic) */
  function axisState() {
    const num = (id) => { const v = parseFloat($(id).value); return v > 0 ? v : 0; };
    return { axisMode: $('#aAxis').value, maxes: { p: num('#aMaxP'), q: num('#aMaxQ'), v: num('#aMaxV') } };
  }
  function pChart(e) {
    if (!advChart) {
      advChart = new G.Chart($('#aChart'), $('#aTip'));
      $('#aTime').onchange = (ev) => advChart.set({ xmode: ev.target.value });
      $('#aWin').onchange = (ev) => advChart.set({ windows: ev.target.checked });
      $('#aMark').onchange = (ev) => advChart.set({ markers: ev.target.checked });
      $('#aReset').onclick = () => advChart.reset();
      const axisSet = () => advChart.set(axisState());
      ['#aAxis', '#aMaxP', '#aMaxQ', '#aMaxV'].forEach((sel) => { $(sel).onchange = axisSet; $(sel).oninput = axisSet; });
    }
    bindChips($('#aChips'), () => [simpleChart, advChart]);
    advChart.set(Object.assign({ rec: e.rec, show: Object.assign({}, S.show), xmode: $('#aTime').value, windows: $('#aWin').checked, markers: $('#aMark').checked }, axisState()));
    requestAnimationFrame(() => advChart.resize());
  }

  function pData(e) {
    const S_ = e.rec.samples, per = 500, pages = Math.max(1, Math.ceil(S_.length / per)); S.dataPage = Math.min(S.dataPage, pages - 1);
    const from = S.dataPage * per, rows = S_.slice(from, from + per);
    const extra = e.rec.meta.channels.filter((c) => !Object.values(G.CH).includes(c));
    panel('data').innerHTML = '<div class="card"><div class="card-h"><h3>' + esc(t('tab.data')) + ' — ' + S_.length + ' ' + esc(t('ov.samples')) + '</h3><div class="row small">' +
      '<button class="btn small" data-pg="-1"' + (S.dataPage ? '' : ' disabled') + '>‹</button><span>' + (S.dataPage + 1) + ' / ' + pages + '</span><button class="btn small" data-pg="1"' + (S.dataPage < pages - 1 ? '' : ' disabled') + '>›</button></div></div>' +
      '<div class="scroll"><table class="t"><thead><tr><th class="r">#</th><th class="r">t tot (s)</th><th class="r">t meas (s)</th><th class="r">P (bar)</th><th class="r">Q (l/min)</th><th class="r">V (l)</th>' + extra.map((c) => '<th class="r">' + c + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((s, i) => '<tr><td class="r">' + (from + i) + '</td><td class="r">' + s.tt.toFixed(2) + '</td><td class="r">' + s.tm.toFixed(2) + '</td><td class="r">' + s.pBar.toFixed(3) + '</td><td class="r">' + s.qLmin.toFixed(3) + '</td><td class="r">' + s.vL.toFixed(3) + '</td>' + extra.map((c) => '<td class="r">' + s.extra[c] + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>';
    panel('data').onclick = (ev) => { const b = ev.target.closest('[data-pg]'); if (b) { S.dataPage += Number(b.dataset.pg); pData(e); } };
  }

  function pEvents(e) {
    const w = G.windows(e.rec), S_ = e.rec.samples;
    panel('events').innerHTML = '<div class="card"><h3>' + esc(t('app.events')) + '</h3><br><div class="scroll"><table class="t"><thead><tr><th>' + esc(t('app.events')) + '</th><th>' + esc(t('app.data')) + '</th><th>' + esc(t('app.when')) + '</th><th class="r">#</th><th class="r">t tot (s)</th></tr></thead><tbody>' +
      e.rec.events.map((x) => '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.data || '-') + '</td><td>' + esc(x.date || '-') + '</td><td class="r">' + x.idx + '</td><td class="r">' + (S_[x.idx] ? S_[x.idx].tt.toFixed(2) : '-') + '</td></tr>').join('') + '</tbody></table></div></div>' +
      (w.length ? '<div class="card"><h3>' + esc(t('ev.windows')) + '</h3><br><table class="t"><thead><tr><th>#</th><th>' + esc(t('f.start')) + '</th><th>' + esc(t('f.end')) + '</th><th class="r">' + esc(t('f.grouting')) + ' (s)</th><th class="r">V (l)</th></tr></thead><tbody>' +
        w.map((x, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(x.start.date) + '</td><td>' + esc(x.stop.date) + '</td><td class="r">' + (S_[x.b].tm - S_[x.a].tm).toFixed(2) + '</td><td class="r">' + (S_[x.b].vL - S_[x.a].vL).toFixed(3) + '</td></tr>').join('') + '</tbody></table></div>' : '');
  }

  function pParams(e) {
    const m = e.rec.meta, rows = Object.entries(m.params);
    panel('params').innerHTML = '<div class="cmp"><div class="card"><h3>' + esc(t('app.params')) + '</h3><br><div class="scroll"><table class="t"><tbody>' + rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(String(r[1]).trim() || '-') + '</td></tr>').join('') + '</tbody></table></div></div>' +
      '<div class="card"><h3>' + esc(t('pr.channels')) + '</h3><br><table class="t"><tbody>' + m.channels.map((c, i) => '<tr><td>' + c + '</td><td>' + esc(m.units[i] || '-') + '</td></tr>').join('') + '</tbody></table><br>' +
      kv([['SetCons', m.setConsRaw], ['Gin', m.ginRaw], ['Trig', m.trig], ['Trig step (s)', Number.isFinite(m.trigStep) ? String(m.trigStep) : '']]) + '</div></div>';
  }

  /* Report designer: static form bound to the options object */
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  function setPath(o, p, v) { const ks = p.split('.'), last = ks.pop(); const tgt = ks.reduce((a, k) => a[k], o); tgt[last] = v; }
  function syncDesigner() {
    const e = cur(); if (!e) return;
    $$('#designer [data-opt]').forEach((el) => {
      const v = getPath(S.opt, el.dataset.opt);
      if (el.type === 'checkbox') el.checked = !!v; else if (el.type === 'number') el.value = v ? v : ''; else el.value = v == null ? '' : v;
    });
    $$('#designer [data-ov]').forEach((el) => { el.value = e.ov[el.dataset.ov] || ''; el.placeholder = String(({ site: e.rec.meta.jobSite, contract: e.rec.meta.contract, job: e.rec.meta.jobName, operator: e.rec.meta.operator, grout: e.rec.meta.groutName })[el.dataset.ov] || ''); });
    $('#designer [data-ov-comment]').value = e.comment;
    $$('#designer input[name=dLay]').forEach((r) => { r.checked = r.value === S.opt.layout; });
  }
  let previewTimer = 0;
  function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderDesignerPreview, 160); }
  function renderDesignerPreview() {
    const e = cur(); if (!e || S.tab !== 'report' || isUpdate(e)) return;
    try {
      const d = build(G.svgDoc(), 'records', [e]); S.designerPage = Math.min(S.designerPage, d.count() - 1);
      $('#dSheet').innerHTML = d.pages[S.designerPage].svg(); $('#dPage').textContent = (S.designerPage + 1) + ' / ' + d.count();
    } catch (err) { console.error(err); $('#dSheet').textContent = String(err.message || err); }
  }
  function pReport() { syncDesigner(); renderDesignerPreview(); }
  function bindDesigner() {
    const form = $('#designer');
    const apply = (el) => {
      const e = cur();
      if (el.name === 'dLay') { S.opt.layout = el.value; }
      else if (el.dataset.opt) {
        let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
        if (el.dataset.opt === 'visaCount') v = Number(v);
        setPath(S.opt, el.dataset.opt, v);
      } else if (el.dataset.ov && e) e.ov[el.dataset.ov] = el.value;
      else if (el.hasAttribute('data-ov-comment') && e) e.comment = el.value;
      savePrefs(); schedulePreview();
    };
    form.addEventListener('input', (ev) => apply(ev.target)); form.addEventListener('change', (ev) => apply(ev.target));
    $('#logoFile').onchange = (ev) => {
      const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
      if (f.size > 4e6) { toast(t('err.logo')); return; }
      const fr = new FileReader();
      fr.onerror = () => toast(t('err.logo'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => toast(t('err.logo'));
        img.onload = () => {
          try {
            const k = Math.min(1, 500 / Math.max(img.width, img.height, 1)), c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            S.opt.o.logo = c.toDataURL('image/png'); S.opt.o.logoW = c.width; S.opt.o.logoH = c.height; savePrefs(); schedulePreview();
          } catch (e) { toast(t('err.logo')); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(f);
    };
    $('#logoClear').onclick = () => { S.opt.o.logo = ''; S.opt.o.logoW = S.opt.o.logoH = 0; savePrefs(); schedulePreview(); };
    $('#dReset').onclick = () => { const keep = S.opt.summaryCols; S.opt = G.defaultOptions(); S.opt.summaryCols = keep; savePrefs(); syncDesigner(); renderDesignerPreview(); };
    $('#dPrev').onclick = () => { S.designerPage = Math.max(0, S.designerPage - 1); renderDesignerPreview(); };
    $('#dNext').onclick = () => { S.designerPage++; renderDesignerPreview(); };
    $('#dPrint').onclick = () => printDoc('records', [cur()]);
    $('#dPdf').onclick = () => savePdf('records', [cur()]);
  }

  /* Summary table = the original's "Multicriteria report": selection criteria, sort order, daily and grand totals. */
  function pSummary() {
    const list = S.entries.filter((e) => !isUpdate(e)), cols = S.opt.summaryCols && S.opt.summaryCols.length ? S.opt.summaryCols : G.DEFAULT_SUMMARY, mc = S.opt.mc;
    const all = list.map(itemOf), items = G.selectItems(all, mc), right = (k) => /^(vol|avg|p30|endP|q30|endQ|gin|restarts)/.test(k);
    const num = (k, lab) => '<label class="f"><span>' + esc(lab) + '</span><input type="number" min="0" step="any" data-mc="' + k + '" value="' + (mc[k] > 0 ? mc[k] : '') + '" placeholder="-"></label>';
    const txt = (k, lab, type) => '<label class="f"><span>' + esc(lab) + '</span><input type="' + (type || 'text') + '" data-mc="' + k + '" value="' + esc(mc[k] || '') + '"></label>';
    const sel = (k, lab, opts) => '<label class="f"><span>' + esc(lab) + '</span><select data-mc="' + k + '">' + opts.map((o) => '<option value="' + o[0] + '"' + (String(mc[k]) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>';
    const chk = (k, lab) => '<label class="chk"><input type="checkbox" data-mc="' + k + '"' + (mc[k] ? ' checked' : '') + '> <span>' + esc(lab) + '</span></label>';
    const modes = [['avg', t('st.avgP').replace(/ .*/, '') + ' Ø'], ['30s', '30 s'], ['final', t('st.endP').split(' ')[0]]];
    const rows = G.summaryRows(items, cols, mc);
    panel('summary').innerHTML = '<div class="card"><div class="card-h"><h3>' + esc(t('mc.title')) + ' — ' + items.length + ' / ' + all.length + ' ' + esc(t('sum.holes')) + '</h3><div class="row small"><button class="btn small" id="smPrev">' + esc(t('btn.preview')) + '</button><button class="btn small" id="smPrint">' + esc(t('btn.print')) + '</button><button class="btn small primary" id="smPdf">' + esc(t('btn.pdf')) + '</button><button class="btn small" id="smCsv">' + esc(t('btn.bilancsv')) + '</button></div></div>' +
      '<details class="note"' + (Object.keys(mc).some((k) => /^(pMin|pMax|qMin|qMax|stop|pump|dateFrom|dateTo)$/.test(k) && mc[k]) || mc.hMin > 0 || (mc.hMax > 0 && mc.hMax < 24) ? ' open' : '') + '><summary>' + esc(t('mc.filters')) + '</summary><div class="grid2 mcgrid" style="margin:10px 0">' +
      sel('pMode', t('mc.pmode'), [['avg', t('st.avgP')], ['30s', t('st.p30')], ['final', t('st.endP')]]) + sel('qMode', t('mc.qmode'), [['avg', t('st.avgQ')], ['30s', t('st.q30')], ['final', t('st.endQ')]]) +
      num('pMin', t('mc.pmin')) + num('pMax', t('mc.pmax')) + num('qMin', t('mc.qmin')) + num('qMax', t('mc.qmax')) + num('hMin', t('mc.hmin')) + num('hMax', t('mc.hmax')) +
      txt('dateFrom', t('mc.datefrom'), 'date') + txt('dateTo', t('mc.dateto'), 'date') + txt('stop', t('mc.stop')) + txt('pump', t('mc.pump')) +
      sel('sort', t('mc.sort'), [['date', t('f.date')], ['hole', t('f.borehole')], ['vol', t('st.vol')], ['avgP', t('st.avgP')]]) + '<div>' + chk('asc', t('mc.asc')) + chk('daily', t('mc.daily')) + '</div>' +
      '</div></details>' +
      '<div class="scroll"><table class="t"><thead><tr>' + cols.map((k) => '<th' + (right(k) ? ' class="r"' : '') + '>' + esc(G.summaryLabel(k)) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r) => (r.span !== undefined ? '<tr class="sub"><td colspan="' + cols.length + '"><b>' + esc(r.span) + '</b></td></tr>' : '<tr>' + r.map((c, i) => '<td' + (right(cols[i]) ? ' class="r"' : '') + '>' + esc(c) + '</td>').join('') + '</tr>')).join('') + '</tbody></table></div>' +
      '<p class="fine" style="margin:10px 0">' + (items.length ? esc(t('mc.totalv')) + ': <b>' + fmt(items.reduce((n, i) => n + (i.st.vol || 0), 0), 0) + ' l</b> · ' + esc(t('mc.totaln')) + ': <b>' + items.length + '</b> · ' + esc(t('mc.totaldur')) + ': <b>' + G.fmtHMS(items.reduce((n, i) => n + (i.st.durMeas || 0), 0)) + '</b>' : esc(t('mc.none'))) + '</p>' +
      '<details class="note"><summary>' + esc(t('sum.columns')) + '</summary><div class="grid2" style="margin-top:10px">' + G.SUMMARY_FIELDS.map((k) => '<label class="chk"><input type="checkbox" data-col="' + k + '"' + (cols.includes(k) ? ' checked' : '') + '> ' + esc(G.summaryLabel(k)) + '</label>').join('') + '</div></details></div>';
    const p = panel('summary');
    p.onclick = (ev) => {
      const id = ev.target.id;
      if (id === 'smPrev') openPreview('summary', list); if (id === 'smPrint') printDoc('summary', list); if (id === 'smPdf') savePdf('summary', list);
      if (id === 'smCsv') download('bilan.csv', G.bilanCsv(items), 'text/csv');
    };
    p.onchange = (ev) => {
      const el = ev.target;
      if (el.dataset.col) { S.opt.summaryCols = G.SUMMARY_FIELDS.filter((k) => $('[data-col="' + k + '"]', p).checked); savePrefs(); pSummary(); return; }
      const k = el.dataset.mc; if (!k) return;
      mc[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (parseFloat(el.value) > 0 ? parseFloat(el.value) : 0) : el.value;
      if (k === 'hMax' && !(mc.hMax > 0)) mc.hMax = 24;
      savePrefs(); pSummary();
    };
  }

  function pExport(e) {
    const list = S.entries.filter((x) => !isUpdate(x)), dis = list.length ? '' : ' disabled';
    panel('export').innerHTML = '<div class="cmp"><div class="card"><h3>' + esc(t('ex.this')) + '</h3><br><div class="row"><button class="btn" id="xCsv">' + esc(t('btn.csv')) + '</button><button class="btn" id="xPdf">' + esc(t('btn.pdf')) + '</button><button class="btn" id="xPdfM">' + esc(t('btn.pdfmodern')) + '</button><button class="btn" id="xPdfC">' + esc(t('btn.pdfclassic')) + '</button><button class="btn" id="xJpg">' + esc(t('ex.jpeg')) + '</button><button class="btn" id="xPng">' + esc(t('ex.png')) + '</button></div></div>' +
      '<div class="card"><h3>' + esc(t('ex.all')) + '</h3><br><div class="row"><button class="btn" id="xAllPdf"' + dis + '>' + esc(t('btn.allpdf')) + '</button><button class="btn" id="xZipPdf"' + dis + '>' + esc(t('ex.zip')) + '</button><button class="btn" id="xSumPdf"' + dis + '>' + esc(t('btn.sumpdf')) + '</button><button class="btn" id="xBoth"' + dis + '>' + esc(t('btn.bothpdf')) + '</button><button class="btn" id="xBilan"' + dis + '>' + esc(t('btn.bilancsv')) + '</button><button class="btn" id="xJpgAll"' + dis + '>' + esc(t('ex.jpegall')) + '</button></div></div>' +
      '<div class="card"><h3>' + esc(t('ex.options')) + '</h3><br><label class="f"><span>' + esc(t('ex.range')) + '</span><input type="text" id="xRange" value="' + esc(S.pageRange) + '" placeholder="' + esc(t('ex.range.ph')) + '"></label>' +
      '<label class="f"><span>' + esc(t('ex.dpi')) + '</span><select id="xDpi"><option value="150">150 dpi</option><option value="300" selected>300 dpi</option><option value="600">600 dpi</option></select></label><p class="fine">' + esc(t('ex.hint')) + '</p></div></div>';
    const p = panel('export');
    p.oninput = (ev) => { if (ev.target.id === 'xRange') S.pageRange = ev.target.value; };
    p.onclick = (ev) => {
      const id = ev.target.id, dpi = parseInt($('#xDpi').value, 10) || 300;
      if (id === 'xCsv') download(G.sanitizeStem(label(e)) + '.csv', G.samplesCsv(e.rec), 'text/csv');
      if (id === 'xPdf') savePdf('records', [e]); if (id === 'xPdfM') savePdf('records', [e], 'modern'); if (id === 'xPdfC') savePdf('records', [e], 'classic');
      if (id === 'xAllPdf') savePdf('records', list); if (id === 'xSumPdf') savePdf('summary', list); if (id === 'xZipPdf') exportZipPdfs(list);
      if (id === 'xBoth') { const d = build(G.pdfDoc(), 'both', list); d.save('grout-reports-and-summary.pdf'); }
      if (id === 'xBilan') download('bilan.csv', G.bilanCsv(G.selectItems(list.map(itemOf), S.opt.mc)), 'text/csv');
      if (id === 'xPng') exportJpegZip('records', [e], dpi, undefined, 'png'); if (id === 'xJpg') exportJpegZip('records', [e], dpi); if (id === 'xJpgAll') exportJpegZip('records', list, dpi);
    };
  }

  /* ---- page selection and the LutzPDF-style outputs (PDF per document, JPEG pages) ---- */
  const parseRange = G.parseRange; // shared helper (js/zip.js)
  function downloadBlob(name, blob) {
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function pdfBytes(entries) { const d = build(G.pdfDoc(), 'records', entries); return new Uint8Array(d.raw().output('arraybuffer')); }
  /* "1 file per document (PDF printing)": one PDF per loaded file, in one ZIP */
  function exportZipPdfs(entries) {
    try {
      const files = entries.map((e) => ({ name: pdfName('records', [e]), data: pdfBytes([e]) }));
      downloadBlob('grout-reports.zip', new Blob([G.zip(files)], { type: 'application/zip' })); toast(t('toast.zip'));
    } catch (e) { console.error(e); toast(t('err.pdf') + ' ' + (e.message || '')); }
  }
  const loadImage = (url) => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('image')); im.src = url; });
  /* every page as a JPEG (quality 75, like the original's 300 dpi JPEG output), all in one ZIP */
  async function exportJpegZip(kind, entries, dpi, layout, fmt) {
    const png = fmt === 'png';
    try {
      const d = build(G.svgDoc(), kind, entries, layout), sel = parseRange(S.pageRange, d.count());
      if (sel === 'bad') { toast(t('err.range')); return; }
      const idx = sel || d.pages.map((_, i) => i), files = [], base = G.sanitizeStem(entries.length === 1 ? label(entries[0]) : 'grout-reports');
      for (const i of idx) {
        const p = d.pages[i], w = Math.round(p.w / 25.4 * dpi), h = Math.round(p.h / 25.4 * dpi), url = URL.createObjectURL(new Blob([p.svg()], { type: 'image/svg+xml;charset=utf-8' }));
        try {
          const img = await loadImage(url), c = document.createElement('canvas'); c.width = w; c.height = h;
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
          const blob = await new Promise((r) => png ? c.toBlob(r, 'image/png') : c.toBlob(r, 'image/jpeg', 0.75)); if (!blob) throw new Error('jpeg');
          files.push({ name: base + '-' + String(i + 1).padStart(2, '0') + (png ? '.png' : '.jpg'), data: new Uint8Array(await readFile(blob)) });
        } finally { URL.revokeObjectURL(url); }
      }
      downloadBlob(base + (png ? '-png.zip' : '-jpeg.zip'), new Blob([G.zip(files)], { type: 'application/zip' })); toast(t('toast.zip'));
    } catch (e) { console.error(e); toast(t('err.jpeg')); }
  }

  function download(name, text, type) {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------- top level ---------- */
  function setMode(m) { S.mode = m; savePrefs(); render(); }
  function render() {
    const has = S.entries.length > 0;
    $('#welcome').hidden = has; $('#workspace').hidden = !has;
    document.body.dataset.mode = S.mode;
    $$('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    $('#simple').hidden = S.mode !== 'simple'; $('#advanced').hidden = S.mode !== 'advanced';
    if (!has) { renderNoticesOnly(); return; }
    renderRecbar(); renderNotices();
    if (S.mode === 'simple') renderSimple(); else renderAdvanced();
  }
  function renderNoticesOnly() {
    $('#notices').innerHTML = ''; // errors on the welcome screen appear in a toast
    if (S.errors.length) { toast(S.errors.map((x) => x.name + ': ' + x.text).join(' | ')); S.errors = []; }
  }

  function supported() {
    try {
      return !!(window.Map && window.Promise && window.TextDecoder && window.Blob && window.URL && window.jspdf && window.jspdf.jsPDF && Array.prototype.includes && Object.assign && document.createElement('canvas').getContext);
    } catch (e) { return false; }
  }
  function init() {
    if (!supported()) { const w = document.getElementById('welcome'); if (w) w.innerHTML = '<div class="drop"><h1>' + G.t('app.name') + '</h1><p>' + G.t('err.browser') + '</p></div>'; return; }
    loadPrefs();
    if (!G.LANGS[G.lang]) G.setLang('en');
    document.body.dataset.theme = S.theme;
    applyI18n(); bindDesigner();
    $('#modeSeg').onclick = (ev) => { const b = ev.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); };
    $('#themeSel').onchange = (ev) => { S.theme = ev.target.value; document.body.dataset.theme = S.theme; savePrefs(); [simpleChart, advChart].forEach((c) => c && c.redraw()); };
    $('#langSel').onchange = (ev) => { G.setLang(ev.target.value); savePrefs(); applyI18n(); render(); if (S.ov) renderPreview(); };
    $('#pickBtn').onclick = () => $('#fileInput').click();
    $('#sampleBtn').onclick = loadSamples;
    $('#fileInput').onchange = (ev) => { addFiles(Array.from(ev.target.files)); ev.target.value = ''; };
    const drop = $('#drop');
    drop.onclick = (ev) => { if (!ev.target.closest('button')) $('#fileInput').click(); };
    drop.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#fileInput').click(); } };
    window.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('over'); });
    window.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget) drop.classList.remove('over'); });
    window.addEventListener('drop', (ev) => { ev.preventDefault(); drop.classList.remove('over'); if (ev.dataTransfer && ev.dataTransfer.files.length) addFiles(Array.from(ev.dataTransfer.files)); });

    /* simple actions */
    $$('input[name=sLay]').forEach((r) => { r.onchange = () => { S.opt.layout = r.value; savePrefs(); $('#sOrigOpts').hidden = r.value !== 'classic'; }; });
    $('#sReport').onchange = (ev) => { const o = S.opt.o.reports; o.time = o.pvg = o.pvf = false; o[ev.target.value] = true; savePrefs(); };
    $('#sFlow').onchange = (ev) => { S.opt.o.q.on = ev.target.checked; savePrefs(); };
    $('#sAuto').onchange = (ev) => { S.opt.o.axes = ev.target.checked ? 'auto' : 'manual'; savePrefs(); };
    $('#sComment').oninput = (ev) => { const e = cur(); if (e) e.comment = ev.target.value; };
    $('#sPrint').onclick = () => printDoc('records', [cur()]);
    $('#sPdf').onclick = () => savePdf('records', [cur()]);
    $('#sPreview').onclick = () => openPreview('records', [cur()]);
    /* overlay */
    $('#ovClose').onclick = closePreview;
    $('#ovRange').oninput = (ev) => { S.pageRange = ev.target.value; };
    $('#ovPng').onclick = () => { const o = S.ov; if (o) exportJpegZip(o.kind, o.entries, 300, o.layout, 'png'); };
    $('#ovJpg').onclick = () => { const o = S.ov; if (o) exportJpegZip(o.kind, o.entries, 300, o.layout); };
    $('#ovPrint').onclick = () => { const o = S.ov; if (o) printDoc(o.kind, o.entries, o.layout); };
    $('#ovPdf').onclick = () => { const o = S.ov; if (o) savePdf(o.kind, o.entries, o.layout); };
    $('#ovLay').onclick = (ev) => { const b = ev.target.closest('[data-lay]'); if (b && S.ov) { S.ov.layout = b.dataset.lay; renderPreview(); } };
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.ov) closePreview(); });
    render();
    if (location.hash === '#demo') loadSamples();
  }

  G.app = { S, addBuffer, render, openPreview, savePdf, build };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.G = window.G || {});
