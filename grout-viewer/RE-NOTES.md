# Reverse-engineering notes

How the original software (installed at `C:\Program Files (x86)\DLGPVD\`) produces its numbers and printouts, what was verified, and what is still open. The rules below come from static analysis (assembly metadata, IL, resources, instructions), supplied specimens and read-only database copies. On 2026-11-04 the user explicitly authorized running DLGPVD; its already-running UI was briefly inspected. Computer Use was subsequently stopped with Escape and no further UI input was sent. The installer was not run.

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

### Resolved: the +≈0.1 bar is the effective pressure
Found by reading the .NET IL of `DialogDesktop.dll` (`InfosRecords.Injection`), not the native code. `CalcPNormal(P)` converts an effective pressure back to a gauge pressure: `P - cosA * h * (density/1000) / 10 + cosA * (h - waterDepth) / 10` (bar, metres), with h = (top level + bottom level) / 2, `density` = grout density (default **1000** when not set) and the water term only when a ground-water depth is set and lies above h. The effective pressure is the inverse: **P + cosA*(rho/1000)*h/10 - cosA*(h - Hw)/10**. For the specimens (levels 1-1 m, 1000 kg/m3) that is exactly **+0.100 bar**, which agrees with both exported offsets (0.10 and 0.11) within the 0.01 rounding of the exports. The export adds it to the **average** and **30 s** pressure only; the **end** pressure stays raw. `Injection.GeValeursMoyennesFinales` itself is a plain mean (the head loss is subtracted only from the 30 s value there), and the DFI import writes raw values (`Average_pressure = round(mean/1e5, 2) - Head_loss`, with Head_loss 0 here).
Head loss polynomial in the same class: `CalcHeadLoss(Q) = c0 + c1*Q + c2*Q^2` (Pa; `CalcHeadLossBar` = the same with Q in l/min (x1.6667e-5 per factor) divided by 1e5 and rounded to 2 decimals).
The pressure unit setting `Unite Pression` maps 0 -> x1 (bar), 1 -> x1.01972 (kg/cm2), 2 -> x100 (kPa) in the export.

## The export table (Site > Export > Field separator > Semicolon)
Reproduced from the original export and the .NET code of `DXdataPVD.MDB.MdbManage.AddToMDB` (IL), followed by native `LoadBAP` and the pressure routines below. One row per `.DFI`, 29 columns in the order of `BILAN_COLUMNS`. What the DFI import writes (IL, "DPV" path): `Pump` is always `P1`, `Regrout` 1, `X/Y/Z_coord` 0, `Water_depth` 0, levels default to 1 m when the file has none, `Grout` is the number of the grout in the grout table (1 when unnamed), `Injected_volume` = rounded to 2 decimals, `Dry_weights` equals the volume in the examples, `Head_loss` = the file's head loss (Pa) / 1e5. Durations are cut to whole seconds, not rounded (`00:07:32` for 452.8 s). The original writes no value for the empty last column (`Inclination`), so rows have 28 fields. All fields now match the two examples and all 83 reference rows exactly. Raw-import calculations remain available with compatibility off; they correspond to `Injections_US`, a different calculation path.

### Checked against 83 real exports (field files and the original program's CSV of them)
**2026-11-04: all columns match all 83 rows.** With compatibility and effective pressure enabled (1000 kg/m³, vertical, no ground water), the actual original semicolon CSV in ProgramData is reproduced **byte for byte: 10,784 bytes**. The git-ignored `reference/original-export-83-rows.csv` has normalized LF line endings (10,700 bytes); its content is identical after restoring CRLF. Two defaults of the original import remain verified: a record with no stop event has stop type `Manu_Operator`, and no grouting duration gives average flow 0.

The pressure rules are now **decoded**, not fitted:

1. The .NET importer stores each pressure as signed Int16 tenths, rounding halves to even. A read-only copy of the 83-row database backup confirms the pressure table agrees with the rounded DFI samples in every record (including negative values).
2. Native `0x006D9E10` recognizes scale marker **6553** and returns `Single(65535 / 10)`. `LoadBAP` then divides by 65535 and stores a Single scale; `0x007103A0` decodes signed big-endian words and multiplies by this scale. Thus the actual factor is **Single(0.1)**, not 6553/65535. Using the latter left two mismatches after the final-value correction.
3. `LoadBAP` (`0x00701BC0`) allocates a 1-based table, stride **0x34**, with gauge pressure at +4 and effective pressure at +0x0C. At `0x00703671–0x00703677` it **overwrites the last gauge reading with the database End_pressure**. At `0x007038E2` it recomputes the last effective pressure. The end value is rounded to two decimals by the importer. This replacement explains the short/high-pressure mismatches and why the earlier fitted window appeared to help.
4. Per-sample effective pressure is decoded at `0x00716250`: `P - headLoss + groutColumn - waterColumn`, with column helpers `0x00716150` / `0x00716050`. Negative corrected table values clamp to zero. The reference cases have zero head loss and a **+0.1 bar** column correction for both means. There is no special 0.0981 factor for the 30-second mean.
5. `CalcPressionMoyenne` (`0x00726FF0`) visits **1 through UBound inclusive**, sums raw and effective pressure independently, and divides by UBound. The sum is stored as **Single after every addition** (`0x0072716F–0x00727176`, `0x00727206–0x0072720D`) and the quotient is also Single.
6. `GetValPression30` (`0x0071A3C0`) visits the table **backwards, including the replaced final reading**, until its integer elapsed-time accumulator reaches 30. After each sample it adds the Single storage step and converts back to integer with VB's ties-to-even rounding (`0x0071A605–0x0071A62A`). It divides by the number of readings used (`0x0071A65E–0x0071A693`), so a short record is divided by its actual count. For the reference 1-second recordings this is the last 30 table readings, or the whole table if shorter.

Implemented in `js/export.js` with `Math.fround` at the native Single stores. The raw-import path is unchanged. Synthetic regressions distinguish the final replacement, ties-to-even quantization, storage steps, short records, per-sample clamping/head loss, and Single accumulation. An opt-in integration test checks every original cell and complete CSV text when `GROUT_FIDELITY_DFI_DIR` and `GROUT_FIDELITY_CSV` are set.

**Historical fitted rule, superseded and removed:** a 29-reading window before the final sample plus 0.0981 column factor yielded 55/83 identical rows (67/83 averages, 58/83 30-second values). Those constants were selected by numeric search, not decoded. They are no longer active. The decoded replacement raises the result to **83/83 rows, 83/83 average pressures, 83/83 30-second pressures**, with all other columns unchanged. Non-default density, ground water, variable storage steps and nonzero head loss have synthetic coverage but still need independent original exports for end-to-end verification.

## Printouts: measured from real specimens

Three real printouts ("Microsoft Print to PDF", A4 landscape) were analysed as vector data (`tests/fixtures/spec-*.json`, extracted with a content-stream parser). The curves include 600 dpi printer-dot quantization (about 0.0423 mm); do not infer their accuracy from rounded text positions. Findings that drive `js/original.js`:

* **Frames:** time report 5 mm margins (frame 5–291.97 × 35.98–202.95 mm); the other two 6.99–289.94 mm. Header box 9.99–24.95 mm with an empty logo cell (left, to x = 100.63 / 101.3) and, right of it, site (14.16 pt bold), "GROUTING" (8.88 pt), contract in brackets (right-aligned, date when the contract is empty), report title (8.88 pt) at the cell's bottom left, and a grey "DLGPVD  6.61/DPV 8.10" tag under the box. Footer at y = 207.35: "...", a grey company line, regular page "n/N" (source font resource F1).
* **Time report:** five columns of 57.39 mm; per column a header (bold hole name + " sleeve (top-bottom m)", blue "(50 bar)" over the left half, date-time of the record start) and a plot starting at y = 45.76 whose height is *measuring-clock duration ÷ scale* (352.78 s at 1 cm = 60 s = 58.8 mm). Ten dashed divisions, solid centre line and right edge. **Correction:** the PDF's `[0.5 0.5]` dash array is in user units under a 0.75-point transform: each dash/gap is **0.1322917 mm**, with round caps (`1 J`), not 0.5 mm. **The column is twice the entered scale wide** (the 50 bar line is the centre). Ticks every cm in the page margin. Curve = every sample from the first record to the last pump stop plotted against the measuring clock (idle time does not advance it); it starts on the zero line. Red line = the SetCons pressure limit. Footer row: stop type in red ("Manu_StopOperator" → "operator (M)"), total volume rounded to a whole litre with one decimal ("6,0 l"), volume limit in red brackets, grout type right-aligned with a 0.6 mm margin; an unnamed grout prints the literal **"Unknow"** (a string literal in the original's import code, found with REA).
* **Pressure/Volume/GIN:** plot 27.01–280.12 × 51.01–155.96 mm, majors every 5 bar / 10 l (0.25 mm) and minors in between (0.17 mm), pressure blue 0.34 mm, penetrability brown #804040 0.55 mm with its own left axis. The measured curve baseline is **155.998 mm**, one printer dot below the grid axis. **Correction:** the curve retains all 363 samples, including pressure changes after reaching reported volume; the former implementation dropped these and retained only 84 points. The volume-cap rule below is fitted.
* **Pressure/Volume/Flow:** three depth charts with 0–10 scales, a two-row information table; only a single sleeve at a single depth was available.
* The average pressure printed in the depth report for the sample hole is **"2,2"**, now reproduced using the native effective-pressure mean rather than the raw sample mean (which printed 2,1). The report reads the metric Injections values; its dependence on non-default effective-pressure options still needs an original option matrix.

### Plot table reconstruction and endpoint checks (2026-11-04)

**Decoded:** `DXdataPVD.DPVdata.DPVrecord.SetMesuresBytes`, IL_0205–03AA, stores pressure and flow as tenths (Single input, ties-to-even rounding), and positive monotonic volume increments as **0.01 litre** units. `LoadBAP` accumulates volume as Single and applies the final reported pressure override described above (and a positive reported final-flow override). `js/original.js` now reconstructs this table without changing raw data. Synthetic tests cover quantization, volume increments, final overrides, effective correction and input immutability.

**FITTED:** cap cumulative plot volume at the reported injected total while retaining every sample. Quantized increments plus this cap match **all 363 original x endpoints**, maximum error **0.03510 mm**. The precise native instruction implementing the cap has not yet been isolated; it must not be described as decoded.

The tests compare every supplied segment endpoint, not only curve bounding boxes:

| Curve | Original segments checked | Maximum x error (mm) | Maximum y error (mm) |
| --- | ---: | ---: | ---: |
| Pressure/time | 360 | 0.03849 | 0.04513 |
| Pressure/volume | 363 | 0.03510 | 0.03520 |
| Penetrability/volume | 363 | 0.03510 | 0.04534 |

All are below the **0.05 mm** test tolerance. The time trace can contain one additional coincident event-snapshot point; no new stop/de-duplication rule was fitted. Tests also inflate the actual generated PDF streams to verify every P/V pressure coordinate, 0.375-point grid dashes, line caps, rectangle joins and regular footer numbering.

**Typography/output limits:** native page callbacks set Arial; embedded source font name tables confirm Arial regular and bold. Original SVG pages now select Arial first. An isolated Edge `file://` check exercised the real Print and Save PDF buttons for all three modes: **zero HTTP(S) requests, zero page errors**, browser PDFs embed Arial. Browser PDFs and direct PDFs were rendered and visually inspected using bundled Python/pdfium (no Python installation). Direct Save PDF still uses standard Helvetica, so it is not typographically identical. Edge's A4 MediaBox height is 594.95996 pt versus 595.32001 pt in the desktop specimen (about 0.127 mm difference). These checks do not establish pixel-identical output, nor verify flow-enabled time curves, smoothing, multi-sleeve continuation or every option combination.

### Remaining uncertainty
Behaviour with several sleeves per hole, long records that exceed a column, other stop types and non-default option combinations follows the same rules but was not available as specimens. To close this, print such a case from the original to PDF and add it to `tests/fixtures` (see `tests/original.test.mjs` for how a specimen is compared).

**Web layout guard (2026-11-04 bug review):** water-test tables now calculate their page capacity from the frame height, row/header heights and a 16 mm allowance for totals and the note (9 rows on the chart page, 24 on continuation pages). The previous fixed 30-row continuation table ended at **218.6 mm**, outside the 202.96 mm frame, and the clamped summary could overlap rows. A synthetic 45-stage regression checks every row and summary position. This is an authored pagination correction to the interpreted layout, **not evidence of the native water-test layout**.

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
* **Correction (2026-11-04):** the diagnostic BSTRs do have direct native `PUSH` references. `GetValLugeon30`, `IsPalierLine` and `IsLugeonRecord` are now located (table below). `FindFirstPalierStart` still has no such reference. The earlier absence of Ghidra xrefs was not proof of absent references in the executable.
* **Not found in the native code:** a hydrostatic term in the stage computation. The ~0.1 bar difference in the pressure averages turned out to live in the .NET assembly (see "Resolved" above).

### Still open
The remaining questions need a water-test printout plus its DFI file to check against.

### Repeatable VB6 inventory (2026-11-04)

`tools/re/vb6-map.mjs` reads a **copy** of the binary without loading it. It follows the PE entry-point `push VBHeader; call`, then ProjectInfo, ObjectTable, public descriptors and optional control/event tables. Result for SHA-256 `a50a6fee27ca415b35b87b3d02f8f414cc00ff5191941f1d51c0c84e80b6d683`: **85 objects, 839 controls, 475 native event labels, 66 diagnostic strings with 69 PUSH references**, zero unsupported event thunks. These are decoded metadata, not numeric fits. Descriptor layouts were cross-checked against [python-vb](https://github.com/williballenthin/python-vb/blob/master/vb/__init__.py) and the [vbdec format reference](https://sandsprite.com/vbdec/VB6_FileFormat_Spec.html).

Important limitation: **native `ObjectInfo.lpMethods` enumerates API declarations**, not every application procedure. Many private procedure-name slots are null, and standard modules have no name array. The assignment's proposed full `ProcDescInfo` name walk cannot recover all native procedure names. Event-table jump targets are reliable; the nearest validated x86 prologue before a diagnostic PUSH is emitted only as a **candidate**, requiring instruction inspection.

**Decoded extension, 2026-11-04:** `OptionalObjectInfo + 0x28` holds the native method-link count and `+0x30` the pointer table. Entries point directly to an `E9 rel32` jump, eight bytes after the this-adjustment thunk. This recovers **898 native procedure links**, in addition to the 475 event labels. Ten unsupported method/property thunk shapes are warned about and skipped. Generated Ghidra scripts apply anonymous `Form_nativeProcN` labels, preserving aliases and leaving diagnostic candidates unapplied; these labels are metadata identities, not recovered VB source names. Synthetic tests verify virtual-address translation and jump resolution.

Relevant print owners contain 42 links for `Tft`, 48 for `DiagSynthetic` and 36 for `DiagPVD`. Static instruction reading located these entry points:

| Address | Metadata / diagnostic identity | Print role |
| --- | --- | --- |
| `0x007E0F80`, `0x007EADA0`, `0x007F47B0`, `0x007FCAC0` | `Tft_nativeProc24` through `27` | Time-report drawing routines; complete option semantics remain open |
| `0x00586710` | `DiagSynthetic_nativeProc23` | Table/graph drawing |
| `0x00595320`, `0x00595EE0` | `TraiteSetCons`, `TraiteSetSleeve` (diagnostics) | Instruction and sleeve processing |
| `0x00596250`, `0x00596D60` | `TraceGraphGIN`, `TraceGraphPenetrabilite` (diagnostics) | GIN and penetrability curves |
| `0x0059BEC0` | `DessineCourbePenetrabilité` (diagnostic) | Penetrability drawing |
| `0x005BAAB0`, `0x005C2D70` | `DiagPVD.EcritParametres`, `EcritTranche` (diagnostics) | Depth-report parameters and sleeve row |
| `0x007E0120`, `0x00584FC0`, `0x005C5090` | Page-event callbacks for the three forms | Set the printer font to Arial |

```
node tools/re/vb6-map.mjs <binary-copy> <work-folder>/vb6-map.json <work-folder>/DlgEventLabels.java
```

The original portable Ghidra folder is incomplete (no `support/analyzeHeadless.bat`) and the REA package is absent. Native formulas were instead read with `iced-x86` 1.22.0, installed with scripts disabled in the separate `../grout-re-work` folder. Its package integrity is recorded in that folder's lockfile. No app dependency or .NET SDK was added. Binary copies, disassemblies, database copies and generated inventories stay outside this repo.

| Function / instruction address | VB name / identity | What is established |
| --- | --- | --- |
| `0x006D9E10` | scale-marker decoder (name unknown) | Special cases 65, 655, 6553 as 65535/1000, /100, /10 |
| `0x00701BC0` | `LoadBAP` (diagnostic name) | Builds the 1-based, 0x34-byte measurement table and final-value overrides |
| `0x00704D50` | `PressionMoyenne` | Legacy configurable end-window calculation; separate from whole-table mean |
| `0x00710270` | signed-word decoder (name unknown) | Converts the two-byte value to signed Int16 |
| `0x007103A0` | scaled sample decoder (name unknown) | Signed big-endian word multiplied by Single scale |
| `0x00710A20` | `IsPalierLine` | Body located through diagnostic PUSH; stage semantics remain to be read |
| `0x00715100` | `IsLugeonRecord` | Body located through diagnostic PUSH |
| `0x00716050` | water-column helper (name unknown) | Water-depth correction, conditional on water above section middle |
| `0x00716150` | grout-column helper (name unknown) | `cos(angle*pi/180) * middle * (density/1000) / 10` |
| `0x00716250` | effective-pressure helper (name unknown) | `P - headLoss + groutColumn - waterColumn` |
| `0x0071A3C0` | `GetValPression30` | Backward pressure mean with integer elapsed-time accumulator |
| `0x0071AE50` | `GetValLugeon30` | Body located through diagnostic PUSH; stage use remains to be decoded |
| `0x00726FF0` | `CalcPressionMoyenne` | Whole-table raw/effective means, Single accumulation |

This inventory recovers runtime control names and event wiring, **not yet** serialized captions, control positions or full print geometry. Existing specimen-derived layouts remain the verified print evidence.

## Reproducing the analysis

* Resources: load assemblies with `[Reflection.Assembly]::ReflectionOnlyLoadFrom` and call `GetManifestResourceStream` (nothing executes).
* IL: `powershell -File tools/re/il-disassemble.ps1 -Dll DXdataPVD.exe -Type DXdataPVD.DPVdata.InjectionDPV -Method get_AveragePressure`.
* Database: copy a `.BAK`/`.mdb` first, then read it with Jet OLEDB from 32-bit PowerShell (`Mode=Read`).
