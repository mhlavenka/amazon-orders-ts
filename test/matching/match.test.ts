import { describe, expect, it } from 'vitest';
import { matchTransactions } from '../../src/matching/match';
import type { AmazonTransaction, BankTransaction } from '../../src/matching/types';

function bank(overrides: Partial<BankTransaction> & Pick<BankTransaction, 'id' | 'date' | 'amount'>): BankTransaction {
  return { description: 'AMZN Mktp CA*1A2B3', currency: 'CAD', ...overrides };
}

function amz(overrides: Partial<AmazonTransaction> & Pick<AmazonTransaction, 'id' | 'date' | 'amount'>): AmazonTransaction {
  return { orderNumber: null, ...overrides };
}

describe('matchTransactions', () => {
  it('ignores bank rows that are not Amazon descriptors', () => {
    const bankTxns = [bank({ id: 'b1', date: '2026-06-01', amount: -20, description: 'STARBUCKS #123' })];
    const report = matchTransactions(bankTxns, []);

    expect(report.unmatchedBank).toEqual([]);
    expect(report.matches).toEqual([]);
  });

  it('matches a single exact amount+date candidate with high confidence', () => {
    const bankTxns = [bank({ id: 'b1', date: '2026-06-05', amount: -45.19 })];
    const amazonTxns = [amz({ id: 'a1', date: '2026-06-04', amount: -45.19, orderNumber: '123-4567890-1234567' })];

    const report = matchTransactions(bankTxns, amazonTxns);

    expect(report.matches).toEqual([{ bankTxnId: 'b1', amazonTxnIds: ['a1'], confidence: 'high', pass: 'exact' }]);
    expect(report.unmatchedBank).toEqual([]);
    expect(report.unmatchedAmazon).toEqual([]);
    expect(report.reviewQueue).toEqual([]);
  });

  it('rejects a same-amount candidate outside the date window', () => {
    const bankTxns = [bank({ id: 'b1', date: '2026-06-05', amount: -45.19 })];
    // 10 days before the bank post date — outside the -1..+4 business day window.
    const amazonTxns = [amz({ id: 'a1', date: '2026-05-26', amount: -45.19 })];

    const report = matchTransactions(bankTxns, amazonTxns);

    expect(report.matches).toEqual([]);
    expect(report.unmatchedBank).toHaveLength(1);
    expect(report.unmatchedAmazon).toHaveLength(1);
  });

  it('ties broken by closest date resolve at medium confidence', () => {
    const bankTxns = [bank({ id: 'b1', date: '2026-06-05', amount: -19.99 })];
    const amazonTxns = [
      amz({ id: 'close', date: '2026-06-04', amount: -19.99 }),
      // Farther away but still inside the -1..+4 business day window (so it's a real tie, not filtered out).
      amz({ id: 'far', date: '2026-06-08', amount: -19.99 }),
    ];

    const report = matchTransactions(bankTxns, amazonTxns);

    expect(report.matches).toEqual([{ bankTxnId: 'b1', amazonTxnIds: ['close'], confidence: 'medium', pass: 'tie-break' }]);
    expect(report.unmatchedAmazon.map((t) => t.id)).toEqual(['far']);
  });

  it('ties at the same date distance broken by an order-number fragment in the descriptor', () => {
    const bankTxns = [
      bank({ id: 'b1', date: '2026-06-05', amount: -19.99, description: 'AMZN Mktp CA*MT8Q34ABC' }),
    ];
    const amazonTxns = [
      amz({ id: 'match', date: '2026-06-04', amount: -19.99, orderNumber: '702-MT8Q34-9990001' }),
      amz({ id: 'other', date: '2026-06-04', amount: -19.99, orderNumber: '702-ZZ9999-9990002' }),
    ];

    const report = matchTransactions(bankTxns, amazonTxns);

    expect(report.matches).toEqual([{ bankTxnId: 'b1', amazonTxnIds: ['match'], confidence: 'medium', pass: 'tie-break' }]);
  });

  it('sends unresolvable ties to the review queue and matches nothing', () => {
    const bankTxns = [bank({ id: 'b1', date: '2026-06-05', amount: -19.99 })];
    const amazonTxns = [
      amz({ id: 'a1', date: '2026-06-04', amount: -19.99 }),
      amz({ id: 'a2', date: '2026-06-04', amount: -19.99 }),
    ];

    const report = matchTransactions(bankTxns, amazonTxns);

    expect(report.matches).toEqual([]);
    expect(report.reviewQueue).toHaveLength(1);
    expect(report.reviewQueue[0].bankTxn.id).toBe('b1');
    expect(report.reviewQueue[0].candidates.map((c) => c.id).sort()).toEqual(['a1', 'a2']);
    // Ambiguous rows are parked in the review queue, not double-counted as unmatched.
    expect(report.unmatchedBank).toEqual([]);
  });

  it('matches a split-shipment combination of same-order Amazon transactions', () => {
    const bankTxns = [bank({ id: 'b1', date: '2026-06-05', amount: -50 })];
    const amazonTxns = [
      amz({ id: 'a1', date: '2026-06-04', amount: -30, orderNumber: '111-1111111-1111111' }),
      amz({ id: 'a2', date: '2026-06-05', amount: -20, orderNumber: '111-1111111-1111111' }),
      // Decoy from a different order, same window, not part of the combination.
      amz({ id: 'a3', date: '2026-06-05', amount: -5, orderNumber: '222-2222222-2222222' }),
    ];

    const report = matchTransactions(bankTxns, amazonTxns);

    expect(report.matches).toEqual([
      { bankTxnId: 'b1', amazonTxnIds: expect.arrayContaining(['a1', 'a2']), confidence: 'medium', pass: 'combination' },
    ]);
    expect(report.matches[0].amazonTxnIds).toHaveLength(2);
    expect(report.unmatchedAmazon.map((t) => t.id)).toEqual(['a3']);
  });

  it('does not combine more than 3 Amazon transactions', () => {
    const bankTxns = [bank({ id: 'b1', date: '2026-06-05', amount: -40 })];
    const amazonTxns = [
      amz({ id: 'a1', date: '2026-06-05', amount: -10, orderNumber: '333-3333333-3333333' }),
      amz({ id: 'a2', date: '2026-06-05', amount: -10, orderNumber: '333-3333333-3333333' }),
      amz({ id: 'a3', date: '2026-06-05', amount: -10, orderNumber: '333-3333333-3333333' }),
      amz({ id: 'a4', date: '2026-06-05', amount: -10, orderNumber: '333-3333333-3333333' }),
    ];

    const report = matchTransactions(bankTxns, amazonTxns);

    expect(report.matches).toEqual([]);
    expect(report.unmatchedBank).toHaveLength(1);
    expect(report.unmatchedAmazon).toHaveLength(4);
  });

  it('leaves unconsumed Amazon transactions as unmatched (possible gift-card payments)', () => {
    const amazonTxns = [amz({ id: 'a1', date: '2026-06-05', amount: -12.34, orderNumber: '444-4444444-4444444' })];

    const report = matchTransactions([], amazonTxns);

    expect(report.unmatchedAmazon).toEqual(amazonTxns);
  });

  it('is deterministic across repeated runs on the same input (idempotency precondition)', () => {
    const bankTxns = [bank({ id: 'b1', date: '2026-06-05', amount: -45.19 })];
    const amazonTxns = [amz({ id: 'a1', date: '2026-06-04', amount: -45.19 })];

    const first = matchTransactions(bankTxns, amazonTxns);
    const second = matchTransactions(bankTxns, amazonTxns);

    expect(second).toEqual(first);
  });

  it('respects a custom Amazon descriptor pattern list', () => {
    const bankTxns = [bank({ id: 'b1', date: '2026-06-05', amount: -45.19, description: 'MY-CUSTOM-DESCRIPTOR' })];
    const amazonTxns = [amz({ id: 'a1', date: '2026-06-04', amount: -45.19 })];

    const withoutCustomPattern = matchTransactions(bankTxns, amazonTxns);
    expect(withoutCustomPattern.matches).toEqual([]);

    const withCustomPattern = matchTransactions(bankTxns, amazonTxns, {
      amazonDescriptorPatterns: [/MY-CUSTOM-DESCRIPTOR/],
    });
    expect(withCustomPattern.matches).toHaveLength(1);
  });
});
