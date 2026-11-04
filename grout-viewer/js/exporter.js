/* The Excel / CSV export view: drop files (or a folder, or a .zip), tick what to include, download one combined spreadsheet. */
(function (G) {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const t = (k, a) => G.t(k, a);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const X = { off: new Set(), filter: '', showAll: false, api: null, model: null };
  const LIST_LIMIT = 150, PREVIEW_ROWS = 8;

  const rowsOf = () => X.api.S.entries.filter((e) => !X.api.isUpdate(e));
  function itemOf(e) {
    if (!e._x) e._x = { st: G.stats(e.rec, 'original') };
    return { rec: e.rec, st: e._x.st, hdr: G.header(e.rec, X.api.ovOf(e)) };
  }
  const xp = () => X.api.S.opt.xp;
  const effOpt = () => { const O = X.api.S.opt.o; return xp().eff ? { density: O.density, angle: O.angle, waterDepth: O.waterDepth } : null; };

  /* the whole table for the ticked files; cols = the chosen columns */
  function compute() {
    const sel = rowsOf().filter((e) => !X.off.has(e.id));
    const full = G.exportModel(sel.map(itemOf), { eff: effOpt(), compat: xp().compat, sort: xp().sort, totals: xp().totals });
    const p = xp();
    const keys = p.colMode === 'all' ? G.exportKeys.slice() : p.colMode === 'custom' ? G.exportKeys.filter((k) => p.custom.indexOf(k) >= 0) : G.exportKeys.filter((k) => full.hasData[k]);
    X.model = Object.assign(G.exportPick(full, keys), { hasData: full.hasData, selected: sel.length });
    return X.model;
  }

  const fileName = () => G.sanitizeStem(($('#xName').value || '').trim() || 'grout-export');
  const defaultName = () => 'grout-export-' + new Date().toISOString().slice(0, 10);
  const nfiles = (n) => (n === 1 ? t('x.n1') : t('x.nn', { n }));

  /* ---------- pieces ---------- */
  function renderDrop() {
    const has = rowsOf().length > 0 || X.api.S.entries.length > 0, load = X.api.S.load;
    const d = $('#xDrop'); d.classList.toggle('compact', has);
    $('#xDropT').hidden = has; $('#xDropSub').hidden = has; $('#xDropMore').hidden = !has; $('#xHint').hidden = has;
    $('#xProg').hidden = !load; $('#xDropActions').hidden = !!load; $('#xExample').hidden = has;
    if (load) { $('#xProgBar').style.width = Math.round(100 * load.done / Math.max(1, load.total)) + '%'; $('#xProgTxt').textContent = t('x.reading', { done: load.done, total: load.total }); }
    $('#xBody').hidden = !has;
  }

  function renderFiles() {
    const all = rowsOf(), f = X.filter.trim().toLowerCase();
    const list = all.filter((e) => { if (!f) return true; const h = itemOf(e).hdr; return (h.job + ' ' + e.rec.meta.fileName).toLowerCase().indexOf(f) >= 0; });
    const shown = X.showAll ? list : list.slice(0, LIST_LIMIT);
    const rs = (e) => ((e.rec.events.find((x) => x.name === 'RecordStart') || {}).date || '');
    $('#xFilesT').textContent = t('x.files') + ' · ' + t('x.selected', { a: all.filter((e) => !X.off.has(e.id)).length, b: all.length });
    $('#xList').innerHTML = '<thead><tr><th class="c"></th><th>' + esc(t('x.h.borehole')) + '</th><th>' + esc(t('x.h.date')) + '</th><th class="r">' + esc(t('x.h.volume')) + '</th><th></th></tr></thead><tbody>' +
      shown.map((e) => {
        const it = itemOf(e), d = rs(e);
        return '<tr data-id="' + e.id + '" class="' + (X.off.has(e.id) ? 'off' : '') + '"><td class="c"><input type="checkbox" data-pick aria-label="' + esc(it.hdr.job || e.rec.meta.fileName) + '"' + (X.off.has(e.id) ? '' : ' checked') + '></td>' +
          '<td><b>' + esc(it.hdr.job || '–') + '</b><small>' + esc(e.rec.meta.fileName) + (it.st.ok && !(it.st.vol > 0) ? ' · <i class="pill">' + esc(t('x.empty')) + '</i>' : '') + '</small></td><td>' + esc(d.slice(0, 10)) + ' <small>' + esc(d.slice(11, 19)) + '</small></td><td class="r">' + esc(Number.isFinite(it.st.vol) ? String(Math.round(it.st.vol * 10) / 10) : '–') + '</td>' +
          '<td class="act"><button type="button" class="ico" data-view title="' + esc(t('x.view')) + '" aria-label="' + esc(t('x.view')) + '">⌕</button><button type="button" class="ico" data-del title="' + esc(t('x.remove')) + '" aria-label="' + esc(t('x.remove')) + '">×</button></td></tr>';
      }).join('') + '</tbody>';
    $('#xListMore').innerHTML = list.length > shown.length ? '<button type="button" class="btn small" id="xShowAll">' + esc(t('x.showall', { n: list.length })) + '</button>' : (!list.length ? '<p class="fine">' + esc(t('x.nomatch')) + '</p>' : '');
    const skipped = X.api.S.entries.filter((e) => X.api.isUpdate(e)).map((e) => ({ name: e.rec.meta.fileName, text: t('x.update') })).concat(X.api.S.skipped || []);
    $('#xSkipped').hidden = !skipped.length;
    $('#xSkipped').innerHTML = skipped.length ? '<details><summary>' + esc(t('x.skipped', { n: skipped.length })) + '</summary><ul>' + skipped.slice(0, 200).map((s) => '<li>' + (s.name ? '<b>' + esc(s.name) + '</b> — ' : '') + esc(s.text) + '</li>').join('') + '</ul></details>' : '';
  }

  function renderOutput(m) {
    const p = xp(), fmt = p.fmt, ok = m.count > 0 && m.cols.length > 0, busy = !!X.api.S.load;
    $('#xFmt').dataset.fmt = fmt; $$('#xFmt button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fmt === fmt)));
    $('#xFmtHelp').textContent = t(fmt === 'xlsx' ? 'x.fmt.xlsx.d' : 'x.fmt.csv.d');
    $('#xExt').textContent = fmt === 'xlsx' ? '.xlsx' : '.csv';
    $('#xDownload').textContent = t(fmt === 'xlsx' ? 'x.dl.xlsx' : 'x.dl.csv'); $('#xDownload').disabled = !ok || busy; $('#xCopy').disabled = !ok || busy; $('#xPdfZip').disabled = !m.count || busy;
    const vol = m.objs.reduce((n, r) => n + (Number.isFinite(r.Injected_volume) ? r.Injected_volume : 0), 0);
    $('#xSummary').innerHTML = ok ? '<b>' + esc(nfiles(m.count)) + '</b> · ' + esc(m.rows.length === 1 ? t('x.r1') : t('x.rn', { n: m.rows.length })) + ' · ' + esc(m.cols.length === 1 ? t('x.c1') : t('x.cn', { n: m.cols.length })) + '<br>' + esc(t('x.totalvol', { v: (Math.round(vol * 10) / 10).toLocaleString(G.locale()) })) : esc(t('x.nothing'));
  }

  function renderCols(m) {
    const p = xp(), chosen = new Set(m.keys), n = G.exportKeys.length;
    $('#xColsN').textContent = t('x.cols.n', { a: m.keys.length, b: n });
    $$('#xColMode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cm === p.colMode)));
    $('#xCols').innerHTML = G.exportCols.map((c) => '<label class="xc' + (m.hasData[c.k] ? '' : ' nodata') + '"><input type="checkbox" data-col="' + esc(c.k) + '"' + (chosen.has(c.k) ? ' checked' : '') + '><span>' + esc(t('xc.' + c.k)) + '</span>' + (m.hasData[c.k] ? '' : '<em>' + esc(t('x.cols.nodata')) + '</em>') + '</label>').join('');
  }

  function renderOpts() {
    const p = xp(), O = X.api.S.opt.o;
    $('#xEff').checked = !!p.eff; $('#xCompat').checked = !!p.compat; $('#xEffBox').hidden = !p.eff; $('#xDens').value = O.density; $('#xAng').value = O.angle; $('#xWat').value = O.waterDepth;
    $('#xTotals').checked = !!p.totals; $('#xSort').value = p.sort; $('#xDec').value = p.dec;
  }

  function renderPreview(m) {
    const rows = m.rows.slice(0, PREVIEW_ROWS);
    $('#xPrevInfo').textContent = m.count ? t('x.preview.n', { n: Math.min(PREVIEW_ROWS, m.rows.length) }) : '';
    const dec = xp().dec;
    const cell = (v) => esc(typeof v === 'number' ? String(v).replace('.', dec) : v);
    $('#xPrev').innerHTML = m.cols.length && rows.length ? '<thead><tr>' + m.cols.map((c) => '<th class="' + (c.t === 'text' ? '' : 'r') + '">' + esc(c.k) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r, i) => '<tr class="' + (m.total === i ? 'tot' : '') + '">' + r.map((v, ci) => '<td class="' + (m.cols[ci].t === 'text' ? '' : 'r') + '">' + cell(v) + '</td>').join('') + '</tr>').join('') + '</tbody>' : '<tbody><tr><td class="fine">' + esc(t('x.preview.none')) + '</td></tr></tbody>';
  }

  function render() {
    if (!X.api) return;
    const S = X.api.S;
    renderDrop();
    if (!S.entries.length) return;
    const m = compute();
    renderFiles(); renderOutput(m); renderCols(m); renderOpts(); renderPreview(m);
    if (!$('#xName').dataset.touched) $('#xName').value = defaultName();
  }
  /* cheaper refresh after a change that does not touch the file list */
  function refresh() { const m = compute(); renderFiles(); renderOutput(m); renderCols(m); renderPreview(m); }

  /* ---------- actions ---------- */
  function download() {
    const m = X.model || compute(); if (!m.count || !m.cols.length) return;
    const p = xp(), base = fileName(), api = X.api;
    try {
      if (p.fmt === 'xlsx') api.downloadBlob(base + '.xlsx', new Blob([G.exportXlsx(m, { sheet: t('x.sheet'), title: base })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      else api.downloadBlob(base + '.csv', new Blob([G.exportCsv(m, { dec: p.dec })], { type: 'text/csv;charset=utf-8' }));
      api.toast(t(p.fmt === 'xlsx' ? 'x.saved.xlsx' : 'x.saved.csv'));
    } catch (e) { console.error(e); api.toast(t('err.unknown') + ' ' + (e.message || '')); }
  }
  async function copy() {
    const m = X.model || compute(), text = G.exportTsv(m, { dec: xp().dec });
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (!ok) throw new Error('copy'); }
      X.api.toast(t('x.copied'));
    } catch (e) { X.api.toast(t('x.copyfail')); }
  }

  function init(api) {
    X.api = api;
    const S = api.S, root = $('#exporter');
    /* three ways to add files: drop them, click the box, or press a button */
    const drop = $('#xDrop');
    drop.addEventListener('click', (ev) => { if (!ev.target.closest('button, a, input')) api.pick(); });
    drop.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === drop) { ev.preventDefault(); api.pick(); } });
    $('#xPick').onclick = () => api.pick(); $('#xPickDir').onclick = () => api.pickDir();
    $('#xExample').onclick = () => api.samples();
    $('#xToReports').onclick = () => api.setMode('simple');
    /* body */
    root.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-id]'), id = tr && tr.dataset.id;
      if (ev.target.closest('[data-del]') && id) { api.remove(id); X.off.delete(id); return; }
      if (ev.target.closest('[data-view]') && id) { api.openReport(id); return; }
      const fb = ev.target.closest('#xFmt button'); if (fb) { xp().fmt = fb.dataset.fmt; api.save(); renderOutput(X.model || compute()); return; }
      const cm = ev.target.closest('#xColMode button'); if (cm) { xp().colMode = cm.dataset.cm; api.save(); refresh(); return; }
      if (ev.target.id === 'xShowAll') { X.showAll = true; renderFiles(); }
      if (ev.target.id === 'xSelAll') { X.off.clear(); refresh(); }
      if (ev.target.id === 'xSelNone') { rowsOf().forEach((e) => X.off.add(e.id)); refresh(); }
      if (ev.target.id === 'xClear') { api.clear(); X.off.clear(); X.filter = ''; X.showAll = false; }
      if (ev.target.id === 'xDownload') download();
      if (ev.target.id === 'xCopy') copy();
      if (ev.target.id === 'xPdfZip') api.pdfZip(rowsOf().filter((e) => !X.off.has(e.id)));
    });
    root.addEventListener('change', (ev) => {
      const el = ev.target, p = xp();
      if (el.matches('[data-pick]')) { const id = el.closest('tr').dataset.id; if (el.checked) X.off.delete(id); else X.off.add(id); refresh(); return; }
      if (el.matches('[data-col]')) {
        const cur = new Set((X.model || compute()).keys); if (el.checked) cur.add(el.dataset.col); else cur.delete(el.dataset.col);
        p.custom = G.exportKeys.filter((k) => cur.has(k)); p.colMode = 'custom'; api.save(); refresh(); return;
      }
      const set = { xEff: () => { p.eff = el.checked; }, xTotals: () => { p.totals = el.checked; }, xCompat: () => { p.compat = el.checked; }, xSort: () => { p.sort = el.value; }, xDec: () => { p.dec = el.value; },
        xDens: () => { S.opt.o.density = Math.max(0, parseFloat(el.value) || 0); }, xAng: () => { S.opt.o.angle = Math.min(90, Math.max(0, parseFloat(el.value) || 0)); }, xWat: () => { S.opt.o.waterDepth = Math.max(0, parseFloat(el.value) || 0); } }[el.id];
      if (set) { set(); api.save(); renderOpts(); refresh(); }
    });
    $('#xFilter').addEventListener('input', (ev) => { X.filter = ev.target.value; X.showAll = false; renderFiles(); });
    $('#xName').addEventListener('input', (ev) => { ev.target.dataset.touched = '1'; });
  }

  G.exporter = { init, render, X };
})(window.G = window.G || {});
