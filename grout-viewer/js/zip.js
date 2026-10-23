/* Minimal ZIP writer (store, no compression): several PDFs or JPEG pages in one download. No dependencies. */
(function (G) {
  'use strict';
  const TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
    parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }
  /* files: [{ name, data: Uint8Array }]  ->  Uint8Array of a .zip archive. Names are made unique. */
  G.zip = function (files) {
    const enc = new TextEncoder(), seen = {}, parts = [], central = []; let off = 0;
    files.forEach((f) => {
      let name = String(f.name).replace(/[\\:*?"<>|]/g, '_'), k = 1;
      while (seen[name.toLowerCase()]) name = name.replace(/(\.[^.]*)?$/, '_' + (++k) + '$1');
      seen[name.toLowerCase()] = 1;
      const nm = enc.encode(name), crc = crc32(f.data), sz = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(lh.buffer), nm, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), nm);
      off += 30 + nm.length + sz;
    });
    const cd = concat(central), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd.length, true); end.setUint32(16, off, true);
    return concat(parts.concat([cd, new Uint8Array(end.buffer)]));
  };
  /* Reads back a store-only archive (used by the tests). */
  G.unzip = function (u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
    let p = u8.length - 22; while (p >= 0 && dv.getUint32(p, true) !== 0x06054b50) p--;
    if (p < 0) throw new Error('not a zip');
    const n = dv.getUint16(p + 10, true); let c = dv.getUint32(p + 16, true);
    for (let i = 0; i < n; i++) {
      const nl = dv.getUint16(c + 28, true), el = dv.getUint16(c + 30, true), cl = dv.getUint16(c + 32, true), lo = dv.getUint32(c + 42, true), sz = dv.getUint32(c + 24, true), crc = dv.getUint32(c + 16, true);
      const name = new TextDecoder().decode(u8.subarray(c + 46, c + 46 + nl)), ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), data = u8.slice(ds, ds + sz);
      if (crc32(data) !== crc) throw new Error('crc mismatch: ' + name);
      out.push({ name, data }); c += 46 + nl + el + cl;
    }
    return out;
  };
  /* "all" / "" -> null, "2-4,7" -> [1,2,3,6] (zero based, clipped to the page count), invalid -> 'bad' */
  G.parseRange = function (str, n) {
    str = String(str || '').trim(); if (!str || /^(all|alla|tout|alle)$/i.test(str)) return null;
    const set = {};
    for (const part of str.split(/[,;\s]+/)) {
      if (!part) continue;
      const m = /^(\d+)(?:-(\d+))?$/.exec(part); if (!m) return 'bad';
      let a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a; if (a > b) { const x = a; a = b; b = x; }
      for (let i = Math.max(1, a); i <= Math.min(n, b); i++) set[i - 1] = 1;
    }
    const out = Object.keys(set).map(Number).sort((x, y) => x - y);
    return out.length ? out : 'bad';
  };
  G.crc32 = crc32;
})(window.G = window.G || {});
