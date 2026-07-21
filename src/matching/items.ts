import type { AmazonOrderRef } from './types';

export function itemTitlesForOrder(orders: AmazonOrderRef[], orderNumber: string | null): string[] {
  return itemsForOrder(orders, orderNumber).map((i) => i.title);
}

/** Full item refs (title + asin/link, when known) for a given order number. */
export function itemsForOrder(orders: AmazonOrderRef[], orderNumber: string | null): AmazonOrderRef['items'] {
  if (!orderNumber) return [];
  return orders.find((o) => o.orderNumber === orderNumber)?.items ?? [];
}
