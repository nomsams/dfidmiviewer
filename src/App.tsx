import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brush, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { computeExtStats, csvText, downsample, formatDuration, parseDfiFile, parseSetpointBar, sanitizeStem, type DfiRecord } from './lib/dfi';
import { describeIssue, LANG_LABEL, LANGS, STR, type Lang } from './lib/i18n';
import { axisTicks, ginPlot } from './lib/charts';
import { emptyHeader, generateSummaryPdf, generateReportPdf, reportFileName, type HeaderOverride, type ReportOptions } from './lib/pdf';

type TimeBase = 'total' | 'meas';
const COMPARE_COLORS = ['#4f46e5', '#059669', '#d97706', '#e11d48', '#0ea5e9'];
const LS_KEY = 'dfi-viewer-prefs-v3';

interface Prefs {
  lang: Lang;
  layout: 'modern' | 'classic';
  classicColour: boolean;
  company: string;
  header: HeaderOverride;
  comment: string;
  includeTable: boolean;
  includeGin: boolean;
  includeEvents: boolean;
  includeSettings: boolean;
  includeVisas: boolean;
}

function loadPrefs(): Prefs {
  const d: Prefs = {
    lang: 'sv', layout: 'classic', classicColour: false, company: '', header: emptyHeader(), comment: '',
    includeTable: false, includeGin: false, includeEvents: true, includeSettings: true, includeVisas: false,
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const merged = { ...d };
      for (const key of ['classicColour', 'includeTable', 'includeGin', 'includeEvents', 'includeSettings', 'includeVisas'] as const) if (typeof saved[key] === 'boolean') merged[key] = saved[key];
      if (LANGS.includes(saved.lang)) merged.lang = saved.lang;
      if (saved.layout === 'classic' || saved.layout === 'modern') merged.layout = saved.layout;
      if (typeof saved.company === 'string') merged.company = saved.company;
      return merged;
    }
  } catch { /* ignore */ }
  return d;
}

export default function App() {
  const [records, setRecords] = useState<DfiRecord[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [compareMode, setCompareMode] = useState(false);
  const [timeBase, setTimeBase] = useState<TimeBase>('total');
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [headers, setHeaders] = useState<Map<DfiRecord, HeaderOverride>>(() => new Map());
  const [comments, setComments] = useState<Map<DfiRecord, string>>(() => new Map());
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recordsRef = useRef<DfiRecord[]>([]);
  recordsRef.current = records;
  const t = STR[prefs.lang];
  const active = records[activeIdx];
  const header = headers.get(active) ?? emptyHeader();
  const comment = comments.get(active) ?? '';

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ ...prefs, header: emptyHeader(), comment: '' })); } catch { /* ignore */ }
    document.documentElement.lang = prefs.lang;
  }, [prefs]);
  useEffect(() => {
    if (activeIdx >= records.length && records.length > 0) setActiveIdx(records.length - 1);
  }, [records.length, activeIdx]);

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const setH = (k: keyof HeaderOverride, v: string) => {
    if (active) setHeaders((prev) => new Map(prev).set(active, { ...(prev.get(active) ?? emptyHeader()), [k]: v }));
  };

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setBusy(true);
    setErrors([]);
    const base = recordsRef.current.length;
    const parsed: DfiRecord[] = [];
    const errs: string[] = [];
    for (const f of arr) {
      try {
        const record = await parseDfiFile(f);
        // Validate window pairing before a malformed record can reach rendering.
        computeExtStats(record);
        parsed.push(record);
      } catch (e) {
        errs.push(`${f.name}: ${describeIssue(e instanceof Error ? e.message : String(e), prefs.lang)}`);
      }
    }
    if (parsed.length) {
      setRecords((prev) => [...prev, ...parsed]);
      setActiveIdx(base);
    }
    if (errs.length) setErrors(errs);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function removeRecord(idx: number) {
    const nextLen = recordsRef.current.length - 1;
    setRecords((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((a) => (nextLen <= 0 ? 0 : Math.min(a > idx ? a - 1 : a === idx ? Math.max(0, idx - 1) : a, nextLen - 1)));
  }

  const stats = useMemo(() => (active ? computeExtStats(active) : null), [active]);
  const setpoint = active ? parseSetpointBar(active.meta.setConsRaw) : null;
  const chartData = useMemo(() => {
    if (!active) return [];
    return active.samples.map((s) => ({
      t: timeBase === 'total' ? s.tTotal : s.tMeas,
      pBar: s.pressBar,
      q: s.flowLmin,
      v: s.volL,
    }));
  }, [active, timeBase]);
  const ginData = useMemo(() => active ? ginPlot(active) : null, [active]);

  const compareData = useMemo(() => (compareMode ? mergeCompareTime(records) : []), [compareMode, records]);
  const compareFiles = useMemo(() => records.filter((r) => r.samples.length > 0).slice(0, 5), [records]);

  function reportOpts(rec?: DfiRecord): ReportOptions {
    return {
      company: prefs.company, language: prefs.lang, layout: prefs.layout, classicColour: prefs.classicColour, includeTable: prefs.includeTable,
      includeGin: prefs.includeGin, includeEvents: prefs.includeEvents,
      includeSettings: prefs.includeSettings, includeVisas: prefs.includeVisas,
      comment: rec ? comments.get(rec) ?? '' : '', header: rec ? headers.get(rec) ?? emptyHeader() : emptyHeader(),
    };
  }
  function downloadPdf(rec: DfiRecord) {
    try {
      generateReportPdf(rec, reportOpts(rec)).save(reportFileName(rec));
    } catch (e) {
      setErrors([`PDF: ${e instanceof Error ? e.message : String(e)}`]);
    }
  }
  function downloadAll() {
    const list = records.filter((r) => r.samples.length > 0);
    list.forEach((rec, i) => setTimeout(() => downloadPdf(rec), i * 500));
  }
  function downloadBilan() {
    try {
      generateSummaryPdf(records.filter((r) => r.samples.length > 0), reportOpts()).save(`${sanitizeStem(t.bilan)}.pdf`);
    } catch (e) {
      setErrors([`PDF: ${e instanceof Error ? e.message : String(e)}`]);
    }
  }
  function downloadCsv(rec: DfiRecord) {
    const blob = new Blob([csvText(rec)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeStem(rec.meta.fileName.replace(/\.(DFI|DMJ|TXT)$/i, '')) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function previewPdf(rec: DfiRecord) {
    try { setPreview(URL.createObjectURL(generateReportPdf(rec, reportOpts(rec)).output('blob'))); }
    catch (e) { setErrors([describeIssue(e instanceof Error ? e.message : String(e), prefs.lang)]); }
  }

  async function loadSamples() {
    try {
      setBusy(true);
      const out: File[] = [];
      for (const name of ['sample.DFI', 'sample2.DFI']) {
        const r = await fetch(`${import.meta.env.BASE_URL}${name}`);
        if (!r.ok) throw new Error(name);
        out.push(new File([await r.blob()], name));
      }
      await handleFiles(out);
    } catch {
      setErrors([t.sampleFail]);
      setBusy(false);
    }
  }

  const indexed = records.map((r, i) => ({ r, i }));
  const filtered = indexed.filter(({ r }) =>
    (r.meta.fileName + ' ' + r.meta.jobName + ' ' + r.meta.jobSite + ' ' + r.meta.operator).toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-slate-950 text-white sticky top-0 z-10 shadow">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-500 grid place-items-center font-black text-lg">D</div>
          <div className="flex-1">
            <div className="font-bold leading-tight">{t.appName} <span className="text-xs font-normal text-slate-400 ml-2">{t.appTag}</span></div>
            <div className="text-xs text-slate-400">{t.subtitle}</div>
          </div>
          <input value={prefs.company} onChange={(e) => set('company', e.target.value)} title={t.company} aria-label={t.company}
            className="hidden md:block bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm w-56" />
          <div className="flex rounded-lg overflow-hidden border border-slate-700" role="group" aria-label={t.language}>
            {LANGS.map((l) => (
              <button key={l} onClick={() => set('lang', l)} aria-pressed={prefs.lang === l}
                className={`px-2.5 py-1.5 text-sm font-bold ${prefs.lang === l ? 'bg-indigo-600' : 'bg-slate-800'}`}>{LANG_LABEL[l]}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-5 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
        <aside className="space-y-4">
          <div
            role="button" tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            className={`cursor-pointer bg-white border-2 border-dashed rounded-2xl p-6 text-center transition ${dragOver ? 'border-indigo-600 bg-indigo-50' : 'border-indigo-300 hover:border-indigo-500 hover:bg-indigo-50/50'}`}
          >
            <div className="text-3xl">📥</div>
            <div className="font-semibold mt-1 text-sm">{busy ? t.loading : dragOver ? t.dropActive : t.drop}</div>
            <div className="text-xs text-slate-500 mt-1">{t.dropHint}</div>
            <input ref={inputRef} type="file" multiple accept=".DFI,.DMJ,.TXT,.dfi,.dmj,.txt" className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          </div>

          <div className="bg-white rounded-2xl shadow-sm border p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold text-sm">{t.files} ({records.length})</div>
              <div className="flex gap-2">
                <button onClick={() => setCompareMode(!compareMode)} aria-pressed={compareMode} className={`text-xs px-2 py-1 rounded-lg border ${compareMode ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>{t.compare}</button>
                <button onClick={() => { setRecords([]); setActiveIdx(0); setErrors([]); }} className="text-xs px-2 py-1 rounded-lg border bg-slate-100">{t.clear}</button>
              </div>
            </div>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.search} aria-label={t.search} className="w-full text-sm border rounded-lg px-2 py-1.5 mb-2" />
            <div className="space-y-1.5 max-h-[420px] overflow-auto">
              {filtered.length === 0 && <div className="text-xs text-slate-500 p-2">{t.noFiles}</div>}
              {filtered.map(({ r, i }) => (
                <div key={`${i}-${r.meta.fileName}`} className={`flex items-center gap-1 rounded-xl border p-1.5 transition ${i === activeIdx ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                  <button onClick={() => setActiveIdx(i)} className="flex-1 text-left px-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">{r.meta.jobName || r.meta.fileName}</div>
                    <div className="text-[11px] text-slate-500 truncate">{r.meta.jobSite} · {r.meta.operator} · {r.samples.length} {t.samples}</div>
                    {r.meta.kind === 'DMJ-update' && <div className="text-[11px] text-amber-600 font-semibold">{t.dmjWarn}</div>}
                  </button>
                  <button onClick={() => removeRecord(i)} title={t.remove} aria-label={`${t.remove} ${r.meta.fileName}`} className="shrink-0 text-slate-400 hover:text-red-600 px-1.5 py-1">×</button>
                </div>
              ))}
            </div>
            {records.length > 0 && (
              <div className="mt-3 space-y-2">
                <button onClick={downloadAll} disabled={busy} className="w-full bg-slate-950 text-white rounded-xl py-2 text-sm font-semibold disabled:opacity-50">⬇ {t.batchPdf} ({records.filter((r) => r.samples.length > 0).length})</button>
                <button onClick={downloadBilan} disabled={busy} className="w-full bg-white border rounded-xl py-2 text-sm font-semibold disabled:opacity-50">📊 {t.bilanPdf}</button>
                <div className="text-[11px] text-slate-400">{t.bilanHint}</div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border p-3">
            <div className="font-bold text-sm mb-2">🖨️ {t.options}</div>
            <div className="text-sm mb-2">
              <div className="text-xs text-slate-500 mb-1">{t.layout}</div>
              <div className="flex rounded-lg overflow-hidden border" role="group">
                <button onClick={() => set('layout', 'modern')} aria-pressed={prefs.layout === 'modern'}
                  className={`flex-1 px-2 py-1 text-xs font-semibold ${prefs.layout === 'modern' ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{t.modern}</button>
                <button onClick={() => set('layout', 'classic')} aria-pressed={prefs.layout === 'classic'}
                  className={`flex-1 px-2 py-1 text-xs font-semibold ${prefs.layout === 'classic' ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{t.classic}</button>
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              {prefs.layout === 'classic' && <Check label={t.classicColour} value={prefs.classicColour} onChange={(v) => set('classicColour', v)} />}
              <Check label={t.includeTable} value={prefs.includeTable} onChange={(v) => set('includeTable', v)} />
              <Check label={t.includeGin} value={prefs.includeGin} onChange={(v) => set('includeGin', v)} />
              <Check label={t.includeEvents} value={prefs.includeEvents} onChange={(v) => set('includeEvents', v)} />
              <Check label={t.includeSettings} value={prefs.includeSettings} onChange={(v) => set('includeSettings', v)} />
              <Check label={t.includeVisas} value={prefs.includeVisas} onChange={(v) => set('includeVisas', v)} />
            </div>
            <div className="font-bold text-sm mt-3 mb-2">📋 {t.headerTitle}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Hdr label={t.site} value={header.site} ph={active?.meta.jobSite ?? ''} onChange={(v) => setH('site', v)} />
              <Hdr label={t.borehole} value={header.job} ph={active?.meta.jobName ?? ''} onChange={(v) => setH('job', v)} />
              <Hdr label={t.contract} value={header.contract} ph={active?.meta.contract ?? ''} onChange={(v) => setH('contract', v)} />
              <Hdr label={t.operator} value={header.operator} ph={active?.meta.operator ?? ''} onChange={(v) => setH('operator', v)} />
              <Hdr label={t.pump} value={header.pump} ph="" onChange={(v) => setH('pump', v)} />
              <Hdr label={t.grout} value={header.grout} ph={active?.meta.groutName ?? ''} onChange={(v) => setH('grout', v)} />
            </div>
            <label className="text-xs block mt-2">💬 {t.comment}
              <input value={comment} onChange={(e) => { if (active) setComments((prev) => new Map(prev).set(active, e.target.value)); }} className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm" />
            </label>
          </div>
        </aside>

        <main className="space-y-4">
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl px-4 py-2.5 text-sm">
              <div className="font-bold">⚠️ {t.errors}</div>
              <ul className="list-disc ml-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          {!active && (
            <div className="bg-white rounded-2xl border p-10 text-center">
              <div className="text-5xl">📊</div>
              <h1 className="text-xl font-bold mt-3">{t.emptyTitle}</h1>
              <p className="text-sm text-slate-500 mt-1">{t.emptyHint}</p>
              <button onClick={loadSamples} disabled={busy} className="mt-4 bg-indigo-600 text-white rounded-xl px-5 py-2.5 text-sm font-bold disabled:opacity-50">⚡ {t.loadSample}</button>
            </div>
          )}
          {active && (
            <>
              <div className="bg-white rounded-2xl border p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <div className="text-lg font-bold">{header.job || active.meta.jobName || active.meta.fileName} <span className="text-sm font-normal text-slate-500">· {header.site || active.meta.jobSite} · {header.operator || active.meta.operator}</span></div>
                  <div className="text-xs text-slate-500">{active.meta.fileName} · {active.meta.softVersion} {active.meta.infoProc && `· ${active.meta.infoProc}`} · {active.samples.length} {t.samples}</div>
                </div>
                <button onClick={() => previewPdf(active)} disabled={!active.samples.length} className="bg-white border rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50">{t.previewPdf}</button>
                <button onClick={() => downloadPdf(active)} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-4 py-2 text-sm font-bold">📄 {t.downloadPdf}</button>
                <button onClick={() => downloadCsv(active)} disabled={!active.samples.length} className="bg-white border rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50">📊 {t.csv}</button>
              </div>

              {active.warnings.map((w) => (
                <div key={w} className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-2.5 text-sm">⚠️ {describeIssue(w, prefs.lang)}</div>
              ))}

              {stats && active.samples.length > 0 && (
                <>
                  <div className="bg-slate-100 border rounded-xl px-4 py-3 text-xs">{t.calcHint}</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Kpi label={t.totalVol} value={`${stats.totalVolL.toFixed(2)} l`} sub={`${stats.totalVolM3.toFixed(5)} m³`} color="bg-amber-500" />
                    <Kpi label={t.maxP} value={`${stats.maxPressBar.toFixed(2)} bar`} sub={`${t.avgP} ${Number.isFinite(stats.avgPressBar) ? stats.avgPressBar.toFixed(2) : '-'} bar`} color="bg-indigo-500" />
                    <Kpi label={t.maxQ} value={`${stats.maxFlowLmin.toFixed(2)} l/min`} sub={`${t.avgQ} ${stats.avgFlowLmin.toFixed(2)} l/min`} color="bg-emerald-500" />
                    <Kpi label={t.measDur} value={formatDuration(stats.durationMeasure)} sub={`${t.endP} ${stats.endPressBar.toFixed(2)} bar · ${t.reprises} ${stats.reprises}`} color="bg-sky-500" />
                  </div>

                  <div className="bg-white rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <div className="font-bold text-sm flex-1">{compareMode ? `${t.compare} — ${t.pressureFlow}` : t.pressureFlow} <span className="font-normal text-slate-500">· {t.measureWindow}: {active.meta.measureStart} → {active.meta.measureStop}</span></div>
                      {!compareMode && (
                        <div className="flex text-xs border rounded-lg overflow-hidden" role="group">
                          <button onClick={() => setTimeBase('total')} className={`px-2.5 py-1 ${timeBase === 'total' ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{t.tTotal}</button>
                          <button onClick={() => setTimeBase('meas')} className={`px-2.5 py-1 ${timeBase === 'meas' ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{t.tMeas}</button>
                        </div>
                      )}
                    </div>
                    {compareMode && <div className="text-[11px] text-slate-500 mb-2">{t.compareHint}</div>}
                    <div className="text-[11px] text-slate-400 mb-2">{t.unitsNote}</div>
                    <div className="h-[300px]">
                      <ResponsiveContainer>
                        <LineChart data={compareMode ? compareData : chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis type="number" domain={['dataMin', 'dataMax']} dataKey="t" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(1)}s`} />
                          <YAxis yAxisId="p" tick={{ fontSize: 11 }} domain={[0, 'auto']} label={{ value: 'bar', angle: -90, fontSize: 11 }} />
                          {!compareMode && <YAxis yAxisId="q" orientation="right" tick={{ fontSize: 11 }} label={{ value: 'l/min', angle: 90, fontSize: 11 }} />}
                          <Tooltip formatter={(v, name) => [String(v), String(name)]} labelFormatter={(v) => `t = ${v} s`} />
                          <Legend />
                          {compareMode
                            ? compareFiles.map((r, i) => (
                              <Line key={i} yAxisId="p" dataKey={`p${i}`} name={`${r.meta.jobName || r.meta.fileName} (bar)`} connectNulls dot={false} strokeWidth={2} stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]} />
                            ))
                            : (<>
                              <Line yAxisId="p" dataKey="pBar" name="P (bar)" dot={false} strokeWidth={2} stroke="#4f46e5" />
                              <Line yAxisId="q" dataKey="q" name="Q (l/min)" dot={false} strokeWidth={1.5} stroke="#059669" strokeDasharray="5 3" />
                            </>)}
                          {!compareMode && setpoint !== null && (
                            <ReferenceLine yAxisId="p" y={setpoint} stroke="#e11d48" strokeDasharray="4 4" label={{ value: `${t.setpoint} ${setpoint.toFixed(2)} bar`, fontSize: 10 }} />
                          )}
                          {!compareMode && <Brush dataKey="t" height={22} travellerWidth={10} />}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {!compareMode && (
                    <>
                      <div className="bg-white rounded-2xl border p-4">
                        <div className="font-bold text-sm mb-1">{t.volume} <span className="font-normal text-slate-500">{t.vsTime}</span></div>
                        <div className="h-[200px]">
                          <ResponsiveContainer>
                            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis type="number" domain={['dataMin', 'dataMax']} dataKey="t" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} label={{ value: 'l', angle: -90, fontSize: 11 }} />
                              <Tooltip />
                              <Line dataKey="v" name="V (l)" dot={false} strokeWidth={2.5} stroke="#d97706" fill="#fef3c7" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className="bg-white rounded-2xl border p-4">
                        <div className="font-bold text-sm mb-1">{t.ginTitle} <span className="font-normal text-slate-500">· {t.ginValue}: {stats.ginEnd.toFixed(1)} bar·L</span></div>
                        <div className="text-[11px] text-slate-400 mb-2">{t.ginHint}</div>
                        <div className="h-[200px]">
                          <ResponsiveContainer>
                            <LineChart data={ginData?.points ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 12 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis type="number" domain={ginData ? [ginData.volume.low, ginData.volume.high] : [0, 1]} ticks={ginData ? axisTicks(ginData.volume) : undefined} dataKey="v" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(2)} label={{ value: 'V (l)', fontSize: 11, position: 'insideBottom', offset: -8 }} />
                              <YAxis domain={ginData ? [ginData.pressure.low, ginData.pressure.high] : [0, 1]} ticks={ginData ? axisTicks(ginData.pressure) : undefined} tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(2)} label={{ value: 'P (bar)', angle: -90, fontSize: 11 }} />
                              <Tooltip formatter={(v) => [Number(v).toFixed(3), 'P (bar)']} labelFormatter={(v) => `V = ${Number(v).toFixed(3)} l`} />
                              <Line type="linear" isAnimationActive={false} dataKey="pBar" name="P (bar)" dot={false} strokeWidth={2} stroke="#4f46e5" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
              {active && !active.samples.length && (
                <div className="bg-white rounded-2xl border p-6 text-sm text-slate-500 text-center">{t.empty}</div>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border p-4">
                  <div className="font-bold text-sm mb-2">🧭 {t.events} ({active.events.length})</div>
                  <div className="max-h-[260px] overflow-auto text-xs">
                    <table className="w-full">
                      <tbody>
                        {active.events.map((e, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="py-1 pr-2 font-semibold whitespace-nowrap">{e.name}</td>
                            <td className="py-1 pr-2 text-slate-600 truncate max-w-[160px]" title={e.data}>{e.data || '-'}</td>
                            <td className="py-1 text-slate-400 whitespace-nowrap">{e.date?.slice(11) || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border p-4">
                  <div className="font-bold text-sm mb-2">⚙️ {t.settings}</div>
                  <div className="text-xs space-y-1 max-h-[260px] overflow-auto">
                    {active.meta.setConsRaw && <Row k="SetCons" v={active.meta.setConsRaw} />}
                    {Object.entries(active.meta.params).map(([k, v]) => (
                      <Row key={k} k={k} v={String(v).trim() || '-'} />
                    ))}
                    {Object.keys(active.meta.params).length === 0 && !active.meta.setConsRaw && <div className="text-slate-400">–</div>}
                  </div>
                </div>
              </div>

              {active.samples.length > 0 && (
                <div className="bg-white rounded-2xl border p-4">
                  <div className="font-bold text-sm mb-2">🔢 {t.dataTable} — {active.samples.length}</div>
                  <div className="overflow-auto text-xs">
                    <table className="w-full tabular-nums">
                      <thead><tr className="text-left text-slate-500 border-b">
                        <th className="py-1">{t.timeTotal}</th><th>{t.timeMeas}</th><th>p (bar)</th><th>Q (l/min)</th><th>V (l)</th>
                      </tr></thead>
                      <tbody>
                        {downsample(active.samples, 12).map((s, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="py-1">{s.tTotal.toFixed(1)}</td><td>{s.tMeas.toFixed(1)}</td>
                            <td>{s.pressBar.toFixed(3)}</td><td>{s.flowLmin.toFixed(3)}</td><td>{s.volL.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {preview && <div className="fixed inset-0 z-50 bg-slate-900/70 p-4 flex flex-col" role="dialog" aria-modal="true" aria-label={t.previewPdf}>
        <div className="bg-white rounded-t-xl p-3 flex items-center justify-between"><strong>{t.previewPdf}</strong><button onClick={() => setPreview(null)} className="border rounded-lg px-3 py-1">{t.close}</button></div>
        <iframe src={preview} title={t.previewPdf} className="bg-white flex-1 w-full rounded-b-xl" />
      </div>}
      <footer className="text-center text-xs text-slate-400 pb-8">{t.footer} · {new Date().getFullYear()}</footer>
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border p-3 flex items-center gap-3">
      <div className={`w-2 self-stretch rounded-full ${color}`} />
      <div><div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
        <div className="font-bold leading-tight">{value}</div>
        <div className="text-[11px] text-slate-400">{sub}</div></div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex gap-2 border-b border-slate-50 py-0.5"><span className="font-mono font-semibold w-20 shrink-0">{k}</span><span className="text-slate-600 break-all">{v}</span></div>;
}
function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-indigo-600" />{label}</label>;
}
function Hdr({ label, value, ph, onChange }: { label: string; value: string; ph: string; onChange: (v: string) => void }) {
  return <label className="block">{label}<input value={value} placeholder={ph} onChange={(e) => onChange(e.target.value)} className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm" /></label>;
}

/** Align by elapsed total seconds. Missing observations remain gaps. */
function mergeCompareTime(records: DfiRecord[]) {
  const list = records.filter((r) => r.samples.length > 0).slice(0, 5);
  const rows = new Map<number, Record<string, number | null>>();
  list.forEach((r, j) => {
    for (const sample of r.samples) {
      let row = rows.get(sample.tTotal);
      if (!row) {
        row = { t: sample.tTotal };
        list.forEach((_, i) => { row![`p${i}`] = null; });
        rows.set(sample.tTotal, row);
      }
      row[`p${j}`] = sample.pressBar;
    }
  });
  return [...rows.values()].sort((a, b) => Number(a.t) - Number(b.t));
}
