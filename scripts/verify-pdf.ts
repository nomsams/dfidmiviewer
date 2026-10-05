import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseDfiFile, computeExtStats } from '../src/lib/dfi.ts';
import { emptyHeader, generateReportPdf, generateSummaryPdf, type ReportOptions } from '../src/lib/pdf.ts';
const recs = await Promise.all(['sample.DFI', 'sample2.DFI'].map((name) => parseDfiFile(new File([readFileSync(new URL('../public/' + name, import.meta.url))], name))));
mkdirSync(new URL('../tmp/pdfs/', import.meta.url), { recursive: true });
const base: ReportOptions = { company: 'Ångström Øresund', language: 'sv', layout: 'classic', classicColour: false, includeTable: true, includeGin: true, includeEvents: true, includeSettings: true, includeVisas: true,
  comment: 'Å Ä Ö · Æ Ø Å · ä ö ü', header: emptyHeader() };
for (const layout of ['classic', 'modern'] as const) for (const language of ['sv', 'en', 'no'] as const) {
  const doc = generateReportPdf(recs[1], { ...base, layout, language });
  writeFileSync(new URL(`../tmp/pdfs/${layout}-${language}.pdf`, import.meta.url), Buffer.from(doc.output('arraybuffer')));
  console.log(layout, language, doc.getNumberOfPages(), 'pages');
}
for (const language of ['sv', 'en', 'no'] as const) {
  const doc = generateReportPdf(recs[1], { ...base, classicColour: true, language });
  writeFileSync(new URL(`../tmp/pdfs/classic-colour-${language}.pdf`, import.meta.url), Buffer.from(doc.output('arraybuffer')));
}
const summary = generateSummaryPdf(Array.from({ length: 75 }, (_, i) => recs[i % 2]), base);
writeFileSync(new URL('../tmp/pdfs/summary.pdf', import.meta.url), Buffer.from(summary.output('arraybuffer')));
for (const r of recs) console.log(r.meta.jobName, computeExtStats(r));
