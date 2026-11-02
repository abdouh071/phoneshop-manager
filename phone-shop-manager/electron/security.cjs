/**
 * Pure security predicates for the desktop shell.
 *
 * These decide what the window may load, what a frame may ask the printers to
 * do, and what the OS may hand the renderer. They are kept here, away from the
 * Electron API, so `node --test` can exercise them — main.cjs cannot be
 * require()'d outside Electron at all.
 */

const path = require('path');

/**
 * Map a request URL onto a file inside distDir, or return null.
 *
 * `path.join(distDir, decodeURI(req.url))` walks straight out of the bundle:
 * `/%2e%2e%2f%2e%2e%2fetc/passwd` decodes to `/../../etc/passwd` and resolves
 * above distDir. Anchoring the path at `/` first makes every `..` collapse back
 * onto the root, and the containment check has the final word.
 */
function resolveStaticPath(distDir, requestUrl) {
  const raw = String(requestUrl || '/').split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch (_) {
    return null; // malformed percent-escape
  }
  if (decoded.includes('\0')) return null;

  const relative = path.posix
    .normalize(path.posix.join('/', decoded.replace(/\\/g, '/')))
    .replace(/^\/+/, '');
  if (relative.startsWith('..')) return null;

  const root = path.resolve(distDir);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/**
 * A frame may reach the print IPC only when it is the top frame of the window
 * this process created and is loaded from an origin the app is served from.
 * `origin` comes from the frame, never from anything the page controls.
 */
function isTrustedFrameOrigin(frameUrl, { allowedOrigins, localOrigin }) {
  let origin;
  try {
    origin = new URL(String(frameUrl)).origin;
  } catch (_) {
    return false;
  }
  if (origin === 'null') return false; // data: and file: documents
  if (localOrigin && origin === localOrigin) return true;
  return allowedOrigins.has(origin);
}

/**
 * Electron approves every permission request unless the app says otherwise.
 * Camera (the barcode scanner) and clipboard writes are all this app uses;
 * audio in particular would record the people standing at the counter.
 */
function permissionAllowed(permission, { allowed, details }) {
  if (!allowed.has(permission)) return false;
  if (permission === 'media') {
    const types = Array.isArray(details && details.mediaTypes) ? details.mediaTypes : [];
    return types.length === 0 || types.every((t) => t === 'video');
  }
  return true;
}

module.exports = { resolveStaticPath, isTrustedFrameOrigin, permissionAllowed };
