import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getReleases } from './releases.ts';

const release = (tag, names = [], flags = {}) => ({
  tag_name: `v${tag}`, draft: false, prerelease: false, ...flags,
  assets: names.map(name => ({ name, browser_download_url: `https://example.com/v${tag}/${name}` })),
});
const installers = ['Aster_arm64.dmg', 'Aster_x64.dmg', 'Aster_x64_en-US.msi', 'Aster_amd64.AppImage'];

function mockResponses(t, responses) {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(url);
    assert.ok(responses.length, 'unexpected API request');
    return Response.json(responses.shift());
  });
  return urls;
}

test('latest release with installers is used without fetching history', async t => {
  const urls = mockResponses(t, [release('1.0.5', installers)]);
  const result = await getReleases();
  assert.equal(result.version, '1.0.5');
  assert.equal(result.releases.length, 4);
  assert.equal(urls.length, 1);
});

test('empty 1.0.5 falls back to 1.0.4 with matching version labels and links', async t => {
  mockResponses(t, [release('1.0.5'), [
    release('1.0.6', installers, { draft: true }),
    release('1.0.6-beta', installers, { prerelease: true }),
    release('1.0.5', ['latest.json', 'Aster_arm64.dmg.sig']),
    release('1.0.4', installers),
  ]]);
  const result = await getReleases();
  assert.equal(result.version, '1.0.4');
  assert.deepEqual(result.releases.map(r => r.id), ['macos-arm64', 'macos-x64', 'windows', 'linux']);
  for (const item of result.releases) {
    assert.match(item.meta, /v1\.0\.4$/);
    assert.match(item.href, /\/v1\.0\.4\//);
  }
});

test('search continues onto the next page', async t => {
  const urls = mockResponses(t, [release('1.0.5'), Array.from({ length: 100 }, () => release('1.0.5')), [release('1.0.4', installers)]]);
  assert.equal((await getReleases()).version, '1.0.4');
  assert.match(urls[2], /page=2$/);
});

test('no packaged stable release preserves the empty result', async t => {
  mockResponses(t, [release('1.0.5'), [release('1.0.5')]]);
  assert.deepEqual(await getReleases(), { version: '1.0.5', releases: [] });
});

test('API errors are propagated instead of inventing download links', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  await assert.rejects(getReleases(), /GitHub API returned 503/);
});
