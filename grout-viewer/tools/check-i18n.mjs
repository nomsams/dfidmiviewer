import fs from 'node:fs';
const win = {}; new Function('window', 'navigator', fs.readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8'))(win, { language: 'en' });const G = win.G, en = Object.keys(G.DICT.en);
const src = ['js/report.js','js/app.js','js/chart.js','index.html'].map(f => fs.readFileSync(new URL('../'+f, import.meta.url), 'utf8')).join('\n');
const used = new Set([...src.matchAll(/\bt\('([\w.]+)'/g)].map(m => m[1]));
[...src.matchAll(/data-i(?:-ph)?="([\w.]+)"/g)].forEach(m => used.add(m[1]));
['p','q','v'].forEach(k=>used.add('cv.'+k));
['overview','chart','data','events','params','report','summary','export'].forEach(k=>used.add('tab.'+k));
['auto','light','dark','forest','ocean','sunset','contrast'].forEach(k=>used.add('theme.'+k));
let bad = 0;
for (const k of used) if (!en.includes(k)) { console.log('MISSING in en:', k); bad++; }
for (const l of ['sv','fr','no']) { const miss = en.filter(k => !(k in G.DICT[l])); if (miss.length) console.log(l, 'missing', miss.length, miss.join(' ')); }
console.log('keys used', used.size, 'defined', en.length, 'problems', bad);
