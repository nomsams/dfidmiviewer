import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

/** Reject source HTML and asset paths that cannot work under a Pages project URL. */
export function publishedAssets(html, siteUrl) {
  const base = new URL(siteUrl);
  const modules = [...html.matchAll(/<script\b[^>]*>/gi)]
    .filter(([tag]) => /\btype=["']module["']/i.test(tag))
    .map(([tag]) => /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1]);
  assert.ok(modules.length && modules.every(Boolean), 'Published page has no compiled module entry point');
  const styles = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter(([tag]) => /\brel=["']stylesheet["']/i.test(tag))
    .map(([tag]) => /\bhref=["']([^"']+)["']/i.exec(tag)?.[1]);
  assert.ok(styles.length && styles.every(Boolean), 'Published page has no compiled styles');
  return [...modules.map((src) => ({ src, type: 'javascript' })), ...styles.map((src) => ({ src, type: 'css' }))].map(({ src, type }) => {
    const url = new URL(src, base);
    assert.ok(url.origin === base.origin && url.pathname.startsWith(base.pathname), `Asset escapes the Pages project path: ${src}`);
    assert.ok(!url.pathname.includes('/src/') && url.pathname.endsWith(type === 'javascript' ? '.js' : '.css'), `Source file published instead of a build: ${src}`);
    return { url: url.href, type };
  });
}

async function request(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  assert.ok(response.ok, `HTTP ${response.status}: ${url}`);
  return response;
}

async function main() {
  if (process.argv[2] === 'source') {
    const repository = process.env.GITHUB_REPOSITORY || 'nomsams/dfidmiviewer';
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const pages = await (await request(`https://api.github.com/repos/${repository}/pages`, headers)).json();
    assert.equal(pages.build_type, 'workflow', 'Set Settings > Pages > Source to GitHub Actions. Branch publishing overwrites the compiled viewer with source files.');
    console.log('Pages source verified: GitHub Actions');
    return;
  }
  assert.equal(process.argv[2], 'site', 'Usage: node scripts/verify-pages.mjs source | site <URL>');
  const siteUrl = process.argv[3];
  const entry = new URL(siteUrl);
  entry.searchParams.set('verify', process.env.GITHUB_SHA || String(Date.now()));
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const html = await (await request(entry.href, { 'Cache-Control': 'no-cache' })).text();
      const assets = publishedAssets(html, siteUrl);
      for (const asset of assets) {
        const response = await request(asset.url);
        assert.ok((response.headers.get('content-type') || '').includes(asset.type), `Wrong content type for ${asset.url}`);
        assert.ok((await response.text()).length > 100, `Empty asset: ${asset.url}`);
      }
      console.log(`Published viewer verified: ${assets.length} compiled assets at ${siteUrl}`);
      return;
    } catch (error) {
      if (attempt === 10) throw error;
      console.log(`Waiting for published build (${attempt}/10): ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
