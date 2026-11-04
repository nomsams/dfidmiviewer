# Grout Report Viewer

Open a `.DFI` measurement file, check the results, then **print the report or save it as a PDF**.
Pure HTML, CSS and JavaScript. No build step, no server, no uploads: everything runs in the browser.

## Use it

Open `index.html` in a browser (double-click works), or serve the folder with any static web server.

**Excel export (default)** – one spreadsheet from many measurement files:
1. Add files in any of three ways: **drag and drop** them (or a whole folder, or a `.zip`), **click the box**, or press **Choose files…** / **Choose a folder…**. A hundred files or more are fine (720 were tried; reading is sliced so the page stays responsive and shows progress). The same file added twice is skipped.
2. Tick the files to include, choose the columns (the ones that contain data are ticked for you; *All columns* gives the original's 29), and optionally add a totals row, sort the rows, or add the effective pressure.
3. Slide the switch between **Excel (.xlsx)** (default) and **CSV**, then **Download**. The CSV is the original program's *Site > Export > Field separator > Semicolon* file (header, `;`, decimal comma, one row per file). You can also copy the table to the clipboard or get all PDF reports as a ZIP. *More options* has **Use the original program’s pressure calculations** (on by default). With the default effective-pressure settings, every column matches all 83 reference rows; the full CSV also matches the original export byte for byte when the same row order and columns are selected. The pressure calculations are decoded from native instructions (see RE-NOTES).

**Reports mode** – for people who just want to read and print one file:
1. Drag a `.DFI` file onto the page (or *Choose file…*, or *Try an example*).
2. Read the key numbers and the pressure / flow / volume chart.
3. Pick the report style (**Original** or **Modern**), optionally the report and "fit the axes automatically", then **Print**, **Save as PDF** or **Preview**.

**Advanced mode** – everything the original software offers, and more:

| Tab | What it does |
| --- | --- |
| Overview | File details, setpoints, and every result under both calculation methods side by side |
| Chart | Zoom / pan / hover read-out, time base, measuring-period shading, **axes: automatic or manual maxima** |
| Data / Events / Settings | All samples, the event log with measuring periods, device parameters |
| Report designer | Live preview and every option of the printouts (below) |
| Summary table | One table for all loaded holes, column picker, print/PDF/CSV |
| Export | CSV of the samples, PDF of one/all files, summary PDF, summary in the original software's CSV format |

## Printouts

### Original (default) — the original software's A4 landscape reports
The first three were measured from real printouts (see `tests/fixtures`) and are checked by automated tests; the last two are built from the original's menus and captions.

1. **Pressure and flow in accordance to time** – five sleeve columns per page, time running down the page (`1 cm = 60 s`), blue pressure curve with its scale `(50 bar)`, optional green flow, brown penetrability, GIN, red pressure-limit line, dashed ten-division grid with solid centre line, footer row per column (stop type, total volume, volume limit, grout type).
2. **Pressure/Volume/GIN** – pressure and penetrability against volume with the original grid; optional GIN envelope.
3. **Pressure/Volume/Flow** – averages per sleeve against depth (built from a one-sleeve sample, so deeper profiles are an extrapolation).
4. **Distribution of the grouted volumes** (the original's *Volume diagram*) – histogram over all loaded injections.
5. **Water test diagram (Lugeon)** – stages (from `LugeonStart/Stop` events or pressure plateaus), per-stage averages and the apparent Lugeon value in l/min/m at 10 bar. *Indicative:* no water-test file was available to verify it.

Options mirror the original's *Page setting* dialog (plus pressure in **kg/cm²** and the **decimals** of printed values, which the original also offers): time scale, per-curve scales and colours, smoothing, header titles and logo, 1 sleeve per page, grouting limits, sleeve info, stop type, end time, duration, grout type, total volume, volume limit, average pressure and flow, final pressure, effective pressure.

### Axes: as original, or automatic
* **As original** (default): the entered scales are used (time `1 cm = 60 s`, pressure `50`, flow `100`, volume `100`, …). An empty/0 field means *automatic for that curve*. In the time chart the column width is twice the scale; the centre line marks the scale.
* **Automatic**: time step and every curve scale are chosen from the data so everything fits; the P/V plots use tight axes.
* The interactive chart has its own *Automatic / Manual* axis control (maximum for P, Q, V).

### Multicriteria report (Summary table)
The original's *Multicriteria report*: selection by pressure / flow ranges (average, last 30 s or final), start hour, dates, stop type and pump; sort order; **daily totals** and grand totals (volume, number of injections, duration). Filters apply to the table, the PDF and the CSV.

### Output like the original's LutzPDF printer
The original prints through *LutzPDF* (PostScript → Ghostscript → PDF 1.3 prepress, or **JPEG at 300 dpi**) and offers *page selection* and *"1 file per document (PDF printing)"*. The same is available here, without any printer driver:
* **Pages** field (e.g. `1-3,5`) for printing, PDF and JPEG;
* **One PDF per file (ZIP)**;
* **Pages as JPEG (ZIP)** at 150 / 300 / 600 dpi.

### Modern and Cards (other layouts)
* **Modern** – portrait page with one centimetre-grid diagram holding all curves.
* **Cards** – dashboard-style page with KPI cards.

Preview, browser printing and the PDF file share drawing geometry (SVG for screen/print, jsPDF for the file). For the closest typography to the original specimens on Windows, choose **Original → Print → Save as PDF**: browser printing uses installed Arial. The direct **Save as PDF** button uses standard Helvetica. PDFs retain every plotted sample without decimation or row caps.

The current specimen checks cover all 363 pressure/volume and penetrability endpoints and all 360 pressure/time segments, with coordinate differences below **0.05 mm**. The web page and both PDF actions also work from `file://` without network requests. This verifies the supplied single-sleeve examples; it does not establish identical output for every print setting.

## Themes and languages
Automatic (follows the OS), Light, Dark, Forest, Ocean, Sunset, High contrast. English, Svenska, Français, Norsk. Choices are remembered in the browser.

## Compatibility and robustness
* Classic scripts only (no modules, no network, no build): works from `file://` and under any sub-path.
* Needs a current Chrome, Edge, Firefox or Safari (ES2017 + canvas + Blob). Older browsers get a clear message instead of a blank page.
* Files are validated strictly (tar and record checksums, XML structure, text-vs-binary cross-check). Damaged or foreign files are refused with a plain-language reason; update packages (`.DMJ`) are recognised.
* Real field files are tolerated: tried on 100 files from the site (all load). The volume counter loses a few millilitres when the pump restarts, the measuring clock can step back by rounding noise, and a record with no injection can read a negative volume. Such counters are continued from their earlier value (a larger step, over 1 s or 1 l, adds a warning to the file) instead of refusing the file.
* Very large recordings and degenerate ones (empty, one sample, no events) are handled; all layouts × languages × document types are covered by tests.

## Development

```
npm test               # Node >= 20, no dependencies; optional private fidelity test below
npm run serve          # tiny static server on http://localhost:8123 (dev only)
node tools/check-i18n.mjs
```

To include the private 83-row fidelity check, set `GROUT_FIDELITY_DFI_DIR` to the local DFI folder and `GROUT_FIDELITY_CSV` to the original export, then run `npm test`. Without those paths that integration test is skipped; synthetic regression tests still cover the native pressure rules. Private files must stay outside git.

```
index.html            page shell
css/app.css           themes (CSS variables), layout, print rules
js/core.js            tar + DFI/REC parser (checksum-validated), own XML reader, statistics, CSV
js/draw.js            drawing layer with SVG and PDF back-ends
js/report.js          options, Modern and Cards sheets, summary table, appendices
js/original.js        the three measured Original reports
js/original2.js       volume distribution and water test (Lugeon) reports
js/zip.js             ZIP writer and page-range parser (PDF per file, JPEG pages)
js/chart.js           interactive canvas chart
js/app.js             Simple/Advanced UI, report designer, preview/print/PDF
js/i18n.js            all text (English is the master; add a language by adding an object)
js/samples.js         two embedded example files
js/vendor/            jsPDF (MIT)
tests/                core + robustness, fidelity against the real printouts, static UI checks
tools/                make-samples, check-i18n, serve (dev only), re/ (reverse-engineering helper)
RE-NOTES.md           what was learned from the original software, and what is still open
```

## Accuracy and known gaps
Read **RE-NOTES.md** before relying on the numbers. In short:

* File format, units, checksums and the statistics formulas come from the original import code and reproduce the original for volume, durations, end pressure, average flow and stop type.
* Export compatibility calculations reproduce all 83 original rows, including both pressure means. The native program quantizes readings, replaces the final sampled pressure with the reported end pressure, applies the effective-pressure correction to each reading, and accumulates in single precision. The export defaults to this calculation and effective pressure (1000 kg/m³, vertical, no ground water). These defaults are verified for the available specimens, not every possible site configuration.
* The volume-distribution and water-test (Lugeon) pages are interpretations of the original's menus (no specimen). The native Lugeon formula is decoded; the stage-selection and page layout still need verification, so stages are detected here from events or pressure plateaus.
* Only one-sleeve printouts were available. Multi-sleeve pages, other stop types and the depth report with several sleeves follow the same rules but are not verified against real prints.
* An unnamed grout prints the original's own literal default, **"Unknow"** (it is spelled that way in the original's code).

No warranty; verify printed values before relying on them.

## Password
The page opens behind a password gate (same mechanism as the pqview project: SHA-256 hash of the typed password, case ignored). Signing in is remembered for the browser tab and shares the unlock flag (`sessionStorage` key `pq.unlocked`) with pqview, which lives on the same site, so one sign-in opens both when you follow the gauge icon in the top bar. The padlock icon locks the tool again. This runs in the browser, so it keeps casual visitors out but is not real security; measurement files never leave your computer either way.
