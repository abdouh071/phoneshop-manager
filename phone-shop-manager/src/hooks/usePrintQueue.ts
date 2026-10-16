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
              
              // Print via existing print utils
              await printRepairLabelDirect(request.ticket, storeName || 'PhoneShop Pro', 1);
              
              // Mark as completed
              await updateDoc(doc(db, 'printQueue', requestId), { status: 'completed' });
              toast.success('Remote Print Complete', 'Sticker sent to printer.');
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
