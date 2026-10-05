# DFI Viewer — DFI · DMJ · REC

Import grouting measurements, inspect pressure/flow/volume, and preview or print PDF reports. Swedish, English and Norwegian. All files are processed locally in the browser.

## Run and verify

Use Node.js 24 or newer:

```sh
npm ci
npm test
npm run build
npm run dev
```

`npm run preview` serves the production `dist/` build. Keep `node_modules` on the platform where it was installed; Linux native dependencies cannot run on Windows.

## GitHub Pages

The included workflow tests and builds pull requests and deploys successful `main` builds. In **Settings → Pages**, select **GitHub Actions** as the source. Push to `main` or run the workflow manually. Expected URL: `https://nomsams.github.io/dfidmiviewer/`.

Relative asset URLs support repository subdirectories and custom domains. Scripts, styles, favicon and examples need no server rewrite rules. Deployment follows the [Vite GitHub Pages guidance](https://vite.dev/guide/static-deploy.html#github-pages).

## Import and print

Drop DFI archives or `REC.TXT`. Two examples are bundled. Update-only DMJ archives are identified without inventing measurements; measurement archives are decoded by contents regardless of extension.

Classic is a compact monochrome A4 sheet with metadata, summary values, separately labelled measured and recorder-reported end values, and a P/Q/V diagram. Modern uses the same data with colour. **Preview / print PDF** opens the browser's PDF viewer for printing or saving. Complete events, settings, raw data, indicative GIN and signatures are optional. CSV retains every sample's precision.

Company and print preferences persist. Header edits and comments belong to each individual imported record and are not reused for another file. Batch reports preserve each record's identity; the summary uses original record metadata.

## Accuracy

Binary records and tar headers have checked checksums. Text and binary samples are compared where both exist; original float32 values are retained. Text is decoded by channel identifier and explicit units, supporting reordered columns, decimal commas, scientific notation and additional channels. Extra channels are retained in CSV and the full data table.

Corrupt/truncated data, missing values, contradictory sources, reset counters, unsupported binary layouts and inconsistent measurement windows produce visible errors. Print curves use every source point, with independent numerical P/Q/V scales. Optional tables have no row caps.

Pressure averages use trapezoidal time weighting inside active measurement windows. Mean flow is the measured cumulative end volume divided by active time. End channel values come from the last measurement stop; rounded `PumpStop` values are shown separately. Maxima cover recorded samples. Last-30-second averages use the recorded measurement clock within active windows. GIN is an explicitly indicative pressure × volume comparison.

[ACCURACY.md](ACCURACY.md) records the independent checks and parity limits. Exact original layout and legacy averaging parity require an original print specimen and its settings.

## PDF verification

`npm run verify:pdf` creates both layouts in all three languages and a multi-page summary in ignored `tmp/pdfs/`. Render them when changing layout. Embedded open fonts preserve Nordic glyphs; unsupported characters block PDF export visibly. The font redistribution license is in `src/assets/FONT-LICENSE.txt`.
