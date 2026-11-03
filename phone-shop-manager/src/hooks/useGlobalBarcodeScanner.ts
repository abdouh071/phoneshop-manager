import { useEffect, useRef } from 'react';
import { useInventoryStore } from '../store/inventoryStore';
import { useCartStore } from '../store/cartStore';
import { useToast } from '../components/ui/Toast';
import { describeCodeCandidates, resolveProductByCode } from '../utils/productCode';

const MAX_KEY_INTERVAL_MS = 60; // Barcode scanners type with < 40ms interval between characters
const MIN_BARCODE_LENGTH = 3;

/**
 * Global Barcode Scanner Auto-Detection Hook
 * Listens for hardware USB / Bluetooth barcode scanners firing rapid keystrokes,
 * and automatically adds matching products to the active POS cart.
 *
 * The POS screen runs its own scanner for the same keystrokes, because it can refuse
 * a repair part and switch the cashier to the products tab. Both listeners acting on
 * one scan put two units in the cart, so exactly one of them owns any given scan —
 * see the split inside the handler.
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
      const isTypingInField =
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // The POS page reads the same keystrokes, but deliberately ignores anything typed
      // into a field — and the search box is where a cashier parks their hands, so the
      // scan that lands there is this hook's to answer. Off that page a field means
      // someone is typing, not scanning, so a form value must never reach the cart.
      const ownsScan = window.location.pathname.startsWith('/pos') ? isTypingInField : !isTypingInField;
      if (!ownsScan) {
        // Without this the next Enter would read the whole typed sentence as a code.
        bufferRef.current = '';
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
          const resolution = resolveProductByCode(products, barcode);

          if (resolution.kind === 'ambiguous') {
            e.preventDefault();
            toast.error(
              'Same Code on Two Products',
              `"${barcode}" is saved on ${describeCodeCandidates(resolution.candidates)}. Pick the item from the list so the wrong row is not sold.`
            );
            return;
          }

          const matchedProduct = resolution.kind === 'unique' ? resolution.product : undefined;

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
