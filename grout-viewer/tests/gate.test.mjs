import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { G, root } from './harness.mjs';

const ref = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

test('the built-in SHA-256 equals the platform implementation (padding boundaries, accents, emoji)', () => {
  const samples = ['', 'abc', 'betongakuten', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(119), 'x'.repeat(1000), 'åäö€ÅÄÖ', 'pass 😀 word'];
  samples.forEach((s) => assert.equal(G.gate.sha256(s), ref(s), JSON.stringify(s.slice(0, 20))));
});

test('only the right password opens the gate; case and surrounding spaces do not matter', () => {
  assert.ok(G.gate.check('betongakuten'));
  assert.ok(G.gate.check('  Betongakuten '));
  assert.ok(G.gate.check('BETONGAKUTEN'));
  ['', ' ', 'betongakute', 'betongakuten1', 'password', 'betong akuten'].forEach((p) => assert.equal(G.gate.check(p), false, JSON.stringify(p)));
  const src = fs.readFileSync(path.join(root, 'js/gate.js'), 'utf8');
  assert.ok(src.includes(ref('betongakuten')), 'the stored hash is the hash of the password');
  assert.ok(!/betongakuten/.test(src.replace(/"betongakuten" and "Betongakuten"/, '')), 'the password itself is not written in the script');
  assert.equal(G.gate.KEY, 'pq.unlocked', 'same unlock flag as the pqview project, so one sign-in opens both tools in a tab');
});

test('the page starts locked, the app cannot take files while locked, and the pqview link is there', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  assert.match(html, /<body class="locked"/, 'locked from the first paint');
  assert.match(html, /<div id="gate"[^>]*>(?![^]*hidden[^>]*>\s*<form)/, 'the gate is visible in the markup');
  assert.ok(html.indexOf('js/gate.js') > 0 && html.indexOf('js/gate.js') < html.indexOf('js/app.js'));
  assert.match(html, /id="pqLink" href="https:\/\/nomsams\.github\.io\/pqview\/"/);
  assert.match(html, /id="lockBtn"/);
  assert.ok(/G\.gate\.locked\(\)\) return/.test(app), 'dropped files are ignored while locked');
});
