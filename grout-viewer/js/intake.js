/* File intake: single files, whole folders (drag and drop or folder picker) and .zip archives, flattened to a list of measurement files.
   Everything stays in the browser; nothing is uploaded. */
(function (G) {
  'use strict';
  const MEAS = /\.(dfi|dmj|rec|txt)$/i;
  const IGNORE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;

  const readFile = (f) => (f.arrayBuffer ? f.arrayBuffer() : new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('read')); r.readAsArrayBuffer(f); }));
  const describe = (f, bulk) => ({ name: f.name, path: f.webkitRelativePath || f._gvPath || f.name, size: f.size, mtime: f.lastModified || 0, bulk: !!bulk, read: () => readFile(f) });

  /* raw deflate through the browser's own decompressor (Chrome/Edge 80+, Firefox 113+, Safari 16.4+) */
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') { const e = new Error('zipUnsupported'); e.code = 'zipUnsupported'; throw e; }
    const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter();
    w.write(u8).catch(() => {}); w.close().catch(() => {});
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  /* reads stored and deflated entries of a .zip; directories are skipped */
  async function unzipAny(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
    let p = u8.length - 22; while (p >= 0 && dv.getUint32(p, true) !== 0x06054b50) p--;
    if (p < 0) { const e = new Error('notZip'); e.code = 'notZip'; throw e; }
    const n = dv.getUint16(p + 10, true); let c = dv.getUint32(p + 16, true); const dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (c + 46 > u8.length || dv.getUint32(c, true) !== 0x02014b50) break;
      const method = dv.getUint16(c + 10, true), csz = dv.getUint32(c + 20, true), nl = dv.getUint16(c + 28, true), el = dv.getUint16(c + 30, true), cl = dv.getUint16(c + 32, true), lo = dv.getUint32(c + 42, true);
      const name = dec.decode(u8.subarray(c + 46, c + 46 + nl)); c += 46 + nl + el + cl;
      if (/\/$/.test(name) || IGNORE.test(name)) continue;
      const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(ds, ds + csz);
      if (method === 0) out.push({ name, data: raw.slice() });
      else if (method === 8) out.push({ name, data: await inflateRaw(raw) });
    }
    return out;
  }

  /* walk a dropped folder (call synchronously from the drop handler: the item list is only valid there) */
  function fromDrop(dt) {
    const entries = [], files = Array.from((dt && dt.files) || []);
    Array.from((dt && dt.items) || []).forEach((it) => { try { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en) entries.push(en); } catch (e) { /* ignore */ } });
    return (async () => {
      if (!entries.length) return files.map((f) => describe(f, false));
      const out = [];
      const walk = async (en, base) => {
        if (en.isFile) {
          await new Promise((res) => en.file((f) => { f._gvPath = base + f.name; out.push(describe(f, base !== '')); res(); }, res)); // files dropped one by one are all tried; files found inside folders only when they look like measurements
        } else if (en.isDirectory) {
          const rd = en.createReader();
          for (;;) {
            const batch = await new Promise((res) => rd.readEntries(res, () => res([])));
            if (!batch.length) break;
            for (const child of batch) await walk(child, base + en.name + '/');
          }
        }
      };
      for (const en of entries) await walk(en, '');
      return out;
    })();
  }

  /* descriptors -> measurement files (zips opened, folder content filtered by extension). Returns { items, ignored, failed } */
  async function expand(descs) {
    const items = [], failed = []; let ignored = 0;
    for (const d of descs) {
      if (/\.zip$/i.test(d.name)) {
        try {
          const inner = await unzipAny(new Uint8Array(await d.read()));
          inner.forEach((z) => {
            const base = z.name.split('/').pop();
            if (!MEAS.test(base)) { ignored++; return; }
            items.push({ name: base, path: d.name + '/' + z.name, size: z.data.length, mtime: 0, bulk: true, read: async () => z.data.buffer.slice(z.data.byteOffset, z.data.byteOffset + z.data.byteLength) });
          });
        } catch (e) { failed.push({ name: d.name, code: e && e.code === 'zipUnsupported' ? 'zipUnsupported' : 'notZip' }); }
        continue;
      }
      if (d.bulk && (!MEAS.test(d.name) || IGNORE.test(d.path))) { ignored++; continue; }
      items.push(d);
    }
    return { items, ignored, failed };
  }

  G.intake = { describe, fromDrop, expand, unzipAny, MEAS };
})(window.G = window.G || {});
