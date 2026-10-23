# Reverse-engineering notes

How the original software (installed at `C:\Program Files (x86)\DLGPVD\`) produces its numbers and printouts, what was verified, and what is still open. Everything below came from **static analysis only** (plus the specimen printouts you supplied) (assembly metadata, IL, embedded resources, strings, the unpacked sample files and a read-only copy of the original database). The installer and the original program were never run.

## Architecture of the original

| Part | Technology | Role |
| --- | --- | --- |
| `DLGPVD.EXE` | VB6 (+ VSView `vsPrinter`, MSMask, SSTab) | Main UI, **all printing** (forms *Bilan*, *BilanPAC*, *Courbe GIN*, *GrafLgh*, *Histo*, *ChoixResume*, *Choixbilan*, *ChoixLgh*, *Langue*) |
| `DXdataPVD.exe` | .NET (C#) | Imports `.DFI` into Access `.mdb`; contains the statistics (`InjectionDPV`, `DPVrecord`) |
| `Jlsa.Report.dll` | .NET + embedded templates | Report templates (`GRA/*.rtp`, `TXT/*.ast`, `SUM/*.smt`) — **for other processes (piling etc.), not the grout process `DPVP`** |
| `C:\ProgramData\JeanLutz SA\DXdataPVD\` | `.mdb`, `.ecr`, `.BIL`, `.TXT/.csv`, translations | Daily databases and export column definitions |

Dead end worth knowing: the `PVP` report template in `Jlsa.Report.dll` looks relevant but belongs to a different process (frequency, inclination, depth). The grout record's process is `DPVP` (`PROC/INFO.XML`).

## File format (verified)

* `.DFI` = ustar tar: `<name>/REC.BN1`, `REC.TXT`, `REC.XML`, `PROC/{CFG,CFGS,PARAM,PARAMS,CONS,INFO}.XML`.
* `.DMJ` = device update package (`UPDATE.XML/.BIN/.HEX`), no measurements.
* `REC.BN1` record: `int32 trigger | uint8 channelCount | float32 × channelCount | uint16 additive checksum` (27 bytes for 5 channels). The checksum is the 16-bit sum of all preceding bytes. Every record in both fixtures passes.
* Channels: `000D0080` total time, `000F0080` measuring time (s); `93000780` pressure (Pa); `93000540` flow (m³/s); `93000500` volume (m³).
* `REC.XML` events carry `pos` = byte offset into `REC.BN1` (÷27 = sample index). `SetCons "00400000;0;03.000;00800000;0;000"` = 4 bar limit, 3000 l volume limit, 8 bar safety. `PumpStop "00150000;00.0000000;00.005"` = end pressure Pa, end flow m³/s, volume m³.

## Statistics: formulas decoded from `DXdataPVD.exe` (IL)

Disassembled with `tools/re/il-disassemble.ps1` (reflection-only, executes nothing).

| Value | Original rule |
| --- | --- |
| Average pressure | `Enumerable.Average` over **every** pressure sample in the file (no windows, no time weighting) |
| 30 s pressure / flow | `n = (int)(30 / triggerStep)`; sum of the last `n` samples (skipping index 0) **divided by n** |
| Duration | sum of positive increments of the measuring-time channel |
| Volume, end pressure, end flow | taken from the last `PumpStop` event (`SetFinalValues`), negatives clamped to 0 |
| Average flow | volume ÷ duration |
| Total duration | difference of the whole-second `Start_time` / `End_time` (e.g. 11:52:24 → 12:15:21 = 00:22:57) |
| Stored samples | pressure = round(bar, 1 decimal), flow = round(l/min, 1 decimal) as Int16 ×10 |

### Check against the original's own data

| Hole | Value | This app | Original DB / export |
| --- | --- | --- | --- |
| 18-1 | volume, grouting time, total time | 18 l, 00:07:32, 00:22:57 | same |
| 18-1 | end pressure, avg flow, 30 s flow | 1.80, 2.39, 0.00 | same |
| 18-1 | avg pressure, 30 s pressure | **2.05, 2.02** | table `Injections_US`: 2.05, 2.02 · table `Injections`: **2.15, 2.13** |
| 18-2 | volume, grouting time, total time | 5 l, 00:05:52, 00:10:11 | same |
| 18-2 | end pressure, avg flow | 1.50, 0.85 | same |
| 18-2 | avg pressure, 30 s pressure | **2.13, 1.67** | export: **2.24, 1.78** |

So the raw formula matches one of the original's two tables exactly, and everything except the two mean pressures matches the export.

### Open item: the +≈0.1 bar

The original's exported mean pressures are higher by ≈0.10 bar (18-1) and ≈0.11 bar (18-2), end pressure is not. The database stores grout `Density = 1000` and `Top_level = Bottom_level = 1` (m), `Head_loss = 0`, `Water_depth = 0`; 1 m of 1000 kg/m³ grout is ≈0.098–0.1 bar. The original has an *Effective pressure* option and a hydrostatic-pressure option in its print dialogs. This points to an effective-pressure correction, but the offset is not identical for the two holes (≈0.1025 vs ≈0.109 after allowing for 0.1-bar sample rounding), so the exact formula is **not** reproduced and nothing was fitted. To close this: print/export one hole from the original with *Effective pressure* switched on and off, and record the density/level/inclination entered for it.

## Printouts: measured from real specimens

Three real printouts ("Microsoft Print to PDF", A4 landscape) were analysed as vector data (`tests/fixtures/spec-*.json`, extracted with a content-stream parser; coordinates are snapped to the printer's 0.26 mm grid). Findings that drive `js/original.js`:

* **Frames:** time report 5 mm margins (frame 5–291.97 × 35.98–202.95 mm); the other two 6.99–289.94 mm. Header box 9.99–24.95 mm with an empty logo cell (left, to x = 100.63 / 101.3) and, right of it, site (14.16 pt bold), "GROUTING" (8.88 pt), contract in brackets (right-aligned, date when the contract is empty), report title (8.88 pt) at the cell's bottom left, and a grey "DLGPVD  6.61/DPV 8.10" tag under the box. Footer at y = 207.35: "...", a grey company line, bold page "n/N".
* **Time report:** five columns of 57.39 mm; per column a header (bold hole name + " sleeve (top-bottom m)", blue "(50 bar)" over the left half, date-time of the record start) and a plot starting at y = 45.76 whose height is *measuring-clock duration ÷ scale* (352.78 s at 1 cm = 60 s = 58.8 mm). Ten dashed divisions (0.5/0.5 mm dashes), solid centre line and right edge. **The column is twice the entered scale wide** (the 50 bar line is the centre). Ticks every cm in the page margin. Curve = every sample from the first record to the last pump stop plotted against the measuring clock (idle time does not advance it); it starts on the zero line. Red line = the SetCons pressure limit. Footer row: stop type in red ("Manu_StopOperator" → "operator (M)"), total volume rounded to a whole litre with one decimal ("6,0 l"), volume limit in red brackets, grout type right-aligned (clipped to "Unknow" in the original).
* **Pressure/Volume/GIN:** plot 27.01–280.12 × 51.01–155.96 mm, majors every 5 bar / 10 l (0.25 mm) and minors in between (0.17 mm), pressure blue 0.34 mm, penetrability brown #804040 0.55 mm with its own left axis. **The curve stops at the reported injected volume** (whole litres from the PumpStop event), not at the last sample.
* **Pressure/Volume/Flow:** three depth charts with 0–10 scales, a two-row information table; only a single sleeve at a single depth was available.
* The average pressure printed in the depth report for the sample hole is "2,2", consistent with the effective-pressure hypothesis above (raw 2.13 + ≈0.1 bar).

### Remaining uncertainty
Behaviour with several sleeves per hole, long records that exceed a column, other stop types and non-default option combinations follows the same rules but was not available as specimens. To close this, print such a case from the original to PDF and add it to `tests/fixtures` (see `tests/original.test.mjs` for how a specimen is compared).

## The original's print modes, options and output pipeline

### Where the text lives
`DLGPVD.EXE` carries its UI text as UTF-16 string tables per language (FR/EN/DE/ES/IT/PT/RU); the English block (offsets ≈ 4.95–4.98 MB) lists every menu, report caption and option. Native VB6 symbols that survive in the binary name the internals: `ClsDataLugeon`, `SmnLugeon`, `NbStages`, `TotalStageVol`, `TotalStageTime`, `GetValLugeon30`, `IsPalierLine`, `FindFirstPalierStart` ("palier" = stage), `IsLugeonRecord`.

### Processing menu = the print modes
| Menu entry | Report | Here |
| --- | --- | --- |
| Time plot | Pressure and flow in accordance to time | implemented, measured |
| Pressure/Volume/GIN curve | P and penetrability against volume | implemented, measured |
| Pressure/Volume/Flow diagram | averages per sleeve against depth | implemented (one-sleeve specimen) |
| Volume diagram | Distribution of the grouted volumes | implemented (interpretation) |
| Water test diagram | stages, Lugeon table, hydrostatic pressure, overpressure | implemented, indicative |
| Multicriteria report | filtered bilan with daily/grand totals | implemented |
| Grout synthesis, Ground impregnation, Horizontal / Vertical plan | need site coordinates / drilling links | not implemented |

### Options seen in the dialogs
Page setting (scales, smoothing, header titles, 1 sleeve per page, limits, sleeve info, stop type, end time, duration, grout type, total volume, volume limit, average pressure and flow, final pressure, effective pressure, "use the GIN coefficient of the instructions", …), print dialog (**page selection**, **"1 file per document (PDF printing)"**), settings (**measurement accuracy – decimals**, **pressures in kg/cm²**, original-edition certificate, comment frame/column, blank signature frames), export (ASCII save of displayed values, BMP, measures export/import).

### Lugeon / water-test data
Records are recognised by a `LugeonStart` event (the import code compares the event name lower-cased; `jlsa.foundation` also knows `LugeonStage`, `LugeonStop`, an `iLugeon` channel and `cStage`/`cStageNumber`). The captions "App. Lugeon (l/min/m (10 bar))" and "Lugeon apparent final" define the quantity: flow per metre of tested length scaled to 10 bar. The exact stage detection (`FindFirstPalierStart`) and the 30-second variant (`GetValLugeon30`) are in native code. **No water-test file was available**, so the stage detection here (events, else pressure plateaus) and the effective-pressure treatment are the standard definition, not a transcription.

### LutzPDF (the "lutzprint")
A PostScript printer: Windows' PSCRIPT5 driver + `lutzpdf.PPD` ("LutzPDF 0.9.6", resolutions 72–4000 dpi, default 600) on the port `LutzPDF:`, served by **RedMon** (`redmonnt.dll`, an open-source redirection port monitor). The port command is `C:Program Files (x86)LutzPDFlutzspooler.exe -PPDFCREATORPRINTER`. `lutzspooler.exe` embeds Ghostscript 7.x (`gsdll32.dll`, `gsapi_*`): it asks for a file name (`GetSaveFileName`) and runs `pdfwrite` with `-dPDFSETTINGS=/prepress -dCompatibilityLevel=1.3`; it can also render `-sDEVICE=jpeg -r300x300 -dJPEG=75`. The specimens were printed with "Microsoft Print to PDF" instead, so their geometry is the program's own, independent of LutzPDF.

## Reproducing the analysis

* Resources: load assemblies with `[Reflection.Assembly]::ReflectionOnlyLoadFrom` and call `GetManifestResourceStream` (nothing executes).
* IL: `powershell -File tools/re/il-disassemble.ps1 -Dll DXdataPVD.exe -Type DXdataPVD.DPVdata.InjectionDPV -Method get_AveragePressure`.
* Database: copy a `.BAK`/`.mdb` first, then read it with Jet OLEDB from 32-bit PowerShell (`Mode=Read`).
