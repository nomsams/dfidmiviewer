# DFI Viewer maintenance

Accuracy is paramount. Read ACCURACY.md before changing parsing/statistics. Preserve source values and provenance; never adjust them to fit a guessed legacy result.

- Keep the app static and usable under a GitHub Pages repository subdirectory.
- Keep UI/report wording in the SV/EN/NO dictionaries. Preserve device field values.
- Keep application branding neutral; no original vendor/software names in authored wording.
- Run `npm test` and `npm run build` on Node 24+. Native dependencies must match the host. Do not reinstall a shared Linux dependency directory from Windows.
- Render changed PDF layouts, including continuation pages. PDF/CSV exports must not silently cap or decimate source rows.
- Reject corrupt/unsupported measurements visibly and add independent regression cases.
- Keep database copies, executable analysis, generated reports and local build helpers in ignored `tmp/`.
