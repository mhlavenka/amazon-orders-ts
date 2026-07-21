import { describe, expect, it } from 'vitest';
import { findAmazonMatchForTransaction } from '../../src/matching/lookup';
import type { AmazonOrderRef, AmazonTransaction, BankTransaction } from '../../src/matching/types';

const orders: AmazonOrderRef[] = [
  { orderNumber: '111-1111111-1111111', items: [{ title: 'USB-C Cable' }, { title: 'Kitchen Sponges' }] },
  { orderNumber: '222-2222222-2222222', items: [{ title: 'Desk Lamp' }] },
];

function bank(overrides: Partial<BankTransaction> & Pick<BankTransaction, 'id' | 'date' | 'amount'>): BankTransaction {
  return { description: 'AMZN Mktp CA*1A2B3', currency: 'CAD', ...overrides };
}

describe('findAmazonMatchForTransaction', () => {
  it('resolves a matched purchase with item titles and isRefund=false', () => {
    const bankTxn = bank({ id: 'b1', date: '2026-06-05', amount: -19.99 });
    const amazonTxns: AmazonTransaction[] = [
      { id: 'a1', date: '2026-06-04', amount: -19.99, orderNumber: '111-1111111-1111111' },
    ];

    const result = findAmazonMatchForTransaction(bankTxn, amazonTxns, orders);

    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.pass).toBe('exact');
    expect(result.isRefund).toBe(false);
    expect(result.orderNumbers).toEqual(['111-1111111-1111111']);
    expect(result.items).toEqual(['USB-C Cable', 'Kitchen Sponges']);
  });

  it('flags a matched refund (positive amount) as isRefund=true', () => {
    const bankTxn = bank({ id: 'b1', date: '2026-06-05', amount: 19.99 });
    const amazonTxns: AmazonTransaction[] = [
      { id: 'a1', date: '2026-06-04', amount: 19.99, orderNumber: '111-1111111-1111111' },
    ];

    const result = findAmazonMatchForTransaction(bankTxn, amazonTxns, orders);

    expect(result.matched).toBe(true);
    expect(result.isRefund).toBe(true);
  });

  it('returns matched=false with no candidates when nothing lines up', () => {
    const bankTxn = bank({ id: 'b1', date: '2026-06-05', amount: -19.99 });
    const result = findAmazonMatchForTransaction(bankTxn, [], orders);

    expect(result).toEqual({ matched: false, amazonTxnIds: [], orderNumbers: [], items: [], matchedItems: [] });
  });

  it('surfaces ambiguous candidates instead of guessing', () => {
    const bankTxn = bank({ id: 'b1', date: '2026-06-05', amount: -19.99 });
    const amazonTxns: AmazonTransaction[] = [
      { id: 'a1', date: '2026-06-04', amount: -19.99, orderNumber: '111-1111111-1111111' },
      { id: 'a2', date: '2026-06-04', amount: -19.99, orderNumber: '222-2222222-2222222' },
    ];

    const result = findAmazonMatchForTransaction(bankTxn, amazonTxns, orders);

    expect(result.matched).toBe(false);
    expect(result.ambiguousCandidates?.map((c) => c.id).sort()).toEqual(['a1', 'a2']);
  });

  it('ignores bank rows that are not Amazon descriptors', () => {
    const bankTxn = bank({ id: 'b1', date: '2026-06-05', amount: -19.99, description: 'STARBUCKS' });
    const amazonTxns: AmazonTransaction[] = [{ id: 'a1', date: '2026-06-04', amount: -19.99, orderNumber: null }];

    const result = findAmazonMatchForTransaction(bankTxn, amazonTxns, orders);

    expect(result.matched).toBe(false);
  });
});
