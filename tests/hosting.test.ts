import test from 'node:test';
import assert from 'node:assert/strict';
import { publishedAssets } from '../scripts/verify-pages.mjs';

const site = 'https://nomsams.github.io/dfidmiviewer/';
test('compiled entry and styles resolve inside the Pages project', () => {
  assert.deepEqual(publishedAssets('<script type="module" crossorigin src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css">', site), [
    { url: site + 'assets/app.js', type: 'javascript' }, { url: site + 'assets/app.css', type: 'css' },
  ]);
});
test('the actual branch-published blank page fails verification', () => {
  assert.throws(() => publishedAssets('<div id="root"></div><script type="module" src="/src/main.tsx"></script>', site), /compiled styles/);
  assert.throws(() => publishedAssets('<script type="module" src="./src/main.tsx"></script><link rel="stylesheet" href="./assets/app.css">', site), /Source file/);
});
test('missing entry points and root-relative assets fail verification', () => {
  assert.throws(() => publishedAssets('<div id="root"></div>', site), /compiled module/);
  assert.throws(() => publishedAssets('<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="./assets/app.css">', site), /escapes/);
});
