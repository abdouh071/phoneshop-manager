/**
 * Correcting a settled invoice, on the phone, in place.
 * ====================================================
 * This sheet replaces the button that used to dump an old sale into the live cart —
 * which left the invoice untouched and sold the goods a second time. Nothing here
 * goes near the cart. The lines you see are the lines on the document, and saving
 * rewrites that one document plus the stock its changes imply.
 *
 * The rules are the counter terminal's `EditTransactionModal`: a quantity stepper,
 * a unit price field, one "return stock?" choice per SKU, and a summary that names
 * the difference in the same two directions the desktop does. The stepper climbs past
 * what was sold as far as the counter can give, and stops there.
 *
 * Who may save is the till's own rule: an admin at the counter types a PIN and acts;
 * a phone cannot hold a PIN (see `AdminApprovalSheet`), so a technician's save is
 * sent to the admins as a request carrying exactly the diff they are approving, and
 * the write happens the moment one of them answers.
 *
 * A product the invoice never carried can be put on it — the customer who comes back
 * for a second cable is answered at the counter, not by ringing a new sale. The shelf
 * decides whether the line is possible: nothing with no units behind it can be added,
 * and the save asks the counter one more time before it writes.
 */
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, ScrollView, StyleSheet, TouchableOpacity, Vibration, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { usePosStore } from '../store/posStore';
import { applySaleEdit, findOversoldLines, type SaleEditOutcome } from '../services/saleEditService';
import { readStockLevels } from '../services/stockService';
import { diffSaleEdit, planSaleEdit, type SaleLineEdits, type SaleRestockChoices } from '../utils/saleEdit';
import {
  groupDocumentLines,
  lineUnit,
  returnedAmount,
  returnedUnits,
  signedLineTotal,
  soldUnits,
} from '../utils/saleEditLines';
import {
  DISCOUNT_APPROVAL_PERCENT,
  lineDiscountOf,
  requiresLineDiscountApproval,
  unitPriceAfterDiscount,
} from '../utils/discountPolicy.ts';
import { buildSearch, matchesSearch } from '../utils/search';
import { AdminApprovalSheet, type ApprovalPayload } from './AdminApprovalSheet';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import type { CartItem, PhoneModel, SaleTransaction } from '../types';

/**
 * `discount` is the number exactly as it was typed. The price is the truth the
 * document stores, and a discount re-derived from it lands on 99.99 where the
 * cashier typed 100 — rewriting the field under the caret.
 */
type LineDraft = { quantity: number; price: string; discount?: string };

/**
 * One row of the sheet: one SKU the document carried, or one being put on it. A SKU can
 * sit on an invoice twice — the phone sold and the same phone taken back in trade — and
 * both rows share this one control, because that is the till's rule.
 */
type EditRow = {
  id: string;
  name: string;
  /** Units the document sold. The stepper starts from what he keeps, not this. */
  sold: number;
  /** What he leaves with on the document as it stands — where the control opens. */
  keptNow: number;
  /** The price the sold line carries, and the base a new concession is measured from. */
  listedUnit: number;
  added: boolean;
};

/** A runaway tap should not be able to write a hundred-unit invoice. */
const MAX_UNITS = 999;

const wholeUnits = (value: number): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** What the catalogue asks for a product, floored at nothing when it was stored without a price. */
const listedPrice = (product: PhoneModel): number => Math.max(0, Number(product?.price) || 0);

interface EditSaleSheetProps {
  visible: boolean;
  transaction: SaleTransaction | null;
  /**
   * What the shelf held for each product when the sheet opened, `null` per product
   * when it has no inventory row and `undefined` altogether while the read is still
   * in flight or failed. It decides how far a line may grow; the save re-checks it,
   * so a count that moved in the meantime cannot be sold twice.
   */
  stockLevels?: Map<string, number | null> | null;
  onClose: () => void;
  onSaved?: (outcome: SaleEditOutcome) => void;
}

const amount = (n: number): string => n.toLocaleString();

export const EditSaleSheet = ({
  visible,
  transaction,
  stockLevels,
  onClose,
  onSaved,
}: EditSaleSheetProps) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);

  const unknownItem = t('salesHistory.unknownItem', 'Item');

  /**
   * Keyed by product id, as the desktop keys `editedQuantities` / `editedPrices` /
   * `returnToStock` — so one SKU on two rows of the same invoice is one control. The
   * number a row holds is what the customer LEAVES WITH, which on an invoice already
   * corrected is its sold units less whatever it already carries back.
   *
   * Seeded once, on mount, from the document as it stood when the sheet opened. The
   * caller keys this component on the invoice, so a new sale means a new mount, and
   * the live history listener handing over a fresh object every few seconds cannot
   * wipe what the cashier is typing.
   */
  const carriedLines = useMemo(() => groupDocumentLines(transaction?.items ?? []), [transaction]);

  const [draft, setDraft] = useState<Record<string, LineDraft>>(() => {
    const out: Record<string, LineDraft> = {};
    groupDocumentLines(transaction?.items ?? []).forEach(view => {
      out[view.productId] = { quantity: view.kept, price: String(view.listedUnit) };
    });
    return out;
  });
  const [restock, setRestock] = useState<SaleRestockChoices>(() => {
    const out: SaleRestockChoices = {};
    const items = transaction?.items ?? [];
    groupDocumentLines(items).forEach(view => {
      // A unit the document already took back without putting it on the shelf stays off
      // it. The flag defaults to restocking, so without this the phone would silently
      // send a faulty phone back onto the shelf it never left.
      out[view.productId] = !items.some(
        item => item.product?.id === view.productId && Boolean(item.isReturn) && item.restock === false
      );
    });
    return out;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isAsking, setIsAsking] = useState(false);

  // Putting a product on an invoice that was already sold. The picker reads the
  // catalogue the till already holds; a phone that never opened the POS grid loads
  // it once, here, rather than keeping a second subscription alive.
  const products = usePosStore(s => s.products);
  const loadProducts = usePosStore(s => s.fetchProducts);
  const catalogueLoading = usePosStore(s => s.isLoading);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  /** The catalogue snapshot the line was built from, so a row keeps its name and its
      price even while the product list reloads behind it. */
  const [addedProducts, setAddedProducts] = useState<Record<string, PhoneModel>>({});
  /** The counter's own count for a picked product, read once when it was added. */
  const [addedShelf, setAddedShelf] = useState<Map<string, number | null>>(new Map());
  const [isPicking, setIsPicking] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const [isReadingShelf, setIsReadingShelf] = useState(false);

  /** A product on the document is edited on its own row; the picker must not offer it twice. */
  const onInvoice = useMemo(
    () =>
      new Set(
        (transaction?.items ?? [])
          .map(item => item.product?.id)
          .filter((id): id is string => Boolean(id))
      ),
    [transaction]
  );

  const rows = useMemo<EditRow[]>(
    () => [
      ...carriedLines.map(view => ({
        id: view.productId,
        name: view.name || unknownItem,
        sold: view.sold,
        keptNow: view.kept,
        listedUnit: view.listedUnit,
        added: false,
      })),
      ...addedIds
        .filter(id => addedProducts[id] && !onInvoice.has(id))
        .map(id => ({
          id,
          name: addedProducts[id].name || addedProducts[id].model || unknownItem,
          sold: 0,
          keptNow: 0,
          listedUnit: listedPrice(addedProducts[id]),
          added: true,
        })),
    ],
    [addedIds, addedProducts, carriedLines, onInvoice, unknownItem]
  );

  const edits: SaleLineEdits = useMemo(() => {
    const out: SaleLineEdits = {};
    rows.forEach(row => {
      const id = row.id;
      if (!id) return;
      const entered = draft[id];
      if (!entered) return;
      const parsed = Number(String(entered.price).replace(',', '.'));
      out[id] = {
        quantity: entered.quantity,
        // A half-typed number keeps the price the line already had. Reading it as
        // 0 DA would let someone refund a phone by typing into the wrong field.
        unitPrice: Number.isFinite(parsed) && parsed >= 0 ? parsed : row.listedUnit,
      };
    });
    return out;
  }, [draft, rows]);

  const addedLines = useMemo<CartItem[]>(
    () =>
      addedIds.reduce<CartItem[]>((list, id) => {
        const product = addedProducts[id];
        if (!product) return list;
        list.push({
          product,
          quantity: draft[id]?.quantity ?? 0,
          unitPrice: edits[id]?.unitPrice ?? listedPrice(product),
        });
        return list;
      }, []),
    [addedIds, addedProducts, draft, edits]
  );

  const plan = useMemo(
    () => (transaction ? planSaleEdit(transaction, edits, restock, addedLines) : null),
    [transaction, edits, restock, addedLines]
  );

  /**
   * What each sold line gives away against the price the document carried for it —
   * whether that came from the discount field or from a price cut by hand. The customer
   * and the reports see only a price, so the approval has to be asked for both alike, or
   * the rule would have a side door.
   *
   * The lines that came back off the invoice are not in this: a concession is money let
   * on what the customer bought, and measuring one on a unit he handed back would record
   * a giveaway the shop never made — which every correction would now do.
   */
  const concessions = useMemo(
    () =>
      (plan?.items ?? [])
        .filter(item => item?.product?.id && !item.isReturn)
        .map(item => ({
          id: item.product.id,
          name: item.product.name || item.product.model || unknownItem,
          ...lineDiscountOf(
            rows.find(row => row.id === item.product?.id)?.listedUnit ?? item.product.price,
            lineUnit(item),
            item.quantity
          ),
        }))
        .filter(line => line.granted > 0),
    [plan, rows, unknownItem]
  );

  const concessionsTotal = concessions.reduce((sum, line) => sum + line.granted, 0);
  const deepConcessions = concessions.filter(line => requiresLineDiscountApproval(user?.role, line.percent));
  const deepestDiscountPercent = deepConcessions.reduce((worst, line) => Math.max(worst, line.percent), 0);

  const invoiceLabel = transaction?.invoiceNumber || transaction?.id.slice(-6) || '';

  /** The badge wording the history list uses — a snake_case Firestore token
      would land untranslated in the French and Arabic sentences. */
  const statusLabel = (status: SaleTransaction['status']): string =>
    status === 'refunded'
      ? t('salesHistory.statusRefunded', 'REFUNDED')
      : status === 'partially_refunded'
        ? t('salesHistory.statusEdited', 'CORRECTED')
        : status === 'voided'
          ? t('salesHistory.statusVoided', 'VOIDED')
          : t('salesHistory.statusCompleted', 'COMPLETED');

  const setQuantity = (id: string, quantity: number, maxQty: number) => {
    if (!id) return;
    setDraft(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        quantity: Math.max(0, Math.min(Math.max(0, maxQty), Math.trunc(Number(quantity) || 0))),
        // Another unit changes what a typed discount is worth, so the field reads the
        // concession back off the line instead of holding a stale number.
        discount: undefined,
      },
    }));
  };

  const setPrice = (id: string, price: string) => {
    if (!id) return;
    setDraft(prev => ({ ...prev, [id]: { ...prev[id], price, discount: undefined } }));
  };

  /**
   * The discount and the unit price are one number seen from two sides: the
   * concession is measured from the price the document carried and spread over the
   * units it holds, so the line the till prints and the line the reports add up stay
   * the same line.
   */
  const setDiscount = (id: string, raw: string, listUnit: number, quantity: number) => {
    if (!id) return;
    const parsed = Number(String(raw).replace(',', '.'));
    const unit = unitPriceAfterDiscount(listUnit, Number.isFinite(parsed) ? parsed : 0, quantity);
    setDraft(prev => ({ ...prev, [id]: { ...prev[id], discount: raw, price: String(unit) } }));
  };

  /**
   * What the counter holds for one product. The parent read the sold lines when the
   * sheet opened and a picked product was read when it was added; `undefined` means
   * nobody has looked, which leaves the ceiling off and the save to ask again.
   */
  const shelfOf = (id: string): number | null | undefined => {
    if (!id) return undefined;
    if (stockLevels?.has(id)) return stockLevels.get(id) ?? null;
    if (addedShelf.has(id)) return addedShelf.get(id) ?? null;
    return undefined;
  };

  const pickList = useMemo(
    () =>
      products
        .map(product => ({
          product,
          doc: buildSearch(product.name, product.model, product.sku, product.barcode, product.brand),
        }))
        .filter(({ doc }) => matchesSearch(doc, pickQuery))
        .map(({ product }) => product),
    [pickQuery, products]
  );

  /**
   * The counter decides whether a product may join the invoice. One SKU is read, not
   * the shop re-counted, and a shelf with nothing behind it is refused here rather
   * than written and blocked at the save — a customer is not sold a cable twice over
   * because a picker let an empty box through.
   */
  const pickProduct = async (product: PhoneModel) => {
    const id = product?.id;
    if (!id || isReadingShelf || onInvoice.has(id) || addedIds.includes(id)) return;
    const name = product.name || product.model || id;

    setIsReadingShelf(true);
    let counted: number | null | undefined;
    try {
      const levels = await readStockLevels([id]);
      counted = levels.has(id) ? (levels.get(id) ?? null) : undefined;
    } catch {
      counted = undefined;
    } finally {
      setIsReadingShelf(false);
    }

    if (counted === null) {
      Alert.alert(
        t('salesHistory.editBlockedTitle', 'Those units are not in the shop'),
        t('salesHistory.editBlockedMissing', '{{name}} has no inventory row left.', { name })
      );
      return;
    }
    const listed = Math.max(0, Number(product.stock) || 0);
    if (counted === 0 || (counted === undefined && listed <= 0)) {
      Alert.alert(
        t('common.outOfStock', 'Out of Stock'),
        t('pos.outOfStockBody', '{{name}} has 0 available units.', { name })
      );
      return;
    }

    setAddedProducts(prev => ({ ...prev, [id]: product }));
    setAddedIds(prev => [...prev, id]);
    setDraft(prev => ({ ...prev, [id]: { quantity: 1, price: String(listedPrice(product)) } }));
    // A count the read never gave is left unknown on purpose: the row then has no
    // ceiling, and the save asks the shelf before it writes anything.
    if (counted !== undefined) setAddedShelf(prev => new Map(prev).set(id, counted));
    setIsPicking(false);
    Vibration.vibrate(30);
  };

  /** A line that was never sold has no money on the document to correct, so it can
      leave the invoice whole. */
  const removeAddedRow = (id: string) => {
    if (!id) return;
    setAddedIds(prev => prev.filter(row => row !== id));
    setAddedShelf(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setDraft(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const openPicker = () => {
    setIsPicking(true);
    if (products.length === 0) void loadProducts();
  };

  const commit = async () => {
    if (!transaction || !plan || !plan.hasChanges || isSaving) return;
    // Goods the customer handed back outweighing the basket is a surplus, and only
    // the counter settles one — so nothing here is written, shelf included.
    if (plan.surplusOwedToCustomer) {
      Alert.alert(
        t('salesHistory.editSurplusTitle', 'This correction leaves the receipt owing the customer'),
        t('salesHistory.editSurplusBody', '{{amount}} DA more is coming back than this invoice holds. Settle it at the counter, where the shop records whether it went back as cash, onto his account, or off what he owes.', {
          amount: amount(Math.abs(plan.total)),
        })
      );
      return;
    }
    setIsSaving(true);
    try {
      // The shelf may have emptied since the sheet opened — another till sold the
      // last unit, or this phone is looking at a cached count. Asking it for units
      // it does not hold would write a sale the shop cannot cover, so the live
      // count is read once more and an oversold line stops the save.
      const oversold = await findOversoldLines(plan);
      if (oversold.length > 0) {
        Alert.alert(
          t('salesHistory.editBlockedTitle', 'Those units are not in the shop'),
          oversold
            .map(row =>
              row.available === null
                ? t('salesHistory.editBlockedMissing', '{{name}} has no inventory row left.', { name: row.name })
                : t('salesHistory.editBlockedShort', '{{name}}: {{available}} in stock, this edit sells {{wanted}}.', {
                    name: row.name,
                    available: row.available,
                    wanted: row.wanted,
                  })
            )
            .join('\n')
        );
        return;
      }

      const outcome = await applySaleEdit(transaction, plan);
      Vibration.vibrate([0, 50, 50, 80]);
      const difference =
        plan.refundDue > 0
          ? t('salesHistory.editSavedRefund', ' Refund due: {{amount}} DA', { amount: amount(plan.refundDue) })
          : plan.additionalDue > 0
            ? t('salesHistory.editSavedExtra', ' Extra collected: {{amount}} DA', { amount: amount(plan.additionalDue) })
            : '';
      Alert.alert(
        t('salesHistory.editSavedTitle', 'Receipt Updated'),
        (outcome.stockFailures.length > 0
          ? t('salesHistory.editSavedQueued', 'Transaction {{id}} has been modified. {{count}} stock change could not be written and is queued for the next sync.', {
              id: transaction.id,
              count: outcome.stockFailures.length,
            })
          : t('salesHistory.editSavedBody', 'Transaction {{id}} has been modified.', { id: transaction.id })) +
          difference +
          // Money the customer handed over for an invoice that has just been priced
          // below what he paid does not leave the drawer — the counter's rule keeps it
          // on his profile. Without this line the phone has just told the till to go
          // looking for a refund nobody owes in cash.
          (outcome.avoirHeld > 0
            ? t('salesHistory.editSavedAvoir', ' Nothing is paid out: {{amount}} DA is kept as Avoir on the customer account.', {
                amount: amount(outcome.avoirHeld),
              })
            : '') +
          // The invoice says the customer owes this; his account still says something
          // else, and only a person can close the gap. Saying nothing would let the
          // till believe the correction was finished.
          (outcome.accountUnreconciled > 0
            ? t('salesHistory.editSavedUnreconciled', ' Its {{amount}} DA balance is still open on the customer account — clear it from the Customers tab.', {
                amount: amount(outcome.accountUnreconciled),
              })
            : '')
      );
      onSaved?.(outcome);
      onClose();
    } catch (err) {
      Alert.alert(
        t('salesHistory.editFailedTitle', 'Edit Failed'),
        err instanceof Error ? err.message : String(err ?? t('common.unknownError', 'Unknown error'))
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = () => {
    if (!plan?.hasChanges || isSaving) return;
    if (user?.role === 'admin') {
      void commit();
      return;
    }
    setIsAsking(true);
  };

  const changes = useMemo(
    () => (transaction ? diffSaleEdit(transaction, edits, addedLines) : []),
    [transaction, edits, addedLines]
  );

  /** How many of the lines the cashier added actually carry units. */
  const newLineCount = addedLines.reduce((sum, line) => sum + (wholeUnits(line.quantity) > 0 ? 1 : 0), 0);

  const approvalPayload: ApprovalPayload = {
    actionType: 'pos_edit_receipt',
    actionLabel:
      t(
        'salesHistory.editApprovalLabel',
        'Edit receipt #{{invoice}} from {{from}} DA to {{to}} DA',
        { invoice: invoiceLabel, from: amount(transaction?.total || 0), to: amount(plan?.total || 0) }
      ) +
      // An admin reading only this line still learns that goods the invoice never
      // had are going out of the shop.
      (newLineCount > 0
        ? t('salesHistory.editApprovalAdds', ' — plus {{count}} new line(s)', { count: newLineCount })
        : '') +
      // An admin who only reads the headline still learns that a fifth of a product
      // is being given away, not just that the total moved.
      (deepConcessions.length > 0
        ? t('salesHistory.editApprovalDiscounts', ' — plus {{percent}}% off {{count}} line(s)', {
            percent: deepestDiscountPercent.toFixed(1),
            count: deepConcessions.length,
          })
        : ''),
    targetId: transaction?.id,
    actionData: {
      itemType: 'sale_edit',
      saleId: transaction?.id,
      invoiceNumber: invoiceLabel,
      originalTotal: transaction?.total || 0,
      newTotal: plan?.total || 0,
      newSubtotal: plan?.subtotal || 0,
      resultingStatus: plan?.status,
      customerName: transaction?.customerName || t('pos.walkInCustomer', 'Walk-in Customer'),
      changes,
      lineDiscountAmount: Math.round(concessionsTotal),
      deepestLineDiscountPercent: Number(deepestDiscountPercent.toFixed(1)),
      deepLineDiscounts: deepConcessions.map(line => ({
        name: line.name,
        percent: Number(line.percent.toFixed(1)),
        amount: Math.round(line.granted),
      })),
      unitsBackOnShelf: plan?.restock.reduce((sum, l) => sum + l.quantity, 0) || 0,
      unitsTakenFromShelf: plan?.deduct.reduce((sum, l) => sum + l.quantity, 0) || 0,
    },
  };

  if (!transaction || !plan) return null;

  const unitsSold = soldUnits(plan.items);
  const unitsBack = returnedUnits(plan.items);

  const saveLabel =
    plan.refundDue > 0
      ? t('salesHistory.editRefundBtn', 'Refund Difference ({{amount}} DA)', { amount: amount(plan.refundDue) })
      : plan.additionalDue > 0
        ? t('salesHistory.editCollectBtn', 'Collect Difference ({{amount}} DA)', { amount: amount(plan.additionalDue) })
        : t('salesHistory.editSaveBtn', 'Save Changes');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.header}>
            <MaterialCommunityIcons name="file-document-edit-outline" size={24} color={colors.brand} />
            <View style={styles.headerText}>
              <Text style={styles.title}>{t('salesHistory.editTitle', 'Edit Receipt & Prices')}</Text>
              <Text style={styles.subtitle}>
                {t('salesHistory.editSubtitle', 'Order #{{invoice}} • {{date}}', {
                  invoice: invoiceLabel,
                  date: new Date(transaction.date).toLocaleDateString(),
                })}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel={t('common.close', 'Close')}>
              <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.bodyContent}>
            <Text style={styles.hint}>
              {t(
                'salesHistory.editHint',
                'Adjust unit prices, quantities and discounts, or put a product the invoice never carried onto it. The quantity is what the customer LEAVES WITH: bring a line down and the units that come back are added to the receipt as their own − line, at a price deducted from the total — the sold line is never rubbed out, so a fully returned invoice still lists every product. Inventory and totals recalculate automatically, and a line the shelf cannot give is refused before anything is written.'
              )}
            </Text>

            {rows.map(row => {
              const pid = row.id;
              const kept = draft[pid]?.quantity ?? row.keptNow;
              const unitPrice = edits[pid]?.unitPrice ?? row.listedUnit;
              /** This SKU's lines on the document the save writes, credit lines included. */
              const skuLines = plan.items.filter(item => item?.product?.id === pid);
              const backQty = returnedUnits(skuLines);
              const backMoney = returnedAmount(skuLines);
              const lineNet = skuLines.reduce((sum, item) => sum + signedLineTotal(item), 0);
              const willRestock = restock[pid] !== false;
              const name = row.name;
              // Sold units are already committed; anything new has to come off the
              // counter. No count yet (read in flight or failed) means no ceiling,
              // and the save re-checks the shelf before it writes. `null` is a real
              // answer — the product has no inventory row, so nothing can come off.
              const onShelf = shelfOf(pid);
              const maxQty =
                onShelf === undefined
                  ? MAX_UNITS
                  : Math.min(MAX_UNITS, row.sold + Math.max(0, onShelf ?? 0));
              const atCeiling = kept >= maxQty;
              // The concession is what the sold lines give away, so it is spread over
              // the units they print at — the documented ones plus any the control added.
              const grew = Math.max(0, kept - row.sold);
              const unitsPriced = row.sold + grew;
              const concession = lineDiscountOf(row.listedUnit, unitPrice, unitsPriced);
              const overDiscount = requiresLineDiscountApproval(user?.role, concession.percent);
              // A row of the document reads "what he leaves with / what was sold";
              // a line nobody bought yet has nothing to be measured against.
              const stepLabel = row.added ? String(kept) : `${kept} / ${row.sold}`;

              return (
                <View key={pid} style={styles.line}>
                  <View style={styles.lineHead}>
                    <View style={styles.lineHeadText}>
                      <Text style={styles.lineName} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={styles.lineSub} numberOfLines={1}>
                        {row.added
                          ? typeof onShelf === 'number'
                            ? t('salesHistory.editLineNewShelf', 'New line · {{count}} on the shelf', {
                                count: onShelf,
                              })
                            : t('salesHistory.editLineNew', 'New line')
                          : onShelf === undefined
                            ? t('salesHistory.editLineSold', 'Sold {{qty}} at {{price}} DA', {
                                qty: row.sold,
                                price: amount(row.listedUnit),
                              })
                            : onShelf === null
                              ? t('salesHistory.editLineNoRow', 'Sold {{qty}} · {{name}} has no stock row', {
                                  qty: row.sold,
                                  name,
                                })
                              : t('salesHistory.editLineShelf', 'Sold {{qty}} · {{count}} on the shelf', {
                                  qty: row.sold,
                                  count: onShelf,
                                })}
                      </Text>
                      {backQty > 0 && (
                        <Text style={styles.lineReturned}>
                          {t(
                            'salesHistory.editLineHandedBack',
                            '−{{count}} handed back · −{{amount}} DA comes off this invoice',
                            { count: backQty, amount: amount(backMoney) }
                          )}
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.lineTotal, lineNet < 0 && styles.summaryDanger]}>
                      {lineNet < 0 ? '−' : ''}
                      {amount(Math.abs(lineNet))} DA
                    </Text>
                  </View>

                  <View style={styles.controls}>
                    <TextInput
                      label={t('salesHistory.unitPriceLabel', 'Unit price (DA)')}
                      value={draft[pid]?.price ?? String(row.listedUnit)}
                      onChangeText={next => setPrice(pid, next)}
                      mode="outlined"
                      dense
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      style={styles.priceInput}
                      accessibilityLabel={t('salesHistory.unitPriceLabel', 'Unit price (DA)')}
                    />

                    <View style={styles.stepper}>
                      <TouchableOpacity
                        style={[styles.stepBtn, kept <= 0 && styles.stepBtnOff]}
                        onPress={() => setQuantity(pid, kept - 1, maxQty)}
                        disabled={kept <= 0}
                        accessibilityLabel={t('salesHistory.decrease', 'Decrease quantity')}
                      >
                        <MaterialCommunityIcons name="minus" size={18} color={kept <= 0 ? colors.textFaint : colors.brand} />
                      </TouchableOpacity>
                      <View>
                        <Text style={styles.stepValue}>{stepLabel}</Text>
                        <Text style={styles.stepCaption}>
                          {t('salesHistory.editKeeps', 'he keeps')}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.stepBtn, atCeiling && styles.stepBtnOff]}
                        onPress={() => setQuantity(pid, kept + 1, maxQty)}
                        disabled={atCeiling}
                        accessibilityLabel={t('salesHistory.increase', 'Increase quantity')}
                      >
                        <MaterialCommunityIcons name="plus" size={18} color={atCeiling ? colors.textFaint : colors.brand} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.discountRow}>
                    <TextInput
                      label={t('salesHistory.editDiscountInput', 'Discount (DA)')}
                      value={
                        draft[pid]?.discount ?? (concession.granted > 0 ? String(concession.granted) : '')
                      }
                      onChangeText={next => setDiscount(pid, next, row.listedUnit, unitsPriced)}
                      mode="outlined"
                      dense
                      keyboardType="decimal-pad"
                      returnKeyType="done"
                      disabled={unitsPriced <= 0}
                      style={styles.discountInput}
                      accessibilityLabel={t('salesHistory.editDiscountA11y', 'Discount on this line (DA)')}
                    />
                    {concession.granted > 0 && (
                      <Text style={[styles.discountPercent, overDiscount && styles.discountOver]}>
                        −{concession.percent.toFixed(1)}%
                      </Text>
                    )}
                  </View>

                  {overDiscount ? (
                    <Text style={styles.discountNote}>
                      {t(
                        'salesHistory.editDiscountOver',
                        'Over {{percent}}% of what this line was sold at — an admin has to approve it.',
                        { percent: DISCOUNT_APPROVAL_PERCENT }
                      )}
                    </Text>
                  ) : null}

                  {row.added ? (
                    <TouchableOpacity
                      style={styles.removeRow}
                      onPress={() => removeAddedRow(pid)}
                      accessibilityLabel={t('salesHistory.editRemoveLine', 'Remove this line from the invoice')}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.dangerText} />
                      <Text style={styles.removeRowText}>
                        {t('salesHistory.editRemoveLine', 'Remove this line from the invoice')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {atCeiling && onShelf !== undefined ? (
                    <Text style={styles.ceilingNote}>
                      {onShelf === null
                        ? t('salesHistory.editCeilingNoRow', 'There is no stock row for this item, so only what was already sold stays on the invoice.')
                        : onShelf <= 0
                          ? t('salesHistory.editCeilingEmpty', 'The shelf is empty — this line cannot grow.')
                          : t('salesHistory.editCeilingShelf', 'The shelf holds {{count}}, so this line stops at {{max}}.', {
                              count: onShelf,
                              max: maxQty,
                            })}
                    </Text>
                  ) : null}

                  {backQty > 0 ? (
                    <TouchableOpacity
                      style={styles.restockRow}
                      onPress={() => setRestock(prev => ({ ...prev, [pid]: !willRestock }))}
                    >
                      <MaterialCommunityIcons
                        name={willRestock ? 'check-circle' : 'circle-outline'}
                        size={20}
                        color={willRestock ? colors.success : colors.textMuted}
                      />
                      <Text style={[styles.restockText, willRestock ? styles.restockYes : styles.restockNo]}>
                        {willRestock
                          ? t('salesHistory.restockYes', '+{{count}} Stock', { count: backQty })
                          : t('salesHistory.restockNo', 'Do not restock')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {grew > 0 ? (
                    <Text style={styles.addedNote}>
                      {t('salesHistory.unitsAdded', '+{{count}} unit(s) come off the shelf when you save', {
                        count: grew,
                      })}
                    </Text>
                  ) : null}
                </View>
              );
            })}

            <TouchableOpacity
              style={styles.addRow}
              onPress={openPicker}
              accessibilityRole="button"
              accessibilityLabel={t('salesHistory.editAddProduct', 'Add a product to this invoice')}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={20} color={colors.brand} />
              <Text style={styles.addRowText}>
                {t('salesHistory.editAddProduct', 'Add a product to this invoice')}
              </Text>
            </TouchableOpacity>

            <View style={styles.summary}>
              <Text style={styles.unitsNote}>
                {t('salesHistory.editUnitsLine', '{{sold}} unit(s) sold on this receipt', {
                  sold: unitsSold,
                })}
                {unitsBack > 0
                  ? t('salesHistory.editUnitsHandedBack', ' · −{{returned}} handed back', {
                      returned: unitsBack,
                    })
                  : ''}
              </Text>
              <SummaryRow
                label={t('salesHistory.editOriginalTotal', 'Original Total')}
                value={`${amount(transaction.total)} DA`}
              />
              <SummaryRow
                label={t('salesHistory.editPurchases', 'Bought on this receipt')}
                value={`${amount(plan.purchases)} DA`}
              />
              {plan.returns > 0 && (
                <SummaryRow
                  label={t('salesHistory.editReturns', 'Taken back from the customer')}
                  value={`-${amount(plan.returns)} DA`}
                  tone="danger"
                />
              )}
              <SummaryRow
                label={t('salesHistory.editNewSubtotal', 'New Subtotal')}
                value={`${amount(plan.subtotal)} DA`}
              />
              {concessionsTotal > 0 && (
                <SummaryRow
                  label={t('salesHistory.editLineDiscounts', 'Given away on lines')}
                  value={`-${amount(Math.round(concessionsTotal))} DA`}
                  tone="danger"
                />
              )}
              {plan.discountAmount > 0 && (
                <SummaryRow
                  label={t('salesHistory.editDiscount', 'Discount Applied')}
                  value={`-${amount(plan.discountAmount)} DA`}
                  tone="danger"
                />
              )}
              <SummaryRow
                label={t('salesHistory.editNewTotal', 'New Total')}
                value={`${amount(plan.total)} DA`}
                strong
              />
              {plan.surplusOwedToCustomer && (
                <Text style={styles.surplusNote}>
                  {t(
                    'salesHistory.editSurplusNote',
                    'This cannot be saved — the receipt would leave the shop owing the customer. Bring the lines level, or void the sale and ring the exchange at the counter.'
                  )}
                </Text>
              )}
              {plan.refundDue > 0 && (
                <SummaryRow
                  label={t('salesHistory.editRefundDue', 'Refund Due to Client')}
                  value={`${amount(plan.refundDue)} DA`}
                  tone="danger"
                  strong
                />
              )}
              {plan.additionalDue > 0 && (
                <SummaryRow
                  label={t('salesHistory.editAdditionalDue', 'Additional Payment Due')}
                  value={`+${amount(plan.additionalDue)} DA`}
                  tone="success"
                  strong
                />
              )}
              {plan.status !== 'completed' && plan.status !== transaction.status && (
                <Text style={styles.statusNote}>
                  {t('salesHistory.editStatusNote', 'The sale will be marked {{status}}.', {
                    status: statusLabel(plan.status),
                  })}
                </Text>
              )}
            </View>

            {plan.hasChanges && (
              <View style={styles.warning}>
                <MaterialCommunityIcons name="alert-outline" size={16} color={colors.warningInk} />
                <Text style={styles.warningText}>
                  {t('salesHistory.editWarning', 'Saving will adjust the transaction prices, totals, and modify inventory stock as selected above.')}
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Button mode="outlined" onPress={onClose} disabled={isSaving} style={styles.footerBtn}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              mode="contained"
              onPress={handleSave}
              disabled={!plan.hasChanges || isSaving || plan.surplusOwedToCustomer}
              loading={isSaving}
              style={styles.footerBtn}
            >
              {user?.role === 'admin'
                ? saveLabel
                : t('salesHistory.editAskAdmin', 'Ask an admin to approve')}
            </Button>
          </View>
        </View>
      </View>

      <Modal visible={isPicking} animationType="slide" transparent onRequestClose={() => setIsPicking(false)}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={() => setIsPicking(false)} />
          <View style={[styles.sheet, styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.header}>
              <MaterialCommunityIcons name="cart-plus" size={24} color={colors.brand} />
              <View style={styles.headerText}>
                <Text style={styles.title}>{t('salesHistory.pickerTitle', 'Add to this invoice')}</Text>
                <Text style={styles.subtitle}>
                  {t('salesHistory.pickerSubtitle', 'A product with nothing on the shelf cannot join.')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsPicking(false)}
                style={styles.closeBtn}
                accessibilityLabel={t('common.close', 'Close')}
              >
                <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerSearch}>
              <TextInput
                label={t('salesHistory.pickerSearchLabel', 'Search by name, model or code')}
                value={pickQuery}
                onChangeText={setPickQuery}
                mode="outlined"
                dense
                autoCapitalize="none"
                style={styles.pickerInput}
                accessibilityLabel={t('salesHistory.pickerSearchLabel', 'Search by name, model or code')}
              />
            </View>

            <FlatList
              data={pickList}
              keyExtractor={item => item.id}
              style={styles.pickerList}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.pickerEmpty}>
                  {catalogueLoading
                    ? t('salesHistory.pickerLoading', 'Loading the shop’s stock…')
                    : t('salesHistory.pickerEmpty', 'Nothing in the shop matches that.')}
                </Text>
              }
              renderItem={({ item }) => {
                const already = onInvoice.has(item.id) || addedIds.includes(item.id);
                const shelf = Math.max(0, Number(item.stock) || 0);
                // The catalogue's own count only writes the caption. A phone that has
                // not opened the POS grid today remembers an empty box that the counter
                // has since refilled, so the tap reads the shelf and that read decides —
                // a stale cache must not refuse a sale the shop can cover.
                return (
                  <TouchableOpacity
                    style={[styles.pickRow, already && styles.pickRowOff]}
                    onPress={() => void pickProduct(item)}
                    disabled={already || isReadingShelf}
                  >
                    <View style={styles.pickText}>
                      <Text style={styles.pickName} numberOfLines={1}>
                        {item.name || item.model || item.id}
                      </Text>
                      <Text style={styles.pickSub} numberOfLines={1}>
                        {already
                          ? t('salesHistory.pickerOnInvoice', 'Already on this invoice — change its own quantity')
                          : shelf <= 0
                            ? t('salesHistory.pickerNoStock', 'Nothing on the shelf')
                            : t('salesHistory.pickerShelf', '{{count}} on the shelf', { count: shelf })}
                      </Text>
                    </View>
                    <Text style={styles.pickPrice}>{amount(listedPrice(item))} DA</Text>
                  </TouchableOpacity>
                );
              }}
            />

            <View style={styles.footer}>
              <Button mode="contained" onPress={() => setIsPicking(false)} style={styles.footerBtn}>
                {t('salesHistory.pickerBack', 'Back to the invoice')}
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      <AdminApprovalSheet
        visible={isAsking}
        payload={approvalPayload}
        lines={[
          t('salesHistory.editApprovalLineTotal', 'Invoice #{{invoice}}: {{from}} DA becomes {{to}} DA', {
            invoice: invoiceLabel,
            from: amount(transaction.total),
            to: amount(plan.total),
          }),
          // The depth of each giveaway, not only the dinars: 900 DA off a small line is
          // a different decision from 900 DA off a phone.
          ...deepConcessions.slice(0, 3).map(
            line =>
              t('salesHistory.editApprovalLineDiscount', 'Discount on {{name}}: −{{percent}}% ({{dinars}} DA)', {
                name: line.name,
                percent: line.percent.toFixed(1),
                dinars: amount(Math.round(line.granted)),
              })
          ),
          ...changes.slice(0, 6).map(change => {
            if (change.kind === 'add') {
              return t('salesHistory.editApprovalLineAdd', '{{name}}: new line, {{qty}} × {{price}} DA', {
                name: change.name,
                qty: change.quantity,
                price: amount(change.unitPrice),
              });
            }
            return change.kind === 'quantity'
              ? t('salesHistory.editApprovalLineQty', '{{name}}: he leaves with {{from}} → {{to}} units', {
                  name: change.name,
                  from: change.from,
                  to: change.to,
                })
              : t('salesHistory.editApprovalLinePrice', '{{name}}: {{from}} DA → {{to}} DA', {
                  name: change.name,
                  from: amount(change.from),
                  to: amount(change.to),
                });
          }),
          t('salesHistory.editApprovalLineStock', 'Stock: {{back}} unit(s) back, {{out}} unit(s) out', {
            back: plan.restock.reduce((sum, l) => sum + l.quantity, 0),
            out: plan.deduct.reduce((sum, l) => sum + l.quantity, 0),
          }),
        ]}
        onApproved={() => void commit()}
        onDismiss={() => setIsAsking(false)}
      />
    </Modal>
  );
};

const SummaryRow = ({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'danger' | 'success';
}) => (
  <View style={styles.summaryRow}>
    <Text style={[styles.summaryLabel, strong && styles.summaryStrong]}>{label}</Text>
    <Text
      style={[
        styles.summaryValue,
        strong && styles.summaryStrong,
        tone === 'danger' && styles.summaryDanger,
        tone === 'success' && styles.summarySuccess,
      ]}
    >
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  headerText: { flex: 1 },
  title: { fontSize: fontSize.subtitle, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.caption, color: colors.textSecondary, marginTop: spacing.xxs },
  closeBtn: { padding: spacing.xs },
  body: { maxHeight: 520 },
  bodyContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  hint: { fontSize: fontSize.body, color: colors.textSecondary },
  line: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  lineHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  lineHeadText: { flex: 1, gap: 1 },
  lineName: { fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.textPrimary },
  lineSub: { fontSize: fontSize.caption, color: colors.textMuted },
  /** The units this SKU's row carries back off the invoice — the same red the receipt
      draws a `−` line in. */
  lineReturned: { fontSize: fontSize.caption, color: colors.dangerText, fontWeight: '600' },
  lineTotal: { fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.textPrimary },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  stepBtn: { padding: spacing.xs },
  stepBtnOff: { opacity: 0.4 },
  stepValue: { minWidth: 42, textAlign: 'center', fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.textPrimary },
  stepCaption: { minWidth: 42, textAlign: 'center', fontSize: fontSize.micro, color: colors.textMuted },
  priceInput: { flex: 1, minHeight: 44 },
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  discountInput: { flex: 1, minHeight: 44 },
  discountPercent: { minWidth: 58, fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.dangerText },
  discountOver: { color: colors.warningInk },
  discountNote: { fontSize: fontSize.caption, color: colors.warningInk },
  restockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  restockText: { flex: 1, fontSize: fontSize.label },
  restockYes: { color: colors.success, fontWeight: '700' },
  restockNo: { color: colors.dangerText, fontWeight: '600' },
  addedNote: { fontSize: fontSize.caption, color: colors.dangerText, fontWeight: '600' },
  removeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  removeRowText: { fontSize: fontSize.caption, color: colors.dangerText, fontWeight: '600' },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.brand,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  addRowText: { fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.brand },
  /** Tall enough to browse, but never taller than the phone it is on. */
  pickerSheet: { height: 540, maxHeight: '82%' },
  pickerSearch: { paddingHorizontal: spacing.lg },
  pickerInput: { minHeight: 44 },
  pickerList: { flex: 1, paddingHorizontal: spacing.lg },
  pickerEmpty: {
    paddingVertical: spacing.xl,
    textAlign: 'center',
    fontSize: fontSize.body,
    color: colors.textMuted,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickRowOff: { opacity: 0.45 },
  pickText: { flex: 1, gap: 1 },
  pickName: { fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.textPrimary },
  pickSub: { fontSize: fontSize.caption, color: colors.textMuted },
  pickPrice: { fontSize: fontSize.body, fontWeight: '700', color: colors.textPrimary },
  ceilingNote: { fontSize: fontSize.caption, color: colors.textMuted, fontStyle: 'italic' },
  unitsNote: { fontSize: fontSize.caption, color: colors.textMuted, fontWeight: '600' },
  summary: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: fontSize.body, color: colors.textSecondary },
  summaryValue: { fontSize: fontSize.body, color: colors.textPrimary },
  summaryStrong: { fontWeight: '700', fontSize: fontSize.bodyStrong },
  summaryDanger: { color: colors.danger },
  summarySuccess: { color: colors.success },
  statusNote: { fontSize: fontSize.caption, color: colors.warningText, marginTop: spacing.xxs },
  surplusNote: {
    fontSize: fontSize.caption,
    color: colors.danger,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  warningText: { flex: 1, fontSize: fontSize.caption, color: colors.warningInk },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerBtn: { flex: 1 },
});
