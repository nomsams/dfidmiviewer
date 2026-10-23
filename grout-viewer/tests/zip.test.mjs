import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { G, root } from './harness.mjs';

vm.runInThisContext(fs.readFileSync(path.join(root, 'js/zip.js'), 'utf8'), { filename: 'zip.js' });

test('zip: round trip, unique names, known CRC', () => {
  assert.equal(G.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const files = [{ name: 'a.pdf', data: new TextEncoder().encode('hello') }, { name: 'a.pdf', data: new Uint8Array(70000).fill(7) }, { name: 'dir/ü.jpg', data: new Uint8Array(0) }];
  const back = G.unzip(G.zip(files));
  assert.deepEqual(back.map((f) => f.name), ['a.pdf', 'a_2.pdf', 'dir/ü.jpg']);
  assert.equal(new TextDecoder().decode(back[0].data), 'hello'); assert.equal(back[1].data.length, 70000); assert.equal(back[2].data.length, 0);
});

test('zip: a corrupted archive is detected', () => {
  const z = G.zip([{ name: 'x.txt', data: new TextEncoder().encode('payload') }]); z[40] ^= 0xff;
  assert.throws(() => G.unzip(z), /crc/);
});
