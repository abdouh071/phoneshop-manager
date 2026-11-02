/**
 * Desktop shell updater.
 *
 * The renderer loads the live site, so UI fixes arrive by themselves — but the
 * Electron binary around it never changes. This closes that gap without needing
 * code-signing infrastructure the project does not have yet.
 *
 * Feed: an HTTPS JSON manifest, checked 30s after launch and every 6 hours.
 * Override with PHONESHOP_UPDATE_URL. Shape:
 *
 *   {
 *     "schema": 1,
 *     "version": "1.1.0",
 *     "notes": "Faster Z-report",
 *     "platforms": {
 *       "win32-x64":   { "url": "https://…/Setup-1.1.0.exe", "sha256": "<64 hex>", "sizeBytes": 104857600 },
 *       "darwin-arm64": { "url": "https://…-1.1.0-arm64.dmg", "sha256": "<64 hex>", "sizeBytes": 104857600 }
 *     }
 *   }
 *
 * Rules this module will not bend:
 *   - download over https only, from the same host as the feed;
 *   - sha256 and byte size from the manifest must both match the file on disk;
 *   - nothing is ever launched or installed without the shop staff clicking;
 *   - a missing, malformed or unreachable feed is a silent no-op, never an error
 *     dialog in front of a customer.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_FEED_URL = 'https://phoneshop-mgr-pro-2026.web.app/desktop-update.json';
const FEED_URL = String(process.env.PHONESHOP_UPDATE_URL || DEFAULT_FEED_URL).trim();
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const platformKey = () => `${process.platform}-${process.arch}`;

/**
 * Dot-separated numeric compare, ignoring any leading "v". A version with a
 * prerelease tag ("1.2.0-beta") counts as older than the same release, so a
 * beta machine is never told it is ahead of the feed.
 */
function compareVersions(a, b) {
  const parse = (raw) => {
    const text = String(raw || '').trim().replace(/^v/i, '');
    const dash = text.indexOf('-');
    const core = dash === -1 ? text : text.slice(0, dash);
    const pre = dash === -1 ? '' : text.slice(dash + 1);
    const parts = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { nums: [parts[0] || 0, parts[1] || 0, parts[2] || 0], pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] > right.nums[i] ? 1 : -1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
}

function isHttpsUrl(raw) {
  try {
    return new URL(String(raw)).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validate the manifest and pick this machine's entry.
 * Returns { ok: true, update } when an install is genuinely newer and fully
 * described, { ok: true, update: null } when there is nothing to do, and
 * { ok: false, reason } when the feed is not trustworthy — never a partial pass.
 */
function parseManifest(raw, currentVersion, feedUrl = FEED_URL, key = platformKey()) {
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (_) {
    return { ok: false, reason: 'manifest is not valid JSON' };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, reason: 'manifest is not an object' };
  }
  if (doc.schema !== 1) return { ok: false, reason: `unsupported schema ${doc.schema}` };
  if (typeof doc.version !== 'string' || !/^\d+(\.\d+)*([-+][\w.-]*)?$/.test(doc.version)) {
    return { ok: false, reason: 'manifest version is malformed' };
  }

  let feedHost;
  try {
    feedHost = new URL(feedUrl).hostname;
  } catch (_) {
    return { ok: false, reason: 'feed URL is not usable' };
  }

  const entry = doc.platforms && doc.platforms[key];
  if (!entry || typeof entry !== 'object') return { ok: true, update: null };

  const url = String(entry.url || '');
  const sha256 = String(entry.sha256 || '').toLowerCase();
  const sizeBytes = Number(entry.sizeBytes);

  if (!isHttpsUrl(url)) return { ok: false, reason: 'asset URL is not HTTPS' };

  let assetHost;
  try {
    assetHost = new URL(url).hostname;
  } catch (_) {
    return { ok: false, reason: 'asset URL is malformed' };
  }
  if (assetHost !== feedHost) {
    return { ok: false, reason: `asset host "${assetHost}" is not the feed host "${feedHost}"` };
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, reason: 'asset sha256 is malformed' };
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_DOWNLOAD_BYTES) {
    return { ok: false, reason: 'asset sizeBytes is out of range' };
  }

  if (compareVersions(doc.version, currentVersion) <= 0) return { ok: true, update: null };

  return {
    ok: true,
    update: {
      version: doc.version,
      notes: typeof doc.notes === 'string' ? doc.notes.slice(0, 2000) : '',
      url,
      sha256,
      sizeBytes,
    },
  };
}

function fetchHttpsText(url, maxBytes, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    if (!isHttpsUrl(url)) return reject(new Error('Refusing non-HTTPS update request'));
    const req = https.get(url, { timeout: 15000, headers: { Accept: 'application/json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        let next;
        try {
          next = new URL(res.headers.location, url).toString();
        } catch (_) {
          return reject(new Error('Bad redirect target'));
        }
        return resolve(fetchHttpsText(next, maxBytes, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Feed answered ${res.statusCode}`));
      }
      const chunks = [];
      let seen = 0;
      res.on('data', (c) => {
        seen += c.length;
        if (seen > maxBytes) {
          req.destroy();
          reject(new Error('Response too large'));
        } else {
          chunks.push(c);
        }
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
      return undefined;
    });
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
  });
}

function fetchBinary(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    if (!isHttpsUrl(url)) return reject(new Error('Refusing non-HTTPS download'));
    const req = https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        let next;
        try {
          next = new URL(res.headers.location, url).toString();
        } catch (_) {
          return reject(new Error('Bad redirect target'));
        }
        return resolve(fetchBinary(next, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download answered ${res.statusCode}`));
      }
      const chunks = [];
      let seen = 0;
      res.on('data', (c) => {
        seen += c.length;
        if (seen > MAX_DOWNLOAD_BYTES) {
          req.destroy();
          reject(new Error('Installer larger than the allowed maximum'));
        } else {
          chunks.push(c);
        }
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
      return undefined;
    });
    req.on('timeout', () => req.destroy(new Error('Download timed out')));
    req.on('error', reject);
  });
}

module.exports = {
  FEED_URL,
  platformKey,
  compareVersions,
  isHttpsUrl,
  sha256Hex,
  parseManifest,
  fetchHttpsText,
  fetchBinary,
  MAX_MANIFEST_BYTES,
  MAX_DOWNLOAD_BYTES,
  RECHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
};

// ─── Electron wiring ─────────────────────────────────────────────────────────
// Kept out of the exports above so the pure functions can be tested by plain
// `node --test`, where require('electron') yields a binary path, not an API.
function createUpdater({ app: electronApp, dialog: electronDialog, shell: electronShell, log }) {
  const note = (msg) => {
    try {
      log(msg);
    } catch (_) {}
  };
  let timer = null;
  let busy = false;
  let skippedVersion = null;
  let lastUpdate = null;

  async function check({ interactive = false } = {}) {
    if (busy) return { ok: false, reason: 'an update check is already running' };
    busy = true;
    try {
      const raw = await fetchHttpsText(FEED_URL, MAX_MANIFEST_BYTES);
      const result = parseManifest(raw.toString('utf8'), electronApp.getVersion());
      if (!result.ok) {
        note(`[Updater] Ignoring feed: ${result.reason}`);
        return result;
      }
      if (!result.update) {
        if (interactive) {
          await electronDialog.showMessageBox({
            type: 'info',
            title: 'PhoneShop Manager Pro',
            message: 'You are up to date',
            detail: `Version ${electronApp.getVersion()} is the newest build available.`,
            buttons: ['OK'],
          });
        }
        return result;
      }
      if (!interactive && result.update.version === skippedVersion) return { ok: true, update: null };
      lastUpdate = result.update;
      await prompt(result.update);
      return result;
    } catch (err) {
      // No shop is served by an error dialog popping over the till.
      note(`[Updater] Check failed: ${err.message}`);
      return { ok: false, reason: err.message };
    } finally {
      busy = false;
    }
  }

  async function prompt(update) {
    const choice = await electronDialog.showMessageBox({
      type: 'info',
      title: 'PhoneShop Manager Pro',
      message: `Update ${update.version} is available`,
      detail: `${update.notes || 'A new desktop build is available.'}\n\nDownload it now? Nothing is installed until you run it yourself.`,
      buttons: ['Download update', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response !== 0) {
      skippedVersion = update.version;
      return;
    }

    let buffer;
    try {
      note(`[Updater] Downloading ${update.url}`);
      buffer = await fetchBinary(update.url);
    } catch (err) {
      note(`[Updater] Download failed: ${err.message}`);
      await electronDialog.showMessageBox({
        type: 'error',
        title: 'Update download failed',
        message: `Could not download version ${update.version}.`,
        detail: err.message,
        buttons: ['OK'],
      });
      return;
    }

    const digest = sha256Hex(buffer);
    if (digest !== update.sha256 || buffer.length !== update.sizeBytes) {
      note(`[Updater] Rejected download: digest ${digest} / ${buffer.length} bytes`);
      await electronDialog.showMessageBox({
        type: 'error',
        title: 'Update rejected',
        message: 'The downloaded file did not match the update listing.',
        detail: 'The download was deleted and nothing was opened. Check the connection and try again.',
        buttons: ['OK'],
      });
      return;
    }

    const fileName = path.basename(new URL(update.url).pathname) || `PhoneShop-Manager-${update.version}`;
    const target = path.join(electronApp.getPath('downloads'), fileName);
    fs.writeFileSync(target, buffer, { mode: 0o600 });
    note(`[Updater] Verified download saved to ${target}`);

    const run = await electronDialog.showMessageBox({
      type: 'question',
      title: 'PhoneShop Manager Pro',
      message: `Update ${update.version} downloaded and verified`,
      detail: `Saved as:\n${target}\n\nOpen it now to install? Close the app before the installer finishes.`,
      buttons: ['Open installer', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (run.response === 0) {
      const errText = await electronShell.openPath(target);
      if (errText) note(`[Updater] openPath failed: ${errText}`);
    }
  }

  return {
    check,
    start() {
      if (!electronApp.isPackaged) {
        note('[Updater] Skipped in an unpacked build');
        return;
      }
      setTimeout(() => check(), FIRST_CHECK_DELAY_MS);
      timer = setInterval(() => check(), RECHECK_INTERVAL_MS);
      if (timer.unref) timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    lastUpdate: () => lastUpdate,
  };
}

module.exports.createUpdater = createUpdater;
