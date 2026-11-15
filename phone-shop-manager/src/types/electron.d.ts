// Global augmentation for the Electron preload bridge (electron/preload.cjs)
export {};

interface ElectronPrintResult {
  ok?: boolean;
  error?: string;
  message?: string;
}

interface ElectronPrinterStatus {
  ok?: boolean;
  connected?: boolean;
  printer?: string;
  labelPrinter?: string;
  hasCutter?: boolean;
  error?: string;
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      platform: string;
      printServerPort: number;
      printServerUrl: string;
      checkStatus: () => Promise<ElectronPrinterStatus>;
      printReceipt: (payload: unknown) => Promise<ElectronPrintResult>;
      printRepairLabel: (payload: unknown) => Promise<ElectronPrintResult>;
      printRepairTicket: (payload: unknown) => Promise<ElectronPrintResult>;
      printZReport: (payload: unknown) => Promise<ElectronPrintResult>;
      printBarcode: (payload: unknown) => Promise<ElectronPrintResult>;
      printCustomTicket: (payload: unknown) => Promise<ElectronPrintResult>;
      calibrateLabels: (payload: unknown) => Promise<ElectronPrintResult>;
      printLowStockReport: (payload: unknown) => Promise<ElectronPrintResult>;
      printPartsInvoice: (payload: unknown) => Promise<ElectronPrintResult>;
    };
  }
}
