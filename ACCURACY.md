# Accuracy audit

The handoff was checked against source archives, event XML and a read-only copy of the original application's database backup. No installer was run and original device data was not changed. Database copies, executable analysis and generated QA artifacts are excluded from Git.

## Checked facts

| Check | Result |
| --- | --- |
| Fixture samples | 363 for hole 18-2; 483 for hole 18-1 |
| Binary layout | 4-byte trigger, channel count, five little-endian float32 values, 2-byte little-endian additive checksum |
| Binary checksums | Every record in both fixtures passes |
| Events | XML decimal byte offsets identify exact binary snapshots |
| Units | Pa ÷ 100000 → bar; m³/s × 60000 → l/min; m³ × 1000 → litres |
| Control settings | 4 bar pressure, 3000 litres volume, 8 bar safety; corroborated by database |
| Hole 18-1 measured end | 1.8891196875 bar; 18.01200583577156 litres |
| Hole 18-1 reported end | PumpStop: 1.8 bar, 0 l/min, 18 litres; matches stored rounded database values |
| Measurement phases | Five pairs for hole 18-1; four subsequent starts |
| Active time | 452.3720703125 seconds, summed across paired start/stop clocks |
| Mean flow | 2.3890076798944038 l/min, displayed as 2.39, matching database precision |

## Differences that must remain explicit

The original database's two injection tables disagree for the same record: average pressure 2.15 vs 2.05 bar, and last-30-second pressure 2.13 vs 2.02 bar. One borehole label has been edited to blank. These values cannot establish a unique averaging formula or print configuration.

The previous port used an unweighted active-sample pressure mean around 2.10 bar and incorrectly described some results as exact matches. Current reports state their method: trapezoidal time weighting within measurement boundaries. Hole 18-1 gives 2.1141193839898946 bar (2.11 displayed), with last-30-second pressure 2.14844540625 bar (2.15 displayed). These are reproducible raw-file calculations, not claims of undocumented legacy averaging parity.

Recorder clocks can differ slightly from event wall-clock date differences. Active time excludes clock increments between a stop and the next start. Original timestamps and clocks are retained independently. Text flow values have less precision than binary values. Rounded pump-stop values never overwrite channel snapshots.

## Print parity

Classic reconstructs a compact monochrome A4 sheet: metadata, summary, calibrated combined plot, comment and optional signatures, with complete appendices. Original per-hole print specimens were not present in the inspected workspace. Existing earlier PDFs came from the port and cannot prove parity. Exact original typography, placement and configurable summary options remain unverified.

Tests cover real fixtures, text/binary import, units and reordered channels, malformed archives/XML, binary checksums, active-window statistics, end-value provenance, all languages/layouts, spike retention, uncapped tables and multi-page summaries. Rendered checks cover Nordic glyphs, boundaries, continuation headers/footers and the last raw sample.

## Unsupported cases

Only the verified five-channel binary layout is accepted. Text supports additional channels. Multiple measurement sets in one archive, reset counters and incomplete/mismatched measurement windows produce errors rather than silent estimates. Files above 100 MiB are rejected. Unsupported PDF glyphs block export instead of becoming blank characters.
