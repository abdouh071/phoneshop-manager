import { useEffect, useRef } from 'react';
import { useInventoryStore } from '../store/inventoryStore';
import { useCartStore } from '../store/cartStore';
import { useToast } from '../components/ui/Toast';

const MAX_KEY_INTERVAL_MS = 60; // Barcode scanners type with < 40ms interval between characters
const MIN_BARCODE_LENGTH = 3;

/**
 * Global Barcode Scanner Auto-Detection Hook
 * Listens for hardware USB / Bluetooth barcode scanners firing rapid keystrokes,
 * and automatically adds matching products to the active POS cart.
 */
export function useGlobalBarcodeScanner() {
  const toast = useToast();
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const target = e.target as HTMLElement;
      // Do not intercept if user is typing in textarea or contenteditable
      if (target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const now = Date.now();
      const timeDiff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // Enter key marks the end of a barcode scanner sequence
      if (e.key === 'Enter') {
        const barcode = bufferRef.current.trim();
        bufferRef.current = '';

        if (barcode.length >= MIN_BARCODE_LENGTH) {
          const { products } = useInventoryStore.getState();
          const cleanCode = barcode.toLowerCase();

          const matchedProduct = products.find(p =>
            p.sku?.toLowerCase() === cleanCode ||
            p.barcode?.toLowerCase() === cleanCode ||
            p.id.toLowerCase() === cleanCode
          );

          if (matchedProduct) {
            e.preventDefault();
            const res = useCartStore.getState().addToCart(matchedProduct);
            if (res.success) {
              toast.success(
                'Scanned to Cart',
                `${matchedProduct.name} ${matchedProduct.model} added to POS cart.`
              );
            } else if (res.reason === 'out_of_stock') {
              toast.error('Out of Stock', `${matchedProduct.name} ${matchedProduct.model} has 0 stock.`);
            } else if (res.reason === 'max_reached') {
              toast.warning('Max Stock', `Cannot add more than available stock (${res.availableStock}).`);
            }
          }
        }
        return;
      }

      // If time between keystrokes is too long, reset the buffer (human typing)
      if (timeDiff > MAX_KEY_INTERVAL_MS) {
        bufferRef.current = '';
      }

      // Only buffer printable single characters
      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toast]);
}
