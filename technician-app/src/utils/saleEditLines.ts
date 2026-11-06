/**
 * The lines a corrected invoice actually carries.
 * ==============================================
 * Bringing a line down to zero used to delete it: the document lost the product, the
 * money and every trace of what happened, and a fully refunded sale showed as a blank
 * sheet. A correction is a credit note, not an eraser — what was sold stays on the
 * document at what it was sold for, and the units that come back join it as their own
 * negative line. The net money is identical to the old behaviour, because the basket
 * already prices a return line by subtracting it (`planSaleEdit`), so no sum anywhere
 * has to learn about signs.
 *
 * The control a line editor holds is therefore **the units the customer leaves with**,
 * not the quantity written on the sold line. One control per SKU, which is the rule the
 * counter enforces: a document that carries the same model as a sale row and as a return
 * row has them folded into one number, and the saved document is rebuilt from it — so an
 * already-corrected invoice can be corrected again without the two rows fighting over
 * one input.
 *
 * Quantities stay positive everywhere and the sign lives in `isReturn`. Writing a
 * literal `-1` into `quantity` would flip twice on the way through the subtraction that
 * prices returns, and every "units sold" sum on either terminal reads that field.
 *
 * This is a copy of the counter terminal's `src/utils/saleEditLines.ts`. A rule that
 * changes here has to change there.
 */
import type { CartItem, PhoneModel } from '../types/index.ts';

/** What one SKU's control holds: what the customer keeps, and what it costs him. */
export interface KeptLine {
  quantity: number;
  unitPrice: number;
}

/** Keyed by `product.id`, as both editors already key their edit state. */
export type KeptLines = Record<string, KeptLine>;

/** One SKU as the editor sees it: what was sold, what came back, what he keeps. */
export interface SkuLineView {
  productId: string;
  name: string;
  product: PhoneModel;
  /** Units the document sold. A correction never rewrites this number. */
  sold: number;
  /** Units the document already carries back, from an earlier correction or an exchange. */
  returned: number;
  /** What he leaves with on the document as it stands — the number the control starts on. */
  kept: number;
  /** The price the sold line carries, before any concession was folded into it. */
  listedUnit: number;
}

const wholeUnits = (value: number, fallback = 0): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const money = (value: number, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const isReturnLine = (item: CartItem): boolean => Boolean(item?.isReturn);

/** What the shop charges for one unit of this line — the corrected price once edited. */
export const lineUnit = (item: CartItem): number =>
  money(item?.unitPrice ?? item?.product?.price ?? 0);

/** What the shop pays back for one unit it took. A line handed over in trade is not
 *  priced by what the shelf still asks for it, so the till's buy-back number wins. */
export const creditUnit = (item: CartItem): number =>
  typeof item?.customReturnPrice === 'number' && Number.isFinite(item.customReturnPrice)
    ? money(item.customReturnPrice)
    : lineUnit(item);

/** The line's money with its sign: negative for a line that came back off the invoice. */
export const signedLineTotal = (item: CartItem): number => {
  const total = (isReturnLine(item) ? creditUnit(item) : lineUnit(item)) * wholeUnits(item?.quantity);
  return isReturnLine(item) ? -total : total;
};

export const soldUnits = (items: CartItem[]): number =>
  items.reduce((sum, item) => (isReturnLine(item) ? sum : sum + wholeUnits(item?.quantity)), 0);

export const returnedUnits = (items: CartItem[]): number =>
  items.reduce((sum, item) => (isReturnLine(item) ? sum + wholeUnits(item?.quantity) : sum), 0);

/** The units the shop actually let go. A unit that came back off the invoice was not
 *  sold, and every money figure beside it already nets it out — a count that ignored
 *  the credit line would disagree with the day it prints next to. */
export const netUnitsSold = (items: CartItem[]): number => soldUnits(items) - returnedUnits(items);

/** What one line cost the shop, signed the way the shelf moved: a unit that came back
 *  restocked takes its cost back with it, and a unit written off rather than put on the
 *  shelf keeps its cost on the day — the goods are gone and the day should say so. */
export const netLineCost = (item: CartItem): number => {
  const cost = (Math.max(0, Number(item?.product?.costPrice) || 0)) * Math.abs(Number(item?.quantity) || 0);
  if (!isReturnLine(item)) return cost;
  return item?.restock === false ? 0 : -cost;
};

/** What a document's lines cost, net of the units that came back to the shelf. A credit
 *  line for goods never sold on this invoice (a trade-in) reduces the cost, which is how
 *  the product breakdown already reads it. */
export const netCogsOf = (items: CartItem[]): number =>
  (items || []).reduce((sum, item) => sum + netLineCost(item), 0);

/** What the lines that came back are worth, as a positive number to be drawn with a minus. */
export const returnedAmount = (items: CartItem[]): number =>
  items.reduce(
    (sum, item) =>
      isReturnLine(item) ? sum + creditUnit(item) * wholeUnits(item?.quantity) : sum,
    0
  );

/** One line as a surface draws it. Numbers stay positive and the sign is the caller's
 *  to place, because the typographic minus a document prints is not a value the shop
 *  can add up. */
export interface LineDisplay {
  returned: boolean;
  units: number;
  unit: number;
  money: number;
}

export const lineDisplayOf = (item: CartItem): LineDisplay => {
  const returned = isReturnLine(item);
  return {
    returned,
    units: wholeUnits(item?.quantity),
    unit: returned ? creditUnit(item) : lineUnit(item),
    money: Math.abs(signedLineTotal(item)),
  };
};

const labelOf = (item: CartItem): string =>
  item?.product?.name || item?.product?.model || 'Item';

/**
 * The document folded into one view per SKU. A row too old or too broken to carry a
 * product id has no shelf to move and no control to own, so it is not represented here
 * — `buildCorrectedLines` carries those through untouched rather than letting them lose
 * their money on the way past a control that cannot reach them.
 */
export const groupDocumentLines = (items: CartItem[]): SkuLineView[] => {
  const views = new Map<string, SkuLineView>();

  items.forEach(item => {
    const product = item?.product;
    const id = product?.id;
    if (!id) return;
    let view = views.get(id);
    if (!view) {
      view = {
        productId: id,
        name: labelOf(item),
        product,
        sold: 0,
        returned: 0,
        kept: 0,
        listedUnit: lineUnit(item),
      };
      views.set(id, view);
    }
    const quantity = wholeUnits(item.quantity);
    if (isReturnLine(item)) view.returned += quantity;
    else {
      // The first sold row is the one the counter quotes a concession against, and it
      // is the list price; a later row of the same SKU may already be discounted.
      if (view.sold === 0) view.listedUnit = lineUnit(item);
      view.sold += quantity;
    }
    view.kept = Math.max(0, view.sold - view.returned);
  });

  return [...views.values()];
};

/** One sold line, priced as the correction prices it, in both fields the app reads. */
const priceSaleLine = (item: CartItem, product: PhoneModel, unitPrice: number): CartItem => {
  const quantity = wholeUnits(item.quantity);
  return {
    ...item,
    quantity,
    product,
    unitPrice,
    totalPrice: Math.round(unitPrice * quantity * 100) / 100,
  };
};

/**
 * The line for units a correction takes back. The credit is priced at what the same
 * document charges for the same product, and kept off the shelf rather than put back
 * on it when the counter says the goods are not saleable.
 */
const creditLine = (
  product: PhoneModel,
  units: number,
  unitPrice: number,
  restock: boolean,
  returnReason?: string
): CartItem => ({
  product,
  quantity: units,
  isReturn: true,
  unitPrice,
  totalPrice: Math.round(unitPrice * units * 100) / 100,
  customReturnPrice: unitPrice,
  restock,
  ...(returnReason ? { returnReason } : {}),
});

/**
 * The corrected line list, in the order it should print: each SKU's sold lines, then
 * the credit lines for whatever came back off them, then the lines the counter added,
 * then anything no control could reach.
 */
export const buildCorrectedLines = (
  documentItems: CartItem[],
  edits: KeptLines,
  restockChoices: Record<string, boolean> = {},
  /** A product the invoice never carried, already shaped by the editor's pick. */
  addedItems: CartItem[] = []
): CartItem[] => {
  const views = groupDocumentLines(documentItems);
  const lines: CartItem[] = [];

  for (const view of views) {
    const edit = edits[view.productId];
    const kept = edit ? wholeUnits(edit.quantity, view.kept) : view.kept;
    const unitPrice = money(edit?.unitPrice, view.listedUnit);
    const priced = { ...view.product, price: unitPrice };
    const priceMoved = edit !== undefined && unitPrice !== view.listedUnit;
    const choice = restockChoices[view.productId];
    /** The checkbox decides when the counter touched it; left alone, a line the
     *  document already wrote off stays written off instead of being restocked. */
    const restockOf = (carried?: CartItem): boolean =>
      choice === undefined ? carried?.restock !== false : choice;

    /** The sold rows keep their documented quantities; only the price rides on them,
     *  because every surface that draws a line reads the price off the line itself. */
    documentItems
      .filter(item => item?.product?.id === view.productId && !isReturnLine(item))
      .forEach(item => lines.push(priceSaleLine(item, priced, unitPrice)));

    // Units beyond what was ever sold are units the till sold at the same moment —
    // one more line, and whether the shelf can give them is the planner's refusal.
    const growth = Math.max(0, kept - view.sold);
    if (growth > 0) {
      lines.push(priceSaleLine({ product: priced, quantity: growth }, priced, unitPrice));
    }

    /**
     * What comes back is re-derived from one number, so correcting the same invoice
     * twice cannot stack a second credit line on the first. The document's own credit
     * rows split two ways: units covering a sold line are corrections of this invoice,
     * and units past the sold count are goods handed over in trade — priced by what
     * the counter agreed to pay for them, not by what the shelf still asks — so those
     * ride through on their own terms.
     */
    const corrections: { line: CartItem; units: number }[] = [];
    const tradedIn: CartItem[] = [];
    let rebasable = view.sold;
    documentItems
      .filter(item => item?.product?.id === view.productId && isReturnLine(item))
      .forEach(item => {
        const quantity = wholeUnits(item.quantity);
        const coversSoldLine = Math.min(quantity, rebasable);
        rebasable -= coversSoldLine;
        if (coversSoldLine > 0) corrections.push({ line: item, units: coversSoldLine });
        if (quantity > coversSoldLine) {
          tradedIn.push({ ...item, quantity: quantity - coversSoldLine });
        }
      });

    const takenBack = Math.max(0, view.sold - kept);
    const reason = corrections.find(entry => entry.line.returnReason)?.line.returnReason;
    const credits: CartItem[] = [];

    /**
     * One credit line per price the shop pays for this SKU. A document that already
     * stated a buy-back keeps it — re-quoting a trade-in at what the shelf asks would
     * let a correction that changed nothing still move the money — and a unit taken
     * back beyond what the document credited joins that line at the line price instead
     * of printing the same product twice.
     */
    const addCredit = (line: CartItem) => {
      const previous = credits[credits.length - 1];
      const samePrice =
        previous !== undefined &&
        creditUnit(previous) === creditUnit(line) &&
        Boolean(previous.restock) === Boolean(line.restock);
      if (!samePrice) {
        credits.push(line);
        return;
      }
      const quantity = wholeUnits(previous.quantity) + wholeUnits(line.quantity);
      const unit = creditUnit(previous);
      credits[credits.length - 1] = {
        ...previous,
        quantity,
        unitPrice: unit,
        totalPrice: Math.round(unit * quantity * 100) / 100,
      };
    };

    if (priceMoved || corrections.length === 0) {
      if (takenBack > 0) addCredit(creditLine(priced, takenBack, unitPrice, restockOf(), reason));
    } else {
      let remaining = takenBack;
      corrections.forEach(({ line, units }) => {
        const granted = Math.min(units, remaining);
        remaining -= granted;
        if (granted > 0) addCredit({ ...line, quantity: granted, restock: restockOf(line) });
      });
      if (remaining > 0) addCredit(creditLine(priced, remaining, unitPrice, restockOf(), reason));
    }

    lines.push(...credits, ...tradedIn);
  }

  for (const item of addedItems) {
    const product = item?.product;
    const id = product?.id;
    if (!id) continue;
    const quantity = wholeUnits(item.quantity);
    if (quantity <= 0) continue;
    const unitPrice = money(item.unitPrice ?? product.price, money(product.price));
    lines.push(priceSaleLine(item, { ...product, price: unitPrice }, unitPrice));
  }

  documentItems.forEach(item => {
    if (!item?.product?.id) lines.push(item);
  });

  return lines;
};

/**
 * Whether a rebuilt line list differs from the document's own. Comparing totals is not
 * enough: a price cut and a unit coming back can net to the same number, and the till
 * still has to be allowed to write the document.
 */
export const linesDiffer = (documentItems: CartItem[], corrected: CartItem[]): boolean => {
  const signature = (items: CartItem[]) =>
    items
      .map(item =>
        [
          item?.product?.id || 'none',
          isReturnLine(item) ? 'r' : 's',
          wholeUnits(item?.quantity),
          isReturnLine(item) ? creditUnit(item) : lineUnit(item),
          item?.restock === false ? 'w' : 'k',
        ].join('|')
      )
      .sort()
      .join(';');
  return signature(documentItems) !== signature(corrected);
};
