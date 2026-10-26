import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, CheckCircle2, AlertCircle, Barcode, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useInventoryStore } from '../../store/inventoryStore';
import { useCartStore } from '../../store/cartStore';
import { useToast } from '../ui/Toast';
import { useHaptic } from '../../hooks/useHaptic';
import type { Product } from '../../types';
import styles from './MobileBarcodeScannerModal.module.css';

interface MobileBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MobileBarcodeScannerModal: React.FC<MobileBarcodeScannerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isScanningRef = useRef<boolean>(false);

  const [hasCamera, setHasCamera] = useState<boolean>(true);
  const [cameraError, setCameraError] = useState<string>('');
  const [manualCode, setManualCode] = useState<string>('');
  const [lastScanned, setLastScanned] = useState<{ code: string; product?: Product } | null>(null);

  const { products } = useInventoryStore();
  const { addToCart } = useCartStore();
  const toast = useToast();
  const haptic = useHaptic();

  const handleProductDetected = useCallback((barcode: string) => {
    const cleanCode = barcode.trim().toLowerCase();
    if (!cleanCode) return;

    const matched = products.find(p =>
      p.sku?.toLowerCase() === cleanCode ||
      (p as any).barcode?.toLowerCase() === cleanCode ||
      p.id.toLowerCase() === cleanCode
    );

    if (matched) {
      haptic.success();
      const res = addToCart(matched);
      setLastScanned({ code: barcode, product: matched });

      if (res.success) {
        toast.success('Added to Cart', `${matched.name} ${matched.model}`);
      } else if (res.reason === 'out_of_stock') {
        toast.error('Out of Stock', `${matched.name} has 0 stock.`);
      } else if (res.reason === 'max_reached') {
        toast.warning('Max Stock Reached', `Available: ${res.availableStock}`);
      }
    } else {
      haptic.warning();
      setLastScanned({ code: barcode });
      toast.warning('Unknown Barcode', `No product found for SKU/Barcode: ${barcode}`);
    }

    // Reset overlay after 1.8s
    setTimeout(() => {
      setLastScanned(null);
    }, 1800);
  }, [products, addToCart, toast, haptic]);

  // Start camera stream when modal opens
  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    isScanningRef.current = true;

    async function startCamera() {
      try {
        setCameraError('');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Start scanning loop if BarcodeDetector is available
        if ('BarcodeDetector' in window) {
          const detector = new (window as any).BarcodeDetector({
            formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'],
          });

          let lastDetected = '';
          let lastDetectedTime = 0;

          const scanLoop = async () => {
            if (!active || !isScanningRef.current) return;
            if (videoRef.current && videoRef.current.readyState >= 2) {
              try {
                const barcodes = await detector.detect(videoRef.current);
                if (barcodes.length > 0) {
                  const rawVal = barcodes[0].rawValue;
                  const now = Date.now();
                  // Debounce same barcode within 2 seconds
                  if (rawVal && (rawVal !== lastDetected || now - lastDetectedTime > 2000)) {
                    lastDetected = rawVal;
                    lastDetectedTime = now;
                    handleProductDetected(rawVal);
                  }
                }
              } catch {
                // Ignore detection errors during frame drops
              }
            }
            animFrameRef.current = requestAnimationFrame(scanLoop);
          };

          animFrameRef.current = requestAnimationFrame(scanLoop);
        }
      } catch (err: any) {
        console.warn('[CameraScanner] Camera access error:', err);
        setHasCamera(false);
        setCameraError(err.message || 'Camera permission denied or camera unavailable.');
      }
    }

    startCamera();

    return () => {
      active = false;
      isScanningRef.current = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen, handleProductDetected]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    handleProductDetected(manualCode.trim());
    setManualCode('');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Scan Product Barcode"
      size="sm"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done Scanning
        </Button>
      }
    >
      <div className={styles.modal}>
        {cameraError ? (
          <div className={styles.errorBanner}>
            <AlertCircle size={18} />
            <span>{cameraError}</span>
          </div>
        ) : (
          <div className={styles.viewfinderContainer}>
            <video
              ref={videoRef}
              className={styles.video}
              playsInline
              muted
              autoPlay
            />
            <div className={styles.overlay}>
              <div className={styles.targetBox}>
                <div className={styles.scanLine} />
              </div>
            </div>

            {lastScanned && (
              <div className={styles.successOverlay}>
                {lastScanned.product ? (
                  <>
                    <CheckCircle2 size={36} />
                    <span className={styles.successTitle}>Scanned to Cart!</span>
                    <span className={styles.successProduct}>
                      {lastScanned.product.name} {lastScanned.product.model}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={36} style={{ color: '#fef08a' }} />
                    <span className={styles.successTitle}>Unknown Code</span>
                    <span className={styles.successProduct}>{lastScanned.code}</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Manual SKU input fallback */}
        <form onSubmit={handleManualSubmit} className={styles.manualRow}>
          <input
            type="text"
            className={styles.manualInput}
            placeholder="Type SKU or barcode manually…"
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!manualCode.trim()}>
            Add
          </Button>
        </form>
      </div>
    </Modal>
  );
};
