/**
 * Telling the seller why the basket refused a unit.
 *
 * The checkout sheet's + button used to clamp the quantity in silence, so a tap
 * did nothing and nobody knew the shelf was empty. Both tills now refuse in the
 * store and name the count here, from one message per reason.
 */
import { Alert } from 'react-native';
import i18n from '../i18n';
import type { CartStockResult } from './cartStock.ts';

export const alertCartStockRefusal = (result: CartStockResult, productName: string): void => {
  if (result.success) return;
  if (result.reason === 'out_of_stock') {
    Alert.alert(
      i18n.t('common.outOfStock', 'Out of Stock'),
      i18n.t('pos.outOfStockBody', '{{name}} has 0 available units.', { name: productName })
    );
    return;
  }
  if (result.reason === 'max_reached') {
    Alert.alert(
      i18n.t('pos.maxStockTitle', 'Max Stock'),
      i18n.t('pos.maxStockBody', 'Only {{n}} unit(s) available.', { n: result.availableStock ?? 0 })
    );
  }
};