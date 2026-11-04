/* Minimal Excel (.xlsx) writer: one worksheet, typed cells, bold header, frozen first row, filter, column widths. No dependencies;
   the archive is made by G.zip (store only, which Excel accepts). Strings are written inline, so no shared-string table is needed. */
(function (G) {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

  /* XML 1.0 forbids most control characters, even escaped: drop them (a stray one would make Excel refuse the whole file). */
  const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
  const esc = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function colName(n) { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }
  /* sheet names: at most 31 characters, none of  \ / ? * [ ] :  and not empty */
  const sheetName = (s) => (clean(s).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet1');

  /* cell styles (indexes into cellXfs below) */
  const ST = { plain: 0, head: 1, dec2: 2, int: 3, totText: 4, totNum: 5 };
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="' + NS + '">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA5BD"/></bottom><diagonal/></border>' +
    '<border><left/><right/><top style="thin"><color rgb="FF9AA5BD"/></top><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="2" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function cell(ref, v, style) {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return style ? '<c r="' + ref + '" s="' + style + '"/>' : '';
    const s = style ? ' s="' + style + '"' : '';
    if (typeof v === 'number') return '<c r="' + ref + '"' + s + '><v>' + String(v) + '</v></c>';
    const txt = clean(v), sp = /^\s|\s$|\n/.test(txt) ? ' xml:space="preserve"' : '';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t' + sp + '>' + esc(txt) + '</t></is></c>';
  }

  /* spec: { name, header: [text], types: ['text'|'int'|'dec'|'num'], rows: [[value]], widths: [chars], total: index of a bold last row or -1 } */
  function build(spec) {
    const header = spec.header, n = header.length, rows = spec.rows, types = spec.types || [], totalRow = spec.total != null ? spec.total : -1;
    const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="' + NS + '" xmlns:r="' + RNS + '">'];
    const last = colName(Math.max(0, n - 1)) + (rows.length + 1);
    out.push('<dimension ref="A1:' + last + '"/>');
    out.push('<sheetViews><sheetView workbookViewId="0" showGridLines="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15"/>');
    out.push('<cols>' + header.map((h, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.max(6, Math.min(60, (spec.widths && spec.widths[i]) || String(h).length + 3)).toFixed(2) + '" customWidth="1"/>').join('') + '</cols>');
    out.push('<sheetData>');
    out.push('<row r="1" ht="20" customHeight="1">' + header.map((h, i) => cell(colName(i) + '1', h, ST.head)).join('') + '</row>');
    rows.forEach((r, ri) => {
      const isTot = ri === totalRow;
      out.push('<row r="' + (ri + 2) + '">' + r.map((v, ci) => {
        const ty = types[ci] || 'text';
        const st = typeof v === 'number' ? (isTot ? ST.totNum : ty === 'int' ? ST.int : ty === 'dec' ? ST.dec2 : ST.plain) : isTot ? ST.totText : ST.plain;
        return cell(colName(ci) + (ri + 2), v, st);
      }).join('') + '</row>');
    });
    out.push('</sheetData>');
    if (rows.length && !(totalRow >= 0 && rows.length === 1)) out.push('<autoFilter ref="A1:' + colName(Math.max(0, n - 1)) + (totalRow >= 0 ? rows.length : rows.length + 1) + '"/>');
    out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup orientation="landscape"/>');
    out.push('</worksheet>');
    const enc = new TextEncoder(), name = sheetName(spec.name || 'Sheet1');
    const files = [
      { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>') },
      { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>') },
      { name: 'docProps/core.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + esc(spec.title || name) + '</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created></cp:coreProperties>') },
      { name: 'docProps/app.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>') },
      { name: 'xl/workbook.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS + '" xmlns:r="' + RNS + '"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000"/></bookViews><sheets><sheet name="' + esc(name) + '" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
      { name: 'xl/styles.xml', data: enc.encode(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(out.join('')) },
    ];
    return G.zip(files);
  }
  G.xlsx = { build, colName, sheetName };
})(window.G = window.G || {});
