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
* **Time report:** five columns of 57.39 mm; per column a header (bold hole name + " sleeve (top-bottom m)", blue "(50 bar)" over the left half, date-time of the record start) and a plot starting at y = 45.76 whose height is *measuring-clock duration ÷ scale* (352.78 s at 1 cm = 60 s = 58.8 mm). Ten dashed divisions (0.5/0.5 mm dashes), solid centre line and right edge. **The column is twice the entered scale wide** (the 50 bar line is the centre). Ticks every cm in the page margin. Curve = every sample from the first record to the last pump stop plotted against the measuring clock (idle time does not advance it); it starts on the zero line. Red line = the SetCons pressure limit. Footer row: stop type in red ("Manu_StopOperator" → "operator (M)"), total volume rounded to a whole litre with one decimal ("6,0 l"), volume limit in red brackets, grout type right-aligned with a 0.6 mm margin; an unnamed grout prints the literal **"Unknow"** (a string literal in the original's import code, found with REA).
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

## Using REA (github.com/morluto/rea)

REA ("Reverse Engineer Anything", MCP server + CLI, MIT) is used here as an evidence-producing static analyser. It was installed into an isolated folder with install scripts disabled (`npm install rea-agents@6.7.0 --prefix <dir> --ignore-scripts`) and run as a plain CLI; its agent-registration step (`rea setup`, which edits client config files) was **not** run.

| Command | Used for |
| --- | --- |
| `rea doctor --json` | readiness: Node and host fine; Hopper, Ghidra and IDA missing (needed only for native code) |
| `rea inspect-managed-artifact <dll> --json` | PE/CLI facts of `DXdataPVD.exe` (x86, .NET Framework, il-only) |
| `rea inspect-managed-members <dll> [--type T ...] --json` | every type, method (with CIL anchors and IL hash), call edge, field access and **user-string literal** of a managed assembly, without loading it |

What it established (all reproducible with the commands above):
* The statistics code matches the hand-made IL reading: `CalcValeurs30s` = 222 IL bytes / 87 instructions; `get_Pressure30s → CalcValeurs30s("iPres")`; `get_AveragePressure → Enumerable.Average`.
* `DXdataPVD` string literals: the default grout name is the literal **"Unknow"**; the import reads these `REC.XML` config keys: `softversion, stagenumber, jobsite, jobname, contract, operator, headloss, fan, jobnumber, top depth, bottom depth, method, grout name`; and these event names: `lugeonstart, resume, stop, recordstop, pilotstart, pause, start, arret, recordstart, pumpstart, pilotstop, pumpstop, setstop, setcons, gin`. It inserts each injection into both `injections` and `injections_US` (the raw sample-mean values reproduced here are the `_US` ones); a registry setting "Unite Pression" stores the pressure unit.
* `jlsa.foundation.dll` contains the device-side water-test class **`Jlsa.Foundation.LugeonStage`**: `LugeonStart` event data is `"stage;set pressure;planned duration"`, `LugeonStop` data is `"stage;mean pressure;duration;total volume"`; mean pressure/flow are arithmetic sample means and the total volume is the sum of positive volume increments. `js/original2.js` follows this (and falls back to the samples when the figures are implausible). `Jlsa.Foundation.Penetro` is **cone-penetration** code (drive-in force, friction), not grout penetrability.

### Native analysis of DLGPVD.EXE (Ghidra 12.1.4 through REA)
Static only; the program was never run. 1637 procedures, 10948 strings. Each CLI call re-imports the database (about 10 minutes), so the queries ran through one long-lived MCP session (`rea --mcp` driven by an SDK client). Ghidra loses x87 results in its decompiler output, so formulas below were read from the instructions.

* **The Lugeon value** is `FUN_007165b0` (0x7165b0). Arguments: Q (l/min), P (bar), a default 1.0, the two section levels in metres (converted from the record), and a viscosity. It computes `Lugeon = Q * 10 * eta / ( |level2 - level1| * P * eta_water )`. `eta_water` is looked up from the Coulis (grout) table by the code "H20" and falls back to **28.0**; `eta` defaults to it, so for water it is simply **Q * 10 / (L * P)** with L = the section length (bottom - top). The app already used exactly that, including the bottom-top length.
* **Head loss** (`FUN_00716d90`): `loss = c0 + c1*Q + c2*Q^2`. The coefficients are read from the stage configuration and divided by 1e5 (Pa to bar); c1 and c2 are additionally divided by 60000 once and twice (Q in l/min). The effective pressure of a stage is the measured pressure minus this loss. The app now has the polynomial as options (`lug.lossLin`, `lug.lossQuad`) next to the constant.
* **Pressure unit conversions** in the print code: bar to kPa x100, bar to kg/cm2 x1.0197163. Raw pressure on the legacy path is built from two bytes (`FUN_007103a0`: `(hi*256+lo)*scale`), i.e. the device protocol, not the DFI file.
* **"Lugeon apparent final = x"** is only printed when the lugeon mode and the **Peffective** setting are both on (the registry value `Configuration\Peffective` is a boolean "show effective pressure"). The value printed is the last stage's record (field +0x20 of a 0x34-byte stage record, rounded to the configured decimals).
* **GetValLugeon30, IsPalierLine, FindFirstPalierStart, IsLugeonRecord** only occur as VB6 error-handler strings ("Procedure X du module Y"): they have no direct cross-references, so their bodies were not isolated.
* **Not found:** a hydrostatic term in the stage computation (the "Display hydrostatic pressure" option is a separate display setting), and the origin of the ~0.1 bar difference seen in the pressure averages. The only pressure correction that exists on this path is the head-loss subtraction above, which would lower, not raise, the pressure, so the gap is still unexplained.

### Still open
The remaining questions need a water-test printout plus its DFI file to check against.

## Reproducing the analysis

* Resources: load assemblies with `[Reflection.Assembly]::ReflectionOnlyLoadFrom` and call `GetManifestResourceStream` (nothing executes).
* IL: `powershell -File tools/re/il-disassemble.ps1 -Dll DXdataPVD.exe -Type DXdataPVD.DPVdata.InjectionDPV -Method get_AveragePressure`.
* Database: copy a `.BAK`/`.mdb` first, then read it with Jet OLEDB from 32-bit PowerShell (`Mode=Read`).
