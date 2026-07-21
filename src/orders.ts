import type { AmazonSession } from './auth/session';
import { parseOrderHistoryPage, parseOrderDetailsPage } from './parsing/orders';
import type { Order } from './parsing/types';
import { AmazonOrdersError, AmazonOrdersAuthRedirectError } from './errors';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface OrderHistoryOptions {
  /** "last30" | "months-3" | "year-YYYY". Takes precedence over `year` if both are given. */
  timeFilter?: string;
  /** Defaults to the current year when neither this nor `timeFilter` is given. */
  year?: number;
  /** Fetch each order's details page too (order number + items only — see NOTICE for scope). Slower: one extra request per order. */
  fullDetails?: boolean;
  /** Set false to fetch only the first page. */
  keepPaging?: boolean;
}

/**
 * Fetches one order's own details page (order number, placed date, grand total, items) directly,
 * given its order number — for a caller that already knows which specific order(s) it needs (e.g.
 * after matching bank transactions against cheap list-page order data) rather than every order in
 * a whole period. Throws same as any other request; callers wanting the fullDetails loop's
 * softer "stop on auth-redirect, keep what you have" behavior should replicate that themselves.
 */
export async function getOrderDetails(session: AmazonSession, orderNumber: string): Promise<Order> {
  if (!session.isAuthenticated) throw new AmazonOrdersError('Call session.login() to authenticate first.');
  const detailsUrl = `${session.constants.ORDER_DETAILS_URL}?orderID=${orderNumber}`;
  const detailsPage = await session.get(detailsUrl);
  session.checkResponse(detailsPage);
  return parseOrderDetailsPage(detailsPage.html, session.constants.BASE_URL, orderNumber);
}

/**
 * Fetches details for a specific, known set of order numbers — not every order in a period. Use
 * this (rather than `getOrderHistory({ fullDetails: true })`) whenever the caller already knows
 * exactly which orders it needs (e.g. after matching bank transactions against cheap list-page
 * order data): fetching every order's details to service one or two matched rows is wasteful and,
 * for an account with dozens of orders, can turn a single-row lookup into minutes. Paced the same
 * way as `getOrderHistory`'s fullDetails loop, and stops (keeping what it has) rather than throws
 * if Amazon bounces the session mid-batch.
 */
export async function getOrderDetailsBatch(session: AmazonSession, orderNumbers: string[]): Promise<Map<string, Order>> {
  const results = new Map<string, Order>();
  for (let i = 0; i < orderNumbers.length; i++) {
    try {
      results.set(orderNumbers[i], await getOrderDetails(session, orderNumbers[i]));
    } catch (err) {
      if (err instanceof AmazonOrdersAuthRedirectError) break;
      throw err;
    }
    if (i < orderNumbers.length - 1) await sleep(300 + Math.random() * 500);
  }
  return results;
}

/** Fetches order history (order number, placed date, grand total, items) for a given period. */
export async function getOrderHistory(session: AmazonSession, options: OrderHistoryOptions = {}): Promise<Order[]> {
  if (!session.isAuthenticated) throw new AmazonOrdersError('Call session.login() to authenticate first.');
  if (options.timeFilter && options.year) {
    throw new AmazonOrdersError("Only one of 'year' or 'timeFilter' may be used at a time.");
  }

  const filterValue = options.timeFilter ?? `year-${options.year ?? new Date().getFullYear()}`;
  const keepPaging = options.keepPaging ?? true;
  let nextUrl: string | null =
    `${session.constants.ORDER_HISTORY_URL}?${session.constants.HISTORY_FILTER_QUERY_PARAM}=` +
    encodeURIComponent(filterValue);

  const orders: Order[] = [];
  let startIndex = 0;

  while (nextUrl) {
    const page = await session.get(nextUrl);
    session.checkResponse(page, { index: startIndex });

    const { orders: pageOrders, nextPageUrl } = parseOrderHistoryPage(page.html, session.constants.BASE_URL, startIndex);
    orders.push(...pageOrders);
    startIndex += pageOrders.length;

    nextUrl = keepPaging ? nextPageUrl : null;
  }

  if (options.fullDetails) {
    const eligible = orders.filter((o) => !o.skipped && o.orderNumber);
    const details = await getOrderDetailsBatch(session, eligible.map((o) => o.orderNumber!));
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const detail = order.orderNumber ? details.get(order.orderNumber) : undefined;
      if (detail) orders[i] = { ...detail, index: order.index };
    }
  }

  return orders;
}
