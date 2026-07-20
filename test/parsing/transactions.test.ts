import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTransactionsPage } from '../../src/parsing/transactions';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'transactions');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf-8');

describe('parseTransactionsPage', () => {
  it('parses grouped date/transaction sections and pagination data from a real amazon.ca page', () => {
    const { transactions, nextPageData } = parseTransactionsPage(read('transaction-form-tag.html'));

    expect(transactions).toHaveLength(2);

    expect(transactions[0]).toMatchObject({
      completedDate: '2024-10-11',
      paymentMethod: 'Visa ****1234',
      paymentMethodLast4: '1234',
      grandTotal: -45.19,
      isRefund: false,
      orderNumber: '123-4567890-1234567',
      seller: null,
    });
    expect(transactions[0].orderDetailsLink).toContain('orderID=123-4567890-1234567');

    expect(transactions[1]).toMatchObject({
      completedDate: '2024-10-09',
      paymentMethod: 'Mastercard ****1234',
      paymentMethodLast4: '1234',
      grandTotal: -28.79,
      isRefund: false,
      orderNumber: '123-4567890-1234567',
    });

    // The fixture's Next Page button carries the widget state/ie fields needed to fetch page 2.
    expect(nextPageData).not.toBeNull();
    expect(nextPageData!['ppw-widgetState']).toBe('the-ppw-widgetState');
    expect(nextPageData!.ie).toBe('UTF-8');
  });

  it('returns an empty list (no error) when the account has zero transactions', () => {
    const { transactions, nextPageData } = parseTransactionsPage(read('transactions-zero-transactions.html'));

    expect(transactions).toEqual([]);
    expect(nextPageData).toBeNull();
  });
});
