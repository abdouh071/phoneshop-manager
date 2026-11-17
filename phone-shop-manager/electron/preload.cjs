/**
 * Electron Preload Script — Secure Context Bridge
 *
 * Exposes a minimal API to the renderer process so it can detect
 * that it's running inside Electron (for print server auto-detection).
 *
 * Security: contextIsolation=true, nodeIntegration=false.
 * Only whitelisted values are exposed via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** True when running inside the Electron desktop app */
  isElectron: true,

  /** The platform the app is running on */
  platform: process.platform, // 'win32' | 'darwin' | 'linux'

  /** The port where the embedded print server is running */
  printServerPort: 3355,

  /** Explicit loopback IPv4 URL (bypasses IPv6 localhost issues on Windows) */
  printServerUrl: 'http://127.0.0.1:3355',

  /** Direct Native IPC Printing (bypasses network/CORS/firewall/mixed-content entirely) */
  checkStatus: () => ipcRenderer.invoke('print:status'),
  printReceipt: (payload) => ipcRenderer.invoke('print:receipt', payload),
  printRepairLabel: (payload) => ipcRenderer.invoke('print:repair-label', payload),
  printRepairTicket: (payload) => ipcRenderer.invoke('print:repair-ticket', payload),
  printZReport: (payload) => ipcRenderer.invoke('print:z-report', payload),
  printBarcode: (payload) => ipcRenderer.invoke('print:barcode', payload),
  printCustomTicket: (payload) => ipcRenderer.invoke('print:custom-ticket', payload),
  calibrateLabels: (payload) => ipcRenderer.invoke('print:calibrate-labels', payload),
  printLowStockReport: (payload) => ipcRenderer.invoke('print:low-stock-report', payload),
  printPartsInvoice: (payload) => ipcRenderer.invoke('print:parts-invoice', payload),
  printBigBoxLabel: (payload) => ipcRenderer.invoke('print:big-box-label', payload),
});
