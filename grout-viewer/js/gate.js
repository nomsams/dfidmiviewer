/* Password gate, same mechanism as the pqview project: the page stays blurred and inert until a valid password is entered.
   Passwords are compared as SHA-256 hashes of the trimmed, lower-cased input (so "betongakuten" and "Betongakuten" both work).
   The unlock flag uses the same key as pqview (sessionStorage "pq.unlocked"): both tools live on the same site, so signing in to one
   opens the other in the same browser tab without asking again.
   NOTE: this runs in the browser, so it keeps casual visitors out but is not real security (the files never leave the computer anyway). */
(function (G) {
  'use strict';
  const PASSWORD_HASHES = [
    '7889e6af98934b0bc788968cef515b0a67225da873feeccf16db2767d78d00c3',
  ];
  const KEY = 'pq.unlocked';

  function sha256(str) {
    const bytes = new TextEncoder().encode(str);
    const K = [], H = [];
    for (let n = 2, c = 0; c < 64; n++) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (!prime) continue;
      if (c < 8) H[c] = (Math.pow(n, 0.5) % 1) * 4294967296 | 0;
      K[c++] = (Math.pow(n, 1 / 3) % 1) * 4294967296 | 0;
    }
    const len = bytes.length;
    const buf = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, Math.floor((len * 8) / 4294967296));
    dv.setUint32(buf.length - 4, (len * 8) >>> 0);
    const ror = (x, n) => (x >>> n) | (x << (32 - n));
    const w = new Array(64);
    for (let i = 0; i < buf.length; i += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = ror(w[t - 15], 7) ^ ror(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = ror(w[t - 2], 17) ^ ror(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, j) => { H[j] = (H[j] + v) | 0; });
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  const check = (pw) => PASSWORD_HASHES.indexOf(sha256(String(pw).trim().toLowerCase())) >= 0;
  G.gate = { sha256, check, KEY };

  if (typeof document === 'undefined') return; // tests load this file without a page

  const gate = document.getElementById('gate'), form = document.getElementById('gateForm'), input = document.getElementById('gatePw'), err = document.getElementById('gateErr');
  if (!gate || !form || !input) return;
  const covered = () => Array.from(document.body.children).filter((el) => el !== gate && !/^(SCRIPT|STYLE|SVG|INPUT)$/i.test(el.tagName));
  const stored = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const remember = (on) => { try { if (on) sessionStorage.setItem(KEY, '1'); else sessionStorage.removeItem(KEY); } catch (e) { /* storage unavailable: the gate then asks on every visit */ } };

  function setLocked(on) {
    document.body.classList.toggle('locked', on);
    gate.hidden = !on;
    covered().forEach((el) => { if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
    if (on) setTimeout(() => input.focus(), 0);
  }
  G.gate.lock = () => { remember(false); setLocked(true); };
  G.gate.locked = () => document.body.classList.contains('locked');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (check(input.value)) {
      remember(true); input.value = ''; err.hidden = true; setLocked(false);
      if (G.app && G.app.render) G.app.render();
    } else {
      err.hidden = false; input.select();
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
    }
  });
  setLocked(!stored());
})(window.G = window.G || {});
