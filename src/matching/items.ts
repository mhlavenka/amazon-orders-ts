import type { AmazonOrderRef } from './types';

export function itemTitlesForOrder(orders: AmazonOrderRef[], orderNumber: string | null): string[] {
  if (!orderNumber) return [];
  return orders.find((o) => o.orderNumber === orderNumber)?.items.map((i) => i.title) ?? [];
}
