/* Drawing layer. Report code draws in millimetres on "pages"; two backends render the same calls:
 *   G.svgDoc()  -> SVG strings (screen preview and browser printing)
 *   G.pdfDoc()  -> jsPDF document (vector PDF file)
 * Using one code path guarantees that preview, print and PDF are identical.
 */
(function (G) {
  'use strict';
  const PT = 25.4 / 72; // mm per typographic point

  /* Characters outside WinAnsi cannot be shown by the built-in PDF fonts. */
  G.safe = function (s) {
    return String(s == null ? '' : s)
      .replace(/[‐-―−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/…/g, '...').replace(/→/g, '->').replace(/≤/g, '<=').replace(/≥/g, '>=')
      .replace(/[\r\n\t]+/g, ' ').replace(/[^ -~ -ÿ€•]/g, '?');
  };

  let measurer = null;
  G.textWidth = function (s, size, bold) {
    if (!measurer) measurer = new window.jspdf.jsPDF({ unit: 'mm' });
    measurer.setFont('helvetica', bold ? 'bold' : 'normal'); measurer.setFontSize(size);
    return measurer.getTextWidth(G.safe(s));
  };
  /* Shortens text with an ellipsis until it fits the width (mm). */
  G.fit = function (s, width, size, bold) {
    s = G.safe(s);
    if (G.textWidth(s, size, bold) <= width) return s;
    while (s.length > 1 && G.textWidth(s + '...', size, bold) > width) s = s.slice(0, -1);
    return s + '...';
  };

  /* Clips a polyline to a rectangle; returns a list of polylines (Liang-Barsky per segment). */
  G.clipPoly = function (pts, r) {
    const out = []; let cur = null;
    const x0 = r.x, x1 = r.x + r.w, y0 = r.y, y1 = r.y + r.h;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay;
      let t0 = 0, t1 = 1, ok = true;
      for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
        if (p === 0) { if (q < 0) { ok = false; break; } }
        else { const t = q / p; if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; } }
      }
      if (!ok) { cur = null; continue; }
      const sx = ax + t0 * dx, sy = ay + t0 * dy, ex = ax + t1 * dx, ey = ay + t1 * dy;
      if (!cur || t0 > 0) { cur = [[sx, sy]]; out.push(cur); }
      cur.push([ex, ey]);
      if (t1 < 1) cur = null;
    }
    return out;
  };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n3 = (n) => (Math.round(n * 1000) / 1000).toString();

  /* ---------------- SVG backend ---------------- */
  G.svgDoc = function () {
    const pages = [];
    const doc = {
      kind: 'svg', pages,
      addPage(w, h) {
        const parts = [];
        const p = {
          w, h, no: pages.length,
          line(x1, y1, x2, y2, o) {
            o = o || {};
            parts.push(`<line x1="${n3(x1)}" y1="${n3(y1)}" x2="${n3(x2)}" y2="${n3(y2)}" stroke="${o.c || '#000'}" stroke-width="${o.w || 0.2}"${o.dash ? ` stroke-dasharray="${o.dash.join(' ')}"` : ''}/>`);
          },
          rect(x, y, rw, rh, o) {
            o = o || {};
            parts.push(`<rect x="${n3(x)}" y="${n3(y)}" width="${n3(rw)}" height="${n3(rh)}"${o.r ? ` rx="${o.r}"` : ''} fill="${o.fill || 'none'}" stroke="${o.stroke || 'none'}" stroke-width="${o.w || 0.2}"${o.dash ? ` stroke-dasharray="${o.dash.join(' ')}"` : ''}/>`);
          },
          poly(points, o) {
            o = o || {}; if (points.length < 2) return;
            parts.push(`<polyline points="${points.map((q) => n3(q[0]) + ',' + n3(q[1])).join(' ')}" fill="none" stroke="${o.c || '#000'}" stroke-width="${o.w || 0.3}" stroke-linejoin="round" stroke-linecap="round"${o.dash ? ` stroke-dasharray="${o.dash.join(' ')}"` : ''}/>`);
          },
          image(data, x, y, iw, ih) {
            if (!data || !/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(data)) return;
            parts.push(`<image href="${data}" x="${n3(x)}" y="${n3(y)}" width="${n3(iw)}" height="${n3(ih)}" preserveAspectRatio="xMidYMid meet"/>`);
          },
          area(points, o) { // filled polygon
            o = o || {}; if (points.length < 3) return;
            parts.push(`<polygon points="${points.map((q) => n3(q[0]) + ',' + n3(q[1])).join(' ')}" fill="${o.fill || '#000'}" fill-opacity="${o.opacity == null ? 1 : o.opacity}" stroke="none"/>`);
          },
          text(s, x, y, o) {
            o = o || {}; s = G.safe(s); if (!s) return;
            const anchor = o.align === 'right' ? 'end' : o.align === 'center' ? 'middle' : 'start';
            const rot = o.rot ? ` transform="rotate(${-o.rot} ${n3(x)} ${n3(y)})"` : '';
            parts.push(`<text xml:space="preserve" style="white-space:pre" x="${n3(x)}" y="${n3(y)}" font-size="${n3((o.size || 8) * PT)}" font-weight="${o.bold ? 700 : 400}"${o.italic ? ' font-style="italic"' : ''} fill="${o.c || '#000'}" text-anchor="${anchor}"${rot}>${esc(s)}</text>`);
          },
          svg() {
            return `<svg xmlns="http://www.w3.org/2000/svg" class="gv-page${w > h ? ' land' : ''}" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm" font-family="Helvetica, Arial, sans-serif"><rect width="${w}" height="${h}" fill="#fff"/>${parts.join('')}</svg>`;
          },
        };
        pages.push(p); return p;
      },
      page(i) { return pages[i]; },
      count() { return pages.length; },
      htmlPages() { return pages.map((p) => p.svg()); },
    };
    return doc;
  };

  /* ---------------- PDF backend ---------------- */
  const hex = (c) => { c = (c || '#000000').replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join(''); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; };
  G.pdfDoc = function () {
    let pdf = null; const pages = [];
    const doc = {
      kind: 'pdf', pages,
      addPage(w, h) {
        const orient = w > h ? 'landscape' : 'portrait';
        if (!pdf) pdf = new window.jspdf.jsPDF({ unit: 'mm', format: [Math.min(w, h), Math.max(w, h)], orientation: orient, compress: true });
        else pdf.addPage([Math.min(w, h), Math.max(w, h)], orient);
        const no = pdf.getNumberOfPages();
        const enter = () => { pdf.setPage(no); };
        const dash = (o) => { pdf.setLineDashPattern(o && o.dash ? o.dash : [], 0); };
        const p = {
          w, h, no: no - 1,
          line(x1, y1, x2, y2, o) { enter(); o = o || {}; pdf.setDrawColor(...hex(o.c)); pdf.setLineWidth(o.w || 0.2); dash(o); pdf.line(x1, y1, x2, y2); dash(); },
          rect(x, y, rw, rh, o) {
            enter(); o = o || {};
            if (o.fill) pdf.setFillColor(...hex(o.fill));
            if (o.stroke) { pdf.setDrawColor(...hex(o.stroke)); pdf.setLineWidth(o.w || 0.2); }
            dash(o);
            const style = o.fill && o.stroke ? 'FD' : o.fill ? 'F' : o.stroke ? 'S' : null;
            if (style) { if (o.r) pdf.roundedRect(x, y, rw, rh, o.r, o.r, style); else pdf.rect(x, y, rw, rh, style); }
            dash();
          },
          poly(points, o) {
            if (points.length < 2) return; enter(); o = o || {};
            pdf.setDrawColor(...hex(o.c)); pdf.setLineWidth(o.w || 0.3); pdf.setLineCap('round'); pdf.setLineJoin('round'); dash(o);
            pdf.lines(points.slice(1).map((q, i) => [q[0] - points[i][0], q[1] - points[i][1]]), points[0][0], points[0][1], [1, 1], 'S', false);
            dash();
          },
          image(data, x, y, iw, ih, nat) {
            const m = /^data:image\/(png|jpeg|jpg);base64,/.exec(data || ''); if (!m) return; enter();
            let w = iw, h = ih, px = x, py = y;
            if (nat && nat.w > 0 && nat.h > 0) { const k = Math.min(iw / nat.w, ih / nat.h); w = nat.w * k; h = nat.h * k; px = x + (iw - w) / 2; py = y + (ih - h) / 2; }
            try { pdf.addImage(data, m[1] === 'png' ? 'PNG' : 'JPEG', px, py, w, h); } catch (e) { /* unreadable image: leave the cell empty */ }
          },
          area(points, o) {
            if (points.length < 3) return; enter(); o = o || {};
            pdf.setFillColor(...hex(o.fill));
            const op = o.opacity == null ? 1 : o.opacity;
            pdf.saveGraphicsState(); pdf.setGState(new pdf.GState({ opacity: op }));
            pdf.lines(points.slice(1).map((q, i) => [q[0] - points[i][0], q[1] - points[i][1]]), points[0][0], points[0][1], [1, 1], 'F', true);
            pdf.restoreGraphicsState();
          },
          text(s, x, y, o) {
            o = o || {}; s = G.safe(s); if (!s) return; enter();
            pdf.setFont('helvetica', o.bold ? (o.italic ? 'bolditalic' : 'bold') : (o.italic ? 'italic' : 'normal'));
            pdf.setFontSize(o.size || 8); pdf.setTextColor(...hex(o.c));
            const opt = { align: o.align || 'left' }; if (o.rot) opt.angle = o.rot;
            pdf.text(s, x, y, opt);
          },
        };
        pages.push(p); return p;
      },
      page(i) { return pages[i]; },
      count() { return pages.length; },
      save(name) { pdf.save(name); },
      blob() { return pdf.output('blob'); },
      raw() { return pdf; },
    };
    return doc;
  };
})(window.G = window.G || {});
