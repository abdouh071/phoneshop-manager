// Browser APIs that are not in the TypeScript DOM lib yet.
export {};

declare global {
  interface Window {
    /** Legacy prefixed WebAudio constructor (Safari < 14.1) */
    webkitAudioContext?: typeof AudioContext;
    /** Experimental browser-native QR / EAN barcode detector */
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<{ rawValue?: string }[]>;
    };
  }
}
