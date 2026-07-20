import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOrderHistoryPage } from '../../src/parsing/orders';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'orders', 'order-history-2023-10.html');
const html = fs.readFileSync(FIXTURE, 'utf-8');
const BASE_URL = 'https://www.amazon.com';

describe('parseOrderHistoryPage', () => {
  it('parses order number, placed date, total and item titles from a real order-history page', () => {
    const { orders } = parseOrderHistoryPage(html, BASE_URL);

    expect(orders.length).toBeGreaterThan(0);

    const first = orders[0];
    expect(first).toMatchObject({
      orderNumber: '112-0069846-3887437',
      orderPlacedDate: '2023-12-14',
      grandTotal: 72.75,
      cancelled: false,
      skipped: false,
    });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      title: 'SpaGuard Spa Chlorinating Concentrate - 5 Lb',
      asin: 'B006MHSCMI',
    });
    expect(first.items[0].link).toContain('/gp/product/B006MHSCMI/');
  });

  it('every parsed order has an order number and a valid placed date', () => {
    const { orders } = parseOrderHistoryPage(html, BASE_URL);

    for (const order of orders) {
      if (order.cancelled) continue;
      expect(order.orderNumber).toMatch(/^\d{3}-\d{7}-\d{7}$/);
      expect(order.orderPlacedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
