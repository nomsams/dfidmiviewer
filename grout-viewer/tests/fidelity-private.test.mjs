// Opt-in integration check. Private recordings and the reference export stay outside git.
// Set GROUT_FIDELITY_DFI_DIR and GROUT_FIDELITY_CSV to run this with npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { G, itemOf } from './harness.mjs';

const dir = process.env.GROUT_FIDELITY_DFI_DIR, csv = process.env.GROUT_FIDELITY_CSV;
test('private fidelity: every exported cell matches the original 83-row specimen', { skip: !dir || !csv }, () => {
  const original = fs.readFileSync(csv, 'utf8');
  const [header, ...lines] = original.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  const keys = header.split(';'), records = new Map(), items = [];
  assert.deepEqual(keys, G.exportKeys);
  assert.equal(lines.length, 83, 'the complete original specimen is required');
  for (const file of fs.readdirSync(dir).filter(f => /\.dfi$/i.test(f))) {
    const bytes = fs.readFileSync(path.join(dir, file));
    const rec = G.parseBuffer(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const start = rec.events.find(e => e.name === 'RecordStart');
    if (start) records.set(start.date.slice(0, 10) + ' ' + start.date.slice(11, 19), rec);
  }
  for (const line of lines) {
    const cells = line.split(';'), expected = Object.fromEntries(keys.map((k, i) => [k, cells[i] || '']));
    const rec = records.get(expected.Start_date + ' ' + expected.Start_time);
    assert.ok(rec, 'every reference row must match a recording');
    const item = itemOf(rec); items.push(item);
    const row = G.exportRow(item, { compat: true, eff: { density: 1000, angle: 0, waterDepth: 0 } });
    for (const key of keys) {
      const actual = row[key], want = expected[key];
      if (typeof actual === 'number') assert.ok(Math.abs(actual - Number(want.replace(',', '.'))) < 1e-9, 'numeric cell mismatch in ' + key);
      else assert.equal(String(actual), want, 'text cell mismatch in ' + key);
    }
  }
  const model = G.exportModel(items, { compat: true, eff: { density: 1000, angle: 0, waterDepth: 0 }, sort: 'none' });
  assert.equal(G.exportCsv(model), original.replace(/\r?\n/g, '\r\n'), 'CSV bytes match after restoring CRLF if the local specimen was normalized to LF');
});
