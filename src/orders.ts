import type { AmazonSession } from './auth/session';
import { parseOrderHistoryPage, parseOrderDetailsPage } from './parsing/orders';
import type { Order } from './parsing/types';
import { AmazonOrdersError } from './errors';

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
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      if (order.skipped || !order.orderNumber) continue;

      const detailsUrl = `${session.constants.ORDER_DETAILS_URL}?orderID=${order.orderNumber}`;
      const detailsPage = await session.get(detailsUrl);
      session.checkResponse(detailsPage, { index: order.index });

      orders[i] = {
        ...parseOrderDetailsPage(detailsPage.html, session.constants.BASE_URL, order.orderNumber),
        index: order.index,
      };
    }
  }

  return orders;
}
