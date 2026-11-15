/**
 * PhoneShop Manager Pro — Electron Main Process
 *
 * This is the heart of the desktop POS application.
 * It does three things:
 *   1. Creates the main application window (loads the Vite-built React app)
 *   2. Embeds the thermal print server (port 3355) so no separate process is needed
 *   3. Provides native OS integrations (system tray, auto-start, window controls)
 *
 * Architecture:
 *   Electron Main Process
 *     ├── BrowserWindow (loads dist/index.html or localhost:5173 in dev)
 *     └── Embedded Print Server (Express on port 3355)
 *           ├── macOS:   lpr → USB/Network printer
 *           └── Windows: copy /b → \\COMPUTERNAME\printer (shared printers)
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { createUpdater } = require('./updater.cjs');
const { resolveStaticPath, isTrustedFrameOrigin, permissionAllowed } = require('./security.cjs');

// ─── Logging to Disk ─────────────────────────────────────────────────────────
function logToFile(msg) {
  try {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${msg}\n`;
    console.log(msg);
    try {
      const userDataLog = path.join(app.getPath('userData'), 'print-server.log');
      fs.appendFileSync(userDataLog, logLine, 'utf8');
    } catch (_) {}
    try {
      const tempLog = path.join(os.tmpdir(), 'phoneshop-print-server.log');
      fs.appendFileSync(tempLog, logLine, 'utf8');
    } catch (_) {}
  } catch (_) {}
}

// ─── Squirrel Installer Handler (Windows) ────────────────────────────────────
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch (_) {
  // Module not installed — not a Squirrel-based install, nothing to do.
}

// ─── Renderer security ───────────────────────────────────────────────────────
// No `disable-web-security`, no `allow-insecure-localhost`, no
// `allowRunningInsecureContent`, and no Private Network Access opt-out. The
// print server answers PNA preflights for allowlisted origins, Chromium already
// treats http://127.0.0.1 as a trustworthy URL, and the desktop shell prints
// over IPC — so the renderer keeps its same-origin policy.
const DEPLOYED_URL = 'https://phoneshop-mgr-pro-2026.web.app';

// Origins allowed to host the top frame, and therefore to reach the print IPC.
// A Firebase preview channel (preview--<site>.web.app) or a custom domain needs
// listing here, exactly as it does in PRINT_SERVER_ALLOWED_ORIGINS.
const TRUSTED_RENDERER_ORIGINS = new Set([
  new URL(DEPLOYED_URL).origin,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.PHONESHOP_TRUSTED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
]);

// ─── Constants ───────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV === 'development';
const PRINT_SERVER_PORT = 3355;
const APP_NAME = 'PhoneShop Manager Pro';

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow = null;
let tray = null;
let printServerStarted = false;
let printServerChild = null; // child process fallback
let printServerModule = null; // in-process module reference for native IPC
let localAppServer = null;
let localAppPort = null;

// ─── Frame trust ─────────────────────────────────────────────────────────────

function localAppOrigin() {
  return localAppPort ? `http://127.0.0.1:${localAppPort}` : null;
}

/**
 * A frame may ask the shell to print only if it is the top frame of the window
 * this process created, loaded from an origin the app is actually served from.
 * Without that, any iframe the remote page pulled in could reach the printers.
 */
function isTrustedPrintSender(event) {
  const frame = event.senderFrame;
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!frame || event.sender.id !== mainWindow.webContents.id) return false;
  if (frame !== frame.top) return false;
  return isTrustedFrameOrigin(frame.url, {
    allowedOrigins: TRUSTED_RENDERER_ORIGINS,
    localOrigin: localAppOrigin(),
  });
}

function refuseUntrusted(event, channel) {
  const from = event.senderFrame ? event.senderFrame.url : '(frame gone)';
  logToFile(`[IPC] Refused ${channel} from untrusted frame: ${from}`);
  return { ok: false, error: 'Untrusted print request refused' };
}

// ─── Permission gate ─────────────────────────────────────────────────────────
// Electron approves every permission request unless the app says otherwise.
// This app needs exactly two: the camera for the barcode scanner, and clipboard
// writes for the copy buttons. Anything else is denied and logged, so a real
// future need shows up in the log instead of silently working or silently
// breaking.
const ALLOWED_PERMISSIONS = new Set(['media', 'clipboard-sanitized-write']);

function configurePermissionGate() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const allowed = permissionAllowed(permission, { allowed: ALLOWED_PERMISSIONS, details });
    if (!allowed) logToFile(`[Permissions] Denied "${permission}"`);
    callback(allowed);
  });

  session.defaultSession.setPermissionCheckHandler((_wc, permission, details) =>
    permissionAllowed(permission, { allowed: ALLOWED_PERMISSIONS, details })
  );
}

// ─── Shell updates ───────────────────────────────────────────────────────────
const updater = createUpdater({ app, dialog, shell, log: logToFile });

// ─── Print Server Embedding ──────────────────────────────────────────────────

function getPrintServerPaths() {
  // Absolute paths only — a relative one would resolve against the caller's
  // cwd here and against node_modules semantics in require().
  const absolute = (p) => (path.isAbsolute(p) ? p : null);
  const resources = process.resourcesPath || '';

  const candidatePaths = [
    absolute(path.join(resources, 'print-server', 'server.js')),
    absolute(path.join(resources, 'app.asar.unpacked', 'print-server', 'server.js')),
    absolute(path.resolve(__dirname, '..', 'print-server', 'server.js')),
    absolute(path.join(app.getAppPath(), 'print-server', 'server.js')),
  ].filter(Boolean);
  const serverPath =
    candidatePaths.find((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    }) || null;

  const candidateEnvPaths = [
    absolute(path.join(resources, 'print-server', '.env')),
    absolute(path.join(resources, 'app.asar.unpacked', 'print-server', '.env')),
    absolute(path.join(resources, '.env')),
    absolute(path.resolve(__dirname, '..', 'print-server', '.env')),
    absolute(path.join(__dirname, '.env')),
    absolute(path.join(app.getAppPath(), 'print-server', '.env')),
  ].filter(Boolean);
  const envPath = candidateEnvPaths.find((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  }) || null;

  return { serverPath, envPath };
}

/**
 * Fallback: spawn the print server as a child process.
 * Uses ELECTRON_RUN_AS_NODE=1 so the Electron binary acts as plain Node.js.
 * This is essential for Electron 22 (Node 16) where Express 5 require() fails
 * inside the main process but works when forked with the unpacked server.js
 * that has its own node_modules in resources/print-server/.
 */
function startPrintServerAsChildProcess(serverPath, envPath) {
  const { fork, execFile } = require('child_process');

  // Build environment for the child process
  const childEnv = Object.assign({}, process.env, {
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(PRINT_SERVER_PORT),
  });
  if (envPath) {
    childEnv.DOTENV_CONFIG_PATH = envPath;
  }

  console.log(`[Electron] Spawning print server as child process: ${serverPath}`);

  try {
    // fork() uses process.execPath (the Electron binary) with ELECTRON_RUN_AS_NODE
    printServerChild = fork(serverPath, [], {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      cwd: path.dirname(serverPath),
    });

    printServerChild.stdout.on('data', (data) => {
      console.log(`[PrintServer] ${data.toString().trim()}`);
    });

    printServerChild.stderr.on('data', (data) => {
      console.error(`[PrintServer:err] ${data.toString().trim()}`);
    });

    printServerChild.on('error', (err) => {
      console.error('[Electron] Print server child process error:', err.message);
    });

    printServerChild.on('exit', (code, signal) => {
      console.warn(`[Electron] Print server child exited (code=${code}, signal=${signal})`);
      printServerChild = null;
      printServerStarted = false;
    });

    printServerStarted = true;
    console.log(`[Electron] ✅ Print server spawned as child process on port ${PRINT_SERVER_PORT}`);
    return true;
  } catch (forkErr) {
    console.error('[Electron] ❌ Child process fork failed:', forkErr.message);
    return false;
  }
}

// Every channel the preload bridge exposes. `exportName` is the function on the
// embedded print server module; the HTTP layer guards the same handlers.
const PRINT_IPC_CHANNELS = [
  ['print:receipt', 'handlePrintReceipt'],
  ['print:repair-label', 'handlePrintRepairLabel'],
  ['print:repair-ticket', 'handlePrintRepairTicket'],
  ['print:z-report', 'handlePrintZReport'],
  ['print:barcode', 'handlePrintBarcode'],
  ['print:custom-ticket', 'handlePrintCustomTicket'],
  ['print:calibrate-labels', 'handleCalibrateLabels'],
  ['print:low-stock-report', 'handlePrintLowStockReport'],
  ['print:parts-invoice', 'handlePrintPartsInvoice'],
];

function registerPrintIpcHandlers() {
  ipcMain.handle('print:status', async (event) => {
    if (!isTrustedPrintSender(event)) return refuseUntrusted(event, 'print:status');
    if (printServerModule && typeof printServerModule.handleStatus === 'function') {
      try {
        // No payload: handleStatus() defaults to the trusted in-process caller.
        return printServerModule.handleStatus();
      } catch (err) {
        logToFile(`[IPC print:status error] ${err.stack || err.message}`);
      }
    }
    return {
      ok: true,
      printer: process.env.PRINTER_NAME || 'Printer_POS_80',
      labelPrinter: process.env.LABEL_PRINTER_NAME || 'Xprinter_XP_420B',
      connected: true,
      hasCutter: process.env.HAS_CUTTER !== 'false',
    };
  });

  for (const [channel, exportName] of PRINT_IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, payload) => {
      if (!isTrustedPrintSender(event)) return refuseUntrusted(event, channel);

      const handler = printServerModule && printServerModule[exportName];
      if (typeof handler !== 'function') {
        return { ok: false, error: 'Print server module not initialized in main process' };
      }

      try {
        // This path never goes through the HTTP body middleware, so the same
        // control-byte and length guards have to be applied here.
        const safe =
          typeof printServerModule.sanitizeIpcPayload === 'function'
            ? printServerModule.sanitizeIpcPayload(payload)
            : payload;
        const res = await handler(safe);
        logToFile(`[IPC] ${channel} → ${JSON.stringify(res)}`);
        return res;
      } catch (err) {
        logToFile(`[IPC] ${channel} error: ${err.stack || err.message}`);
        return { ok: false, error: err.message };
      }
    });
  }
}

async function startEmbeddedPrintServer() {
  if (printServerStarted) return;

  const { serverPath, envPath } = getPrintServerPaths();
  logToFile(`[Electron] Starting embedded print server. serverPath=${serverPath}, envPath=${envPath}`);

  if (envPath) {
    process.env.DOTENV_CONFIG_PATH = envPath;
  }

  // ── Attempt 1: require() the module in-process (primary, provides native IPC + HTTP) ──
  try {
    if (serverPath) {
      logToFile(`[Electron] Requiring print server: ${serverPath}`);
      printServerModule = require(serverPath);
    }

    if (printServerModule && typeof printServerModule.startServer === 'function') {
      await printServerModule.startServer(PRINT_SERVER_PORT);
      printServerStarted = true;
      logToFile(`[Electron] ✅ Embedded print server started on port ${PRINT_SERVER_PORT}`);
      return;
    }
  } catch (err) {
    logToFile(`[Electron] ⚠️ In-process print server failed: ${err.stack || err.message}`);
    // If require succeeded partially, keep printServerModule for IPC
  }

  // ── Attempt 2: fork as child process fallback ──
  if (serverPath) {
    logToFile(`[Electron] Attempting child process fallback: ${serverPath}`);
    startPrintServerAsChildProcess(serverPath, envPath);
  } else {
    logToFile('[Electron] ❌ No print server script found.');
  }
}

// ─── Local Fast-Path App Server (Zero-Latency Offline Desktop Execution) ─────

function getDistPaths() {
  return [
    path.join(__dirname, '..', 'dist'),
    path.join(process.resourcesPath || '', 'app.asar', 'dist'),
    path.join(process.resourcesPath || '', 'dist'),
    path.join(app.getAppPath(), 'dist'),
  ];
}

function startLocalAppServer() {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.webp': 'image/webp',
  };

  const distCandidates = getDistPaths();
  let distDir = null;
  for (const candidate of distCandidates) {
    try {
      if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
        distDir = candidate;
        break;
      }
    } catch (_) {}
  }

  if (!distDir) {
    logToFile(`[Electron] ⚠️ No local dist folder found in candidates: ${distCandidates.join(', ')}`);
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const resolved = resolveStaticPath(distDir, req.url);
      if (!resolved) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad request path');
        return;
      }

      try {
        let filePath = resolved;

        let isFile = false;
        try {
          isFile = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
        } catch (_) {}

        // Anything that is not a real file falls back to the SPA entry point.
        if (!isFile) {
          filePath = path.join(distDir, 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading desktop asset');
          } else {
            res.writeHead(200, {
              'Content-Type': contentType,
              'X-Content-Type-Options': 'nosniff',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
            });
            res.end(content);
          }
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      localAppPort = server.address().port;
      localAppServer = server;
      logToFile(`[Electron] ✅ Local fast-path app server running on http://127.0.0.1:${localAppPort} (serving ${distDir})`);
      resolve(server);
    });

    server.on('error', (err) => {
      logToFile(`[Electron] ⚠️ Local app server error: ${err.message}`);
      resolve(null);
    });
  });
}

// ─── Window Creation ─────────────────────────────────────────────────────────

function createWindow() {
  // Get the app icon
  let iconPath;
  if (process.platform === 'win32') {
    iconPath = path.join(__dirname, '..', 'public', 'favicon.ico');
  } else {
    iconPath = path.join(__dirname, '..', 'public', 'favicon.svg');
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: APP_NAME,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    // Platform-specific titlebar styling
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0f172a',
    show: false, // Show after ready-to-show to prevent flash
  });

  // Show window when ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Load the app — prefer the live deployed version so updates and bug fixes apply instantly
  function loadDeployedSite() {
    logToFile('[Electron] 🌐 Loading app via deployed site: ' + DEPLOYED_URL);
    mainWindow.loadURL(DEPLOYED_URL).catch((err) => {
      logToFile(`[Electron] ⚠️ Remote load failed (${err ? err.message : ''}), trying local fallback`);
      if (localAppPort) {
        mainWindow.loadURL(`http://127.0.0.1:${localAppPort}`).catch(() => showNoInternetPage());
      } else {
        showNoInternetPage();
      }
    });
  }

  // Handle page load failures (e.g. lost connection mid-use or initial load timeout)
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    // Ignore aborted loads (user navigated away) and cache-related errors
    if (errorCode === -3 || errorCode === 0) return;
    logToFile(`[Electron] ⚠️ did-fail-load (code=${errorCode}: ${errorDescription}), falling back to local server`);
    if (localAppPort) {
      mainWindow.loadURL(`http://127.0.0.1:${localAppPort}`).catch(() => showNoInternetPage());
    } else {
      showNoInternetPage();
    }
  });

  function showNoInternetPage() {
    const noInternetHtml = `
      <html>
      <head><meta charset="utf-8"><title>No Internet Connection</title></head>
      <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
        background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e2e8f0;">
        <div style="text-align:center;padding:40px;">
          <div style="font-size:80px;margin-bottom:20px;">📡</div>
          <h1 style="font-size:28px;margin-bottom:12px;color:#f8fafc;">No Internet Connection</h1>
          <p style="font-size:16px;color:#94a3b8;margin-bottom:32px;max-width:400px;">
            PhoneShop Manager Pro requires an internet connection to load.<br>
            Please check your Wi-Fi or network cable and try again.
          </p>
          <button onclick="window.location.href='${DEPLOYED_URL}'"
            style="padding:14px 36px;font-size:16px;font-weight:600;border:none;border-radius:12px;cursor:pointer;
            background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;
            box-shadow:0 4px 15px rgba(59,130,246,0.4);transition:transform 0.2s,box-shadow 0.2s;"
            onmouseover="this.style.transform='scale(1.05)';this.style.boxShadow='0 6px 20px rgba(59,130,246,0.5)'"
            onmouseout="this.style.transform='scale(1)';this.style.boxShadow='0 4px 15px rgba(59,130,246,0.4)'">
            🔄 Retry Connection
          </button>
        </div>
      </body>
      </html>`;
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(noInternetHtml));
  }

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      if (localAppPort) {
        mainWindow.loadURL(`http://127.0.0.1:${localAppPort}`);
      } else {
        loadDeployedSite();
      }
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production: Prefer the live deployed version so cloud bugfixes apply immediately.
    // Falls back seamlessly to the local embedded fast-path server if offline.
    loadDeployedSite();
  }

  // Open external links in the default browser (keep deployed site + localhost in-app)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('http://localhost') ||
      url.startsWith('http://127.0.0.1') ||
      url.startsWith('file://') ||
      url.startsWith(DEPLOYED_URL)
    ) {
      return { action: 'allow' };
    }
    // Security: Only open safe http/https/mailto protocols via OS shell
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
        shell.openExternal(url);
      }
    } catch (_) {}
    return { action: 'deny' };
  });

  // Security: Prevent malicious in-window redirects away from trusted origins
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      const isAllowed =
        navigationUrl.startsWith('data:text/html') ||
        navigationUrl.startsWith(DEPLOYED_URL) ||
        (localAppPort && parsed.origin === `http://127.0.0.1:${localAppPort}`) ||
        parsed.origin === 'http://localhost:5173' ||
        parsed.origin === 'http://127.0.0.1:5173';
      if (!isAllowed) {
        event.preventDefault();
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          shell.openExternal(navigationUrl);
        }
      }
    } catch (_) {
      event.preventDefault();
    }
  });

  // Handle window close — minimize to tray on Windows, quit on Mac
  mainWindow.on('close', (event) => {
    if (process.platform === 'win32' && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── System Tray ─────────────────────────────────────────────────────────────

function createTray() {
  // Only create tray on Windows (macOS uses the dock)
  if (process.platform !== 'win32') return;

  try {
    const trayIconPath = path.join(__dirname, '..', 'public', 'favicon.ico');
    const icon = fs.existsSync(trayIconPath)
      ? nativeImage.createFromPath(trayIconPath)
      : nativeImage.createEmpty();

    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip(APP_NAME);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open PhoneShop Manager',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: `Print Server: ${printServerStarted ? '🟢 Online' : '🔴 Offline'}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Check for updates…',
        click: () => {
          updater.check({ interactive: true });
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          tray = null;
          app.exit(0);
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.warn('[Electron] Could not create system tray:', err.message);
  }
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

// Only allow one instance of the app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus the existing window when a second instance is launched
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('ready', async () => {
  // Before anything loads: Electron approves every permission by default.
  configurePermissionGate();

  // Start the embedded print server first
  await startEmbeddedPrintServer();

  // Start local fast-path static app server if local dist files are present
  await startLocalAppServer();

  // Register IPC handlers for direct native printing (bypasses network/CORS/mixed-content)
  registerPrintIpcHandlers();
  logToFile('[Electron] ✅ Print IPC handlers registered');

  // Create the main window
  createWindow();

  // Create system tray (Windows only)
  createTray();

  // Keep the shell itself updatable, not only the web UI it points at.
  updater.start();
});

// macOS: Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS: Re-create window when dock icon clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Clean shutdown
app.on('before-quit', () => {
  updater.stop();
  // Allow window to actually close (bypass tray hide)
  if (mainWindow) {
    mainWindow.removeAllListeners('close');
  }
  // Stop local fast-path app server
  if (localAppServer) {
    try {
      localAppServer.close();
      localAppServer = null;
    } catch (_) {}
  }
  // Kill the print server child process if it was spawned
  if (printServerChild) {
    try {
      printServerChild.kill();
      printServerChild = null;
    } catch (_) { /* already dead */ }
  }
});
