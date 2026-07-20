import type { AnyNode } from 'domhandler';
import { parseHtml, select, selectOne, toCurrency, type Root } from '../html';
import * as sel from '../auth/selectors';
import { simpleParse, required, withBaseUrl as resolveUrl } from './parsable';
import { AmazonOrdersParseError } from '../errors';
import type { Item, Order } from './types';

const MONTH_NAMES =
  'January|February|March|April|May|June|July|August|September|October|November|December';
const LOOSE_DATE_RE = new RegExp(`(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s+(\\d{4})`);

/**
 * Amazon's order-placed date is rendered alongside a "Order placed" label with no reliable
 * separator, so (like amazon-orders' fuzzy dateutil parse) we pull the first recognizable
 * "Month D, YYYY" substring out of the combined text rather than parsing it whole.
 */
function extractLooseDate(text: string): string | null {
  const match = LOOSE_DATE_RE.exec(text);
  if (!match) return null;
  const d = new Date(`${match[1]} ${match[2]}, ${match[3]}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseAsin(link: string | null): string | null {
  if (!link) return null;
  const match = /\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?]|$)/.exec(link);
  return match ? match[1] : null;
}

function parseItem($: Root, el: AnyNode, baseUrl: string): Item {
  const title = required(
    simpleParse($, el, sel.FIELD_ITEM_TITLE_SELECTORS) as string | null,
    'Item.title',
  ) as string;
  const link = simpleParse($, el, sel.FIELD_ITEM_LINK_SELECTORS, { attrName: 'href' }) as string | null;
  const resolvedLink = link ? resolveUrl(link, baseUrl) : null;
  const price = toCurrency(simpleParse($, el, sel.FIELD_ITEM_PRICE_SELECTORS) as string | null);
  const quantityRaw = simpleParse($, el, sel.FIELD_ITEM_QUANTITY_SELECTORS);

  return {
    title: title.trim(),
    asin: parseAsin(resolvedLink),
    link: resolvedLink,
    price,
    quantity: typeof quantityRaw === 'number' ? quantityRaw : null,
  };
}

function parseOrderNumber(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const hash = trimmed.indexOf('#');
  return hash === -1 ? trimmed : trimmed.slice(hash + 1).trim();
}

interface ParseOrderOptions {
  baseUrl: string;
  index?: number;
  /** Used when the order number can't be parsed from the page (e.g. a cancelled order). */
  orderNumberFallback?: string;
}

function parseOrderTag($: Root, el: AnyNode, opts: ParseOrderOptions): Order {
  const cancelled = select($, el, sel.ORDER_SKIP_TOTALS).length > 0;
  const skipped = select($, el, sel.ORDER_SKIP_ITEMS).length > 0;

  const orderNumberText = simpleParse($, el, sel.FIELD_ORDER_NUMBER_SELECTORS) as string | null;
  let orderNumber = parseOrderNumber(orderNumberText);
  if (!orderNumber && opts.orderNumberFallback) orderNumber = opts.orderNumberFallback;
  if (!orderNumber && !cancelled) {
    throw new AmazonOrdersParseError(
      'Order.orderNumber could not be parsed — the expected selector did not match. Amazon likely changed the HTML.',
      { field: 'Order.orderNumber', index: opts.index },
    );
  }

  const placedDateText = simpleParse($, el, sel.FIELD_ORDER_PLACED_DATE_SELECTORS) as string | null;
  const orderPlacedDate = placedDateText ? extractLooseDate(placedDateText) : null;

  let grandTotal: number | null = null;
  if (!cancelled && !skipped) {
    const rawTotal = simpleParse($, el, sel.FIELD_ORDER_GRAND_TOTAL_SELECTORS) as string | null;
    grandTotal = toCurrency(rawTotal?.toLowerCase().startsWith('total') ? rawTotal.slice(5).trim() : rawTotal);
  }

  const items: Item[] = skipped
    ? []
    : select($, el, sel.ITEM_ENTITY_SELECTORS)
        .toArray()
        .map((itemEl) => parseItem($, itemEl, opts.baseUrl));

  return {
    orderNumber,
    orderPlacedDate,
    grandTotal,
    cancelled,
    skipped,
    items,
    index: opts.index,
  };
}

export interface OrderHistoryPageResult {
  orders: Order[];
  /** Absolute URL of the next history page, or null if this was the last page. */
  nextPageUrl: string | null;
}

/** Parses one page of the order-history listing (order number, date, total, items — no full details). */
export function parseOrderHistoryPage(html: string, baseUrl: string, startIndex = 0): OrderHistoryPageResult {
  const $ = parseHtml(html);
  const root = $.root().get(0)!;
  const orderTags = select($, root, sel.ORDER_HISTORY_ENTITY_SELECTORS).toArray();

  if (!orderTags.length) {
    const countTag = selectOne($, root, sel.ORDER_HISTORY_COUNT_SELECTOR);
    const count = countTag ? parseInt(countTag.text().trim().split(' ')[0] ?? '0', 10) : 0;
    if (countTag && count <= startIndex) {
      return { orders: [], nextPageUrl: null };
    }
    throw new AmazonOrdersParseError(
      'Could not parse order history — no order cards found. Check if Amazon changed the HTML.',
    );
  }

  const orders = orderTags.map((tag, i) => parseOrderTag($, tag, { baseUrl, index: startIndex + i }));

  const nextTag = selectOne($, root, sel.NEXT_PAGE_LINK_SELECTOR);
  const nextHref = nextTag?.attr('href') ?? null;
  const nextPageUrl = nextHref ? resolveUrl(nextHref, baseUrl) : null;

  return { orders, nextPageUrl };
}

/** Parses a single order's details page. Only order number/date/total/items are extracted (see NOTICE/README for scope). */
export function parseOrderDetailsPage(html: string, baseUrl: string, orderNumberFallback: string): Order {
  const $ = parseHtml(html);
  const root = $.root().get(0)!;
  const detailsTag = selectOne($, root, sel.ORDER_DETAILS_ENTITY_SELECTORS);

  if (!detailsTag) {
    throw new AmazonOrdersParseError(
      `Could not parse details for Order ${orderNumberFallback}. Check if Amazon changed the HTML.`,
    );
  }

  return parseOrderTag($, detailsTag.get(0)!, { baseUrl, orderNumberFallback });
}
