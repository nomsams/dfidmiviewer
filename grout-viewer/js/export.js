/*[[[[[[[[['Head_loss', 'dec']Dry_weights', 'dec']End_flowrate', 'dec']30s_flowrate', 'dec']Average_flowrate', 'dec']End_pressure', 'dec']30s_pressure', 'dec']Average_pressure', 'dec']Injected_volume', 'dec']The "Export" table: one row per measurement file with the columns of the original program's Site > Export (field separator ";"),
   written either as a native Excel workbook or as the same semicolon CSV. Rows are typed (text / whole number / decimal). */
(function (G) {
  'use strict';
  const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
  /* key and type: text | int (whole number) | dec (two decimals) | num (as it is). The file header always uses the original column names. */
  const COLS = [
    ['Start_date', 'text'], ['Borehole', 'text'], ['Fan', 'text'], ['Sleeve', 'int'], ['Regrout', 'int'], ['Grout', 'int'], ['Zone', 'text'],
    ['X_coord', 'num'], ['Y_coord', 'num'], ['Pump', 'text'], ['Start_time', 'text'], ['End_time', 'text'], ['Total_duration', 'text'], ['Grouting_duration', 'text'],
    ['Top_level', 'num'], ['Bottom_level', 'num'], ['Injected_volume', 'num'], ['Average_pressure', 'num'], ['30s_pressure', 'num'], ['End_pressure', 'num'],
    ['Average_flowrate', 'num'], ['30s_flowrate', 'num'], ['End_flowrate', 'num'], ['Stop_type', 'text'], ['Dry_weights', 'num'], ['Coeff_Headloss', 'num'],
    ['Head_loss', 'num'], ['Water_depth', 'num'], ['Inclination', 'num'],
  ].map(([k, t], i) => ({ k, t, i }));
  const KEYS = COLS.map((c) => c.k);

  const r2 = (x) => (isNum(x) ? Math.round((x + Number.EPSILON) * 100) / 100 : '');
  const pn = (s) => { const n = G.parseNumber(s); return isNum(n) ? n : NaN; };
  const hms = (sec) => (isNum(sec) ? G.fmtHMS(Math.max(0, sec)) : ''); // whole seconds are cut, not rounded, as in the original

  /* The original program averages pressures from a table that holds them in tenths of a bar: every reading is rounded to 0.1 bar (halves to the
     even digit, as .NET does) before the mean is taken. Its 30 s value is not the plain last 30 readings; across 83 real exports the mean of the 29
     readings that precede the final record reproduces it far more often (see RE-NOTES), and its grout-column offset there is 9.81 m/s2 based (0.0981 bar
     per metre of water) where the mean uses 0.1 bar per metre. With few readings everything before the last one is used. */
  const tenth = (p) => { const y = p * 10, r = Math.round(y); return (Math.abs(Math.abs(y) % 1 - 0.5) < 1e-9 && r % 2 ? r - 1 : r) / 10; };
  function tablePressures(S) {
    const N = S.length; if (!N) return { avg: NaN, p30: NaN };
    const q = S.map((s) => tenth(s.pBar)), mean = (a, b) => { let t = 0; for (let i = a; i < b; i++) t += q[i]; return t / (b - a); };
    const avg = mean(0, N), e = N - 1, a = Math.max(0, e - 29);
    return { avg, p30: e > a ? mean(a, e) : avg };
  }

  /* One typed row (object by column key). o: { eff: { density, angle, waterDepth } to add the grout column pressure like the original (or null), groutIdx: { name: n }, compat: true to average pressures like the original } */
  function exportRow(item, o) {
    o = o || {};
    const rec = item.rec, st = item.st || {}, hdr = item.hdr || {};
    const rs = (rec.events.find((e) => e.name === 'RecordStart') || {}).date || '', re = ([...rec.events].reverse().find((e) => e.name === 'RecordStop') || {}).date || '';
    const top = pn(hdr.top), bot = pn(hdr.bottom);
    /* level defaults of the original's import: 1 m when the file carries none */
    const topL = isNum(top) ? top : 1, botL = isNum(bot) ? bot : 1;
    const hl = (() => { const v = pn(rec.meta.headLoss); return isNum(v) && v > 0 ? r2(v / 1e5) : 0; })(); // the file stores it in Pa; the export in bar
    const off = o.eff ? G._o.effOffset({ top: String(topL), bottom: String(botL) }, o.eff) : 0;
    const gname = (hdr.grout || '').trim(), gidx = o.groutIdx && gname ? o.groutIdx[gname.toLowerCase()] : 1;
    const tp = o.compat ? tablePressures(rec.samples) : null, avgP = tp ? tp.avg : st.avgP, p30 = tp ? tp.p30 : st.p30;
    const press = (v, add) => (isNum(v) ? Math.max(0, r2(v + (add || 0) - hl)) : '');
    const vol = r2(st.vol);
    const sleeve = parseInt(hdr.sleeve, 10);
    return {
      Start_date: rs.slice(0, 10), Borehole: hdr.job || '', Fan: hdr.fan || '', Sleeve: Number.isFinite(sleeve) ? sleeve : 1, Regrout: 1, Grout: gidx || 1, Zone: hdr.zone || '',
      X_coord: 0, Y_coord: 0, Pump: hdr.pump || 'P1', Start_time: rs.slice(11, 19), End_time: re.slice(11, 19),
      Total_duration: hms(st.durTotal), Grouting_duration: hms(st.durMeas), Top_level: r2(topL), Bottom_level: r2(botL), Injected_volume: vol,
      Average_pressure: press(avgP, off), '30s_pressure': press(p30, o.compat ? off * 0.981 : off), End_pressure: press(st.endP, 0),
      Average_flowrate: isNum(st.avgQ) ? r2(st.avgQ) : 0, '30s_flowrate': r2(st.q30), End_flowrate: r2(st.endQ), Stop_type: st.stopType || 'Manu_Operator', // a record with no stop event is a manual stop by the operator; no grouting time gives a flow of 0
      Dry_weights: vol, Coeff_Headloss: 0, Head_loss: hl, Water_depth: 0, Inclination: '',
    };
  }

  /* items: [{ rec, st, hdr }]. o: { eff: { density, angle, waterDepth } or null, compat, sort: 'date' | 'name' | 'none', totals }. */
  function exportModel(items, o) {
    o = o || {};
    const list = items.slice();
    const startOf = (i) => ((i.rec.events.find((e) => e.name === 'RecordStart') || {}).date || '');
    const nameOf = (i) => (i.hdr.job || i.rec.meta.fileName || '');
    if (o.sort === 'date') list.sort((a, b) => startOf(a).localeCompare(startOf(b)) || nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }));
    else if (o.sort === 'name') list.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }) || startOf(a).localeCompare(startOf(b)));
    /* grout numbers in order of first appearance, like the grout table of the original */
    const groutIdx = {}; let n = 0;
    list.forEach((i) => { const g = (i.hdr.grout || '').trim().toLowerCase(); if (g && !groutIdx[g]) groutIdx[g] = ++n; });
    const objs = list.map((i) => exportRow(i, { eff: o.eff || null, groutIdx, compat: !!o.compat }));
    const hasData = {};
    KEYS.forEach((k) => { hasData[k] = objs.some((r) => r[k] !== '' && r[k] !== null && r[k] !== undefined); });
    const keys = KEYS.slice(), cols = COLS.slice();
    const rows = objs.map((r) => keys.map((k) => r[k]));
    let total = -1;
    if (o.totals && objs.length) {
      const sum = (k) => objs.reduce((n, r) => n + (isNum(r[k]) ? r[k] : 0), 0);
      const secs = (k) => objs.reduce((n, r) => { const m = /^(\d+):(\d+):(\d+)$/.exec(r[k] || ''); return m ? n + (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : n; }, 0);
      const t = { Borehole: G.t('x.total'), Injected_volume: r2(sum('Injected_volume')), Total_duration: hms(secs('Total_duration')), Grouting_duration: hms(secs('Grouting_duration')) };
      rows.push(keys.map((k) => (k in t ? t[k] : ''))); total = rows.length - 1;
    }
    return { cols, keys, rows, objs, hasData, total, count: objs.length };
  }

  /* a model restricted to some columns (keys in the original order) */
  function exportPick(m, keys) {
    const idx = KEYS.map((k, i) => (keys.indexOf(k) >= 0 ? i : -1)).filter((i) => i >= 0);
    return Object.assign({}, m, { keys: idx.map((i) => KEYS[i]), cols: idx.map((i) => COLS[i]), rows: m.rows.map((r) => idx.map((i) => r[i])) });
  }

  /* ---- CSV: same dialect as the original (";" separated, decimal comma, CRLF, a missing last value is not written) ---- */
  function csvCell(v, dec) {
    if (isNum(v)) return String(v).replace('.', dec);
    const s = v == null ? '' : String(v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv(model, o) {
    o = o || {}; const dec = o.dec === '.' ? '.' : ',';
    const head = model.cols.map((c) => c.k).join(';'), lines = [head];
    const emptyLast = model.cols.length && model.cols[model.cols.length - 1].k === 'Inclination';
    model.rows.forEach((r) => {
      const cells = r.map((v) => csvCell(v, dec));
      if (emptyLast && cells[cells.length - 1] === '') cells.pop(); // the original leaves the empty Inclination out
      lines.push(cells.join(';'));
    });
    const text = lines.join('\r\n') + '\r\n';
    return (/[^\u0000-\u007f]/.test(text) ? '﻿' : '') + text; // a BOM only when needed so Excel reads accents correctly
  }
  /* tab separated text for pasting straight into a spreadsheet */
  function exportTsv(model, o) {
    const dec = o && o.dec === '.' ? '.' : ',', clean = (v) => (isNum(v) ? String(v).replace('.', dec) : String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' '));
    return [model.cols.map((c) => c.k).join('\t')].concat(model.rows.map((r) => r.map(clean).join('\t'))).join('\r\n') + '\r\n';
  }
  function exportXlsx(model, o) {
    o = o || {};
    const widths = model.cols.map((c, ci) => Math.max(c.k.length + 3, ...model.rows.map((r) => String(r[ci] == null ? '' : r[ci]).length + 2), 8));
    return G.xlsx.build({ name: o.sheet || 'Grout export', title: o.title, header: model.cols.map((c) => c.k), types: model.cols.map((c) => c.t), rows: model.rows, widths, total: model.total });
  }

  G.exportCols = COLS; G.exportKeys = KEYS;
  G.exportRow = exportRow; G.exportModel = exportModel; G.exportPick = exportPick; G.exportCsv = exportCsv; G.exportTsv = exportTsv; G.exportXlsx = exportXlsx;
})(window.G = window.G || {});
