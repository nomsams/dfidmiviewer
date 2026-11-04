// Regression check against the original program's own export.
//   node tools/compare-export.mjs <folder with .DFI files> <CSV exported by DLGPVD: Site > Export > Field separator > Semicolon>
// Rows are matched on Start_date + Start_time. Prints, per option set, how many whole rows are identical and which columns differ.
import fs from 'node:fs';
import path from 'node:path';
import { G, itemOf } from '../tests/harness.mjs';

const [dir, csvFile] = process.argv.slice(2);
if (!dir || !csvFile) { console.error('usage: node tools/compare-export.mjs <dfi folder> <original export .csv>'); process.exit(2); }
const num = (s) => parseFloat(String(s).replace(',', '.'));
const lines = fs.readFileSync(csvFile, 'utf8').split(/\r?\n/).filter(Boolean), head = lines[0].split(';');
const original = lines.slice(1).map((l) => { const f = l.split(';'); return Object.fromEntries(head.map((h, i) => [h, f[i] === undefined ? '' : f[i]])); });
const records = new Map();
for (const f of fs.readdirSync(dir).filter((x) => /\.dfi$/i.test(x))) {
  const b = fs.readFileSync(path.join(dir, f));
  try { const rec = G.parseBuffer(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); const rs = (rec.events.find((e) => e.name === 'RecordStart') || {}).date || ''; records.set(rs.slice(0, 10) + ' ' + rs.slice(11, 19), rec); }
  catch (e) { console.log('cannot read', f, e.code || e.message); }
}
const rows = original.map((t) => ({ t, rec: records.get(t.Start_date + ' ' + t.Start_time) })).filter((x) => x.rec);
console.log('original rows', original.length, '| matched to a file', rows.length);
const eff = { density: 1000, angle: 0, waterDepth: 0 };
for (const [label, opts] of [['exact calculation', { eff, compat: false }], ['original-compatible (default of the app)', { eff, compat: true }]]) {
  const m = G.exportModel(rows.map((r) => itemOf(r.rec, {})), Object.assign({ sort: 'none' }, opts));
  const cells = {}; let identical = 0;
  m.objs.forEach((o, i) => {
    let same = true;
    for (const k of G.exportKeys) {
      if (k === 'Inclination') continue;
      const a = o[k], b = rows[i].t[k], eq = typeof a === 'number' ? Math.abs(a - num(b)) < 1e-9 : String(a) === String(b);
      if (!eq) { same = false; (cells[k] = cells[k] || []).push(rows[i].t.Borehole + ' ' + rows[i].t.Start_time + ' ours ' + a + ' / original ' + b); }
    }
    if (same) identical++;
  });
  console.log('\n' + label + ': identical rows ' + identical + '/' + m.objs.length);
  for (const [k, v] of Object.entries(cells)) console.log('  ' + k + ': ' + v.length + ' differ' + (process.env.VERBOSE ? '\n    ' + v.join('\n    ') : ''));
}
