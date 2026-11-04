import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from './harness.mjs';

const head = 'RecordStart\t\t2026-01-01T10:00:00.000\t0\t0\t100000\t0\t0\n\t\t\t000D0080\t000F0080\t93000780\t93000540\t93000500\n\t\t\ts\ts\tPa\tm3/s\tm3\n';
const row = (tt, tm, v) => '\t\t\t' + tt + '\t' + tm + '\t100000\t0.0001\t' + v + '\n';
const parse = (rows) => G.parseBuffer('REC.TXT', new TextEncoder().encode(head + rows.join('') + 'PumpStop\t00100000;00.0000000;00.000\t2026-01-01T10:00:09.000\n').buffer);

test('counters that step backwards are continued instead of refusing the file (real devices do this)', () => {
  /* the volume loses 0.076 l at a pump restart and the measuring clock moves back by rounding noise: silent, increments kept */
  const noise = parse([row(0, 0, 0.0418), row(1, 1, 0.041724), row(2, 2, 0.041824), row(3, 1.9999, 0.041924)]);
  assert.equal(noise.warnings.includes('counterReset'), false, 'noise is not worth a warning');
  assert.deepEqual(noise.samples.map((x) => +x.v.toFixed(6)), [0.0418, 0.0418, 0.0419, 0.042], 'later samples keep their increments');
  assert.ok(noise.samples.every((x, i, a) => !i || (x.tt >= a[i - 1].tt && x.tm >= a[i - 1].tm && x.v >= a[i - 1].v)));
  /* a real reset (volume back to about zero after 40 l) continues from the earlier value and is reported */
  const real = parse([row(0, 0, 0), row(10, 10, 0.04), row(20, 20, 0.0005), row(30, 30, 0.0105)]);
  assert.ok(real.warnings.includes('counterReset')); assert.equal(real.meta.counterSteps, 1);
  assert.deepEqual(real.samples.map((x) => +x.vL.toFixed(3)), [0, 40, 40, 50], 'the volume goes on from 40 l: +10 l after the reset');
  /* a volume counter that reads below zero (a record with no injection) loads as zero volume, with a warning */
  const neg = parse([row(0, 0, 0), row(5, 0, -0.0818), row(6, 0, -0.0818)]);
  assert.ok(neg.samples.every((x) => x.vL === 0)); assert.ok(neg.warnings.includes('counterReset'));
  assert.throws(() => parse([row(-1, 0, 0), row(1, 1, 0)]), (e) => e.code === 'invalidSamples', 'a negative clock is still invalid');
});

test('the statistics of a file with a restart do not depend on the step in the counters', () => {
  const plain = parse([row(0, 0, 0), row(1, 1, 0.001), row(2, 2, 0.002), row(3, 3, 0.003)]);
  const stepped = parse([row(0, 0, 0), row(1, 1, 0.001), row(2, 2, 0.0000), row(3, 3, 0.001)]);
  const a = G.stats(plain, 'original'), b = G.stats(stepped, 'original');
  assert.equal(b.durMeas, a.durMeas, 'the measuring time adds up the positive steps only');
  assert.equal(b.avgP, a.avgP);
});
