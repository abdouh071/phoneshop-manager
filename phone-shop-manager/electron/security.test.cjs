/**
 * Tests for the shell's pure security predicates.
 *
 * main.cjs cannot be require()'d outside Electron (it calls app.* at load), so
 * the decisions it depends on live in security.cjs and are asserted on here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { resolveStaticPath, isTrustedFrameOrigin, permissionAllowed } = require('./security.cjs');

const DIST = path.resolve('/tmp/fake-dist');
const FEED_ORIGINS = new Set(['https://ecomeweb-91a7e.web.app']);

test('a normal asset resolves inside the bundle', () => {
  const got = resolveStaticPath(DIST, '/assets/app-1234.js');
  assert.equal(got, path.join(DIST, 'assets', 'app-1234.js'));
});

test('query strings and fragments do not reach the filesystem', () => {
  assert.equal(resolveStaticPath(DIST, '/assets/app.js?v=2'), path.join(DIST, 'assets', 'app.js'));
  assert.equal(resolveStaticPath(DIST, '/assets/app.js#shell'), path.join(DIST, 'assets', 'app.js'));
});

test('the root of the request maps to distDir itself', () => {
  assert.equal(resolveStaticPath(DIST, '/'), DIST);
});

test('dot-dot traversal is collapsed back onto the bundle root', () => {
  for (const attack of [
    '/../etc/passwd',
    '/../../etc/passwd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/%2e%2e%2f%2e%2e%2fetc/passwd',
    '/a/b/../../../etc/passwd',
    '/..%2f..%2f..%2fWindows/win.ini',
  ]) {
    const got = resolveStaticPath(DIST, attack);
    assert.ok(got !== null, `${attack} should resolve, not error`);
    assert.ok(got === DIST || got.startsWith(DIST + path.sep), `${attack} escaped to ${got}`);
    // The surviving words are harmless path components *inside* the bundle; a
    // sibling like DIST/etc/passwd is exactly what the old code turned into
    // /etc/passwd.
  }
});

test('absolute paths are treated as bundle-relative, not filesystem-absolute', () => {
  const got = resolveStaticPath(DIST, '/etc/passwd');
  assert.equal(got, path.join(DIST, 'etc', 'passwd'));
});

test('backslash and drive-letter tricks stay inside the bundle', () => {
  assert.equal(resolveStaticPath(DIST, '\\..\\Windows\\win.ini'), path.join(DIST, 'Windows', 'win.ini'));
  // "C:/Windows/win.ini" would escape via path.resolve; the containment check stops it.
  const escaped = resolveStaticPath(DIST, '/C:/Windows/win.ini');
  assert.ok(escaped === null || escaped.startsWith(DIST + path.sep), `got ${escaped}`);
});

test('malformed escapes and NUL bytes are refused outright', () => {
  assert.equal(resolveStaticPath(DIST, '/%zz'), null);
  assert.equal(resolveStaticPath(DIST, '/%e0%a4'), null);
  assert.equal(resolveStaticPath(DIST, '/app.js%00.png'), null);
});

test('only top-level frames on served origins may print', () => {
  const opts = { allowedOrigins: FEED_ORIGINS, localOrigin: 'http://127.0.0.1:41234' };
  assert.equal(isTrustedFrameOrigin('https://ecomeweb-91a7e.web.app/pos', opts), true);
  assert.equal(isTrustedFrameOrigin('http://127.0.0.1:41234/customers', opts), true);
  assert.equal(isTrustedFrameOrigin('http://127.0.0.1:9999/', opts), false);
  assert.equal(isTrustedFrameOrigin('https://evil.test/', opts), false);
  assert.equal(isTrustedFrameOrigin('https://ecomeweb-91a7e.web.app.evil.test/', opts), false);
  assert.equal(isTrustedFrameOrigin('https://ecomeweb-91a7e.web.app:8443/', opts), false);
  assert.equal(
    isTrustedFrameOrigin('data:text/html,<script>alert(1)</script>', opts),
    false,
    'a data: document has a null origin and must not print'
  );
  assert.equal(isTrustedFrameOrigin('file:///etc/index.html', opts), false);
  assert.equal(isTrustedFrameOrigin('', opts), false);
  assert.equal(isTrustedFrameOrigin('about:blank', opts), false);
});

test('the ephemeral local origin is optional', () => {
  const opts = { allowedOrigins: FEED_ORIGINS, localOrigin: null };
  assert.equal(isTrustedFrameOrigin('http://127.0.0.1:41234/', opts), false);
});

test('permissions: camera and clipboard only, never the microphone', () => {
  const allowed = new Set(['media', 'clipboard-sanitized-write']);
  const decide = (permission, mediaTypes) =>
    permissionAllowed(permission, { allowed, details: mediaTypes ? { mediaTypes } : {} });

  assert.equal(decide('media', ['video']), true);
  assert.equal(decide('media', ['audio']), false);
  assert.equal(decide('media', ['audio', 'video']), false);
  assert.equal(decide('media'), true, 'a media request that names no type still means the scanner');
  assert.equal(decide('clipboard-sanitized-write'), true);
  assert.equal(decide('clipboard-read'), false);
  for (const permission of [
    'geolocation',
    'notifications',
    'midi',
    'sound',
    'accessibility-events',
    'display-capture',
    'pointerLock',
    'fullscreen',
    'fileSystem',
    'unknown-future-permission',
  ]) {
    assert.equal(decide(permission), false, `${permission} must be denied`);
  }
});
