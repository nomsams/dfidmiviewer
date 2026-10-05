import type { DfiRecord } from './dfi';

/** Zero-inclusive, readable bounds shared by the browser and printed diagrams. */
export function chartRange(values: Iterable<number>, extra = 0) {
  let low = 0, high = extra;
  for (const value of values) { low = Math.min(low, value); high = Math.max(high, value); }
  const raw = (high - low) / 4 || .25, power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((n) => n * power >= raw)! * power;
  return { low: Math.floor(low / step) * step, high: Math.ceil(high / step) * step || step };
}

/** Recorded P/V points in recording order, including repeated volume readings. */
export function ginPlot(rec: DfiRecord) {
  return {
    points: rec.samples.map((s) => ({ v: s.volL, pBar: s.pressBar })),
    pressure: chartRange(rec.samples.map((s) => s.pressBar)),
    volume: chartRange(rec.samples.map((s) => s.volL)),
  };
}

export function axisTicks(bounds: { low: number; high: number }) {
  return Array.from({ length: 5 }, (_, i) => bounds.low + i * (bounds.high - bounds.low) / 4);
}
