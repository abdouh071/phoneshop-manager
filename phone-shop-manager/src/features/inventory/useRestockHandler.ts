import { useTranslation } from 'react-i18next';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import type { PhoneModel } from '../../types';

export interface RestockMetaState {
  supplier: string;
  note: string;
  cost: string;
}

/**
 * Shared restock flow for product and part pages. Keeps validation, error
 * handling and success messaging identical so the two pages cannot drift.
 */
export function useRestockHandler(
  getAmount: () => string,
  meta: RestockMetaState,
  onSuccess: () => void
) {
  const { t } = useTranslation();
  const toast = useToast();
  const restockProduct = useInventoryStore((s) => s.restockProduct);

  return async (product: PhoneModel): Promise<void> => {
    const amt = parseInt(getAmount(), 10);
    if (isNaN(amt) || amt <= 0) return;
    try {
      const result = await restockProduct(product.id, amt, {
        supplier: meta.supplier || undefined,
        note: meta.note || undefined,
        cost: meta.cost ? parseFloat(meta.cost) : undefined,
      });
      if (result.outcome === 'failed') {
        toast.error(t('inventory.restockFailedTitle'), t('inventory.restockFailedDesc', { name: product.name }));
        return;
      }
      // 'queued' means only this device moved; saying "stock updated" would promise a server write.
      if (result.outcome === 'queued') {
        toast.info(
          t('inventory.restockQueuedTitle'),
          t('inventory.restockQueuedDesc', { amt: result.applied, name: product.name })
        );
      } else {
        toast.success(
          t('inventory.restockSuccessTitle', 'Stock Updated'),
          t('inventory.restockSuccessDesc', { amt: result.applied, name: product.name, defaultValue: `Added ${amt} units to ${product.name}` })
        );
      }
      onSuccess();
    } catch (err) {
      toast.error(t('error.failedToSave'), t('error.couldNotSave'));
    }
  };
}
