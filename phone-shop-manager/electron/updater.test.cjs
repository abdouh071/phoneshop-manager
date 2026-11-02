/**
 * Tests for the shell updater's decision logic.
 *
 * No network: fetchHttpsText is pointed at non-HTTPS URLs to prove it refuses
 * before it opens a socket, and every manifest rule is asserted directly.
 * require('electron') under plain node yields a binary path, so these helpers
 * are deliberately free of the Electron API.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const updater = require('./updater.cjs');
const { compareVersions, parseManifest, isHttpsUrl, sha256Hex, fetchHttpsText, MAX_DOWNLOAD_BYTES } = updater;

const FEED = 'https://phoneshop-mgr-pro-2026.web.app/desktop-update.json';
const KEY = 'darwin-arm64';
const GOOD_SHA = 'a'.repeat(64);

const manifest = (overrides = {}, platforms = { [KEY]: { url: 'https://phoneshop-mgr-pro-2026.web.app/updates/app-1.1.0.dmg', sha256: GOOD_SHA, sizeBytes: 1024 } }) =>
  JSON.stringify({ schema: 1, version: '1.1.0', notes: 'Faster Z-report', platforms, ...overrides });

const pick = (raw, current = '1.0.0') => parseManifest(raw, current, FEED, KEY);

test('versions compare numerically, not as strings', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.0.9', '1.1.0'), -1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0-beta', '1.2.0'), -1, 'a beta build is not ahead of its release');
  assert.equal(compareVersions('garbage', '1.0.0'), -1);
});

test('a newer, fully described build becomes an offer', () => {
  const result = pick(manifest());
  assert.equal(result.ok, true);
  assert.equal(result.update.version, '1.1.0');
  assert.equal(result.update.sha256, GOOD_SHA);
  assert.equal(result.update.sizeBytes, 1024);
  assert.match(result.update.url, /^https:/);
});

test('the same or an older version offers nothing', () => {
  assert.equal(pick(manifest(), '1.1.0').update, null);
  assert.equal(pick(manifest(), '2.0.0').update, null);
});

test('a machine with no entry in the feed is left alone', () => {
  const result = parseManifest(manifest({}, { 'win32-x64': { url: 'https://x.test/a.exe', sha256: GOOD_SHA, sizeBytes: 10 } }), '1.0.0', FEED, 'darwin-arm64');
  assert.deepEqual(result, { ok: true, update: null });
});

test('anything malformed is refused rather than half-trusted', () => {
  const cases = [
    ['not json at all', 'function () {}'],
    ['an array', '[]'],
    ['a bare string', '"1.1.0"'],
    ['schema 2', manifest({ schema: 2 })],
    ['no schema', manifest({ schema: undefined }).replace('{"schema":undefined,', '{')],
    ['version "latest"', manifest({ version: 'latest' })],
    ['version missing', manifest({ version: undefined }).replace('"version":undefined,', '')],
    ['http asset url', manifest({}, { [KEY]: { url: 'http://phoneshop-mgr-pro-2026.web.app/a.dmg', sha256: GOOD_SHA, sizeBytes: 10 } })],
    ['asset on another host', manifest({}, { [KEY]: { url: 'https://attacker.test/a.dmg', sha256: GOOD_SHA, sizeBytes: 10 } })],
    ['short sha', manifest({}, { [KEY]: { url: 'https://phoneshop-mgr-pro-2026.web.app/a.dmg', sha256: 'deadbeef', sizeBytes: 10 } })],
    ['uppercase-but-valid sha accepted', manifest({}, { [KEY]: { url: 'https://phoneshop-mgr-pro-2026.web.app/a.dmg', sha256: GOOD_SHA.toUpperCase(), sizeBytes: 10 } })],
    ['zero size', manifest({}, { [KEY]: { url: 'https://phoneshop-mgr-pro-2026.web.app/a.dmg', sha256: GOOD_SHA, sizeBytes: 0 } })],
    ['absurd size', manifest({}, { [KEY]: { url: 'https://phoneshop-mgr-pro-2026.web.app/a.dmg', sha256: GOOD_SHA, sizeBytes: MAX_DOWNLOAD_BYTES + 1 } })],
  ];
  for (const [label, raw] of cases) {
    const result = pick(raw);
    if (label === 'uppercase-but-valid sha accepted') {
      assert.equal(result.ok, true, label);
      assert.equal(result.update.sha256, GOOD_SHA, 'sha is normalised to lowercase');
      continue;
    }
    assert.equal(result.ok, false, `${label} should be refused`);
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, `${label} needs a reason`);
  }
});

test('a manifest listing no platforms is nothing to do, not an error', () => {
  assert.deepEqual(pick('{"schema":1,"version":"1.1.0"}'), { ok: true, update: null });
});

test('notes are data: length-bounded and never break the offer', () => {
  const result = pick(manifest({ notes: 'x'.repeat(9000) }));
  assert.equal(result.ok, true);
  assert.equal(result.update.notes.length, 2000);
});

test('only https is ever fetched', () => {
  assert.equal(isHttpsUrl('https://x.test/a.json'), true);
  assert.equal(isHttpsUrl('http://x.test/a.json'), false);
  assert.equal(isHttpsUrl('//x.test/a.json'), false);
  assert.equal(isHttpsUrl('not a url'), false);
});

test('a plain http feed is rejected before a socket opens', async () => {
  await assert.rejects(() => fetchHttpsText('http://127.0.0.1:1/desktop-update.json', 1024), /non-HTTPS/i);
});

test('digests are computed the way the manifest promises', () => {
  assert.equal(sha256Hex(Buffer.from('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
