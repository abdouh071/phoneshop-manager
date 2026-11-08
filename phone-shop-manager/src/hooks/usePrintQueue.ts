import { useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { printRepairLabelDirect } from '../utils/printWindow';
import { useSettingsStore } from '../store/settingsStore';
import { useToast } from '../components/ui/Toast';

export function usePrintQueue() {
  const storeName = useSettingsStore(state => state.storeName);
  const toast = useToast();

  useEffect(() => {
    // Listen for pending print requests
    const q = query(
      collection(db, 'printQueue'),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const request = change.doc.data();
          const requestId = change.doc.id;

          if (request.type === 'repair_label' && request.ticket) {
            try {
              // Immediately mark as processing to prevent duplicate prints
              await updateDoc(doc(db, 'printQueue', requestId), { status: 'processing' });

              toast.info('Remote Print Job Received', `Printing sticker for ticket #${request.ticket.ticketNumber}...`);

              const result = await printRepairLabelDirect(request.ticket, storeName || 'PhoneShop Pro', 1);
              if (result.method === 'direct' && !result.error) {
                await updateDoc(doc(db, 'printQueue', requestId), { status: 'completed' });
                toast.success('Remote Print Complete', 'Sticker sent to printer.');
              } else {
                // A refusal is not paper, and the label's browser fallback prints
                // nothing: the sticker never left the PC. Record the real outcome
                // in the queue and on screen instead of blessing a bare job.
                const reason = result.error ?? 'Print server unreachable — no sticker was printed.';
                await updateDoc(doc(db, 'printQueue', requestId), { status: 'failed', error: reason });
                toast.error('Remote Print Failed', reason);
              }
            } catch (err) {
              console.error('Remote print failed', err);
              await updateDoc(doc(db, 'printQueue', requestId), { status: 'failed', error: err?.toString() });
              toast.error('Remote Print Failed', 'Failed to print the remote request.');
            }
          }
        }
      });
    });

    return () => unsubscribe();
  }, [storeName, toast]);
}
