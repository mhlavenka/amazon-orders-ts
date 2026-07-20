import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MatchStore } from '../../src/matching/store';
import type { AmazonTransaction, MatchResult } from '../../src/matching/types';

describe('MatchStore', () => {
  let dbPath: string;
  let store: MatchStore;

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aots-')), 'matches.sqlite');
    store = new MatchStore(dbPath);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('persists a match and can look it up from either side', () => {
    const matches: MatchResult[] = [{ bankTxnId: 'b1', amazonTxnIds: ['a1'], confidence: 'high', pass: 'exact' }];
    store.saveMatches(matches);

    expect(store.isBankTxnMatched('b1')).toBe(true);
    expect(store.isAmazonTxnMatched('a1')).toBe(true);
    expect(store.isBankTxnMatched('unknown')).toBe(false);
  });

  it('writes one row per Amazon transaction in a combination match', () => {
    const matches: MatchResult[] = [
      { bankTxnId: 'b1', amazonTxnIds: ['a1', 'a2'], confidence: 'medium', pass: 'combination' },
    ];
    store.saveMatches(matches);

    const rows = store.allMatches();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amazonTxnId).sort()).toEqual(['a1', 'a2']);
    expect(rows.every((r) => r.bankTxnId === 'b1')).toBe(true);
  });

  it('re-saving the same matches is idempotent (no duplicate rows, no error)', () => {
    const matches: MatchResult[] = [{ bankTxnId: 'b1', amazonTxnIds: ['a1'], confidence: 'high', pass: 'exact' }];

    store.saveMatches(matches);
    store.saveMatches(matches);
    store.saveMatches(matches);

    expect(store.allMatches()).toHaveLength(1);
  });

  it('upserts confidence/pass when a later run resolves a pair differently', () => {
    store.saveMatches([{ bankTxnId: 'b1', amazonTxnIds: ['a1'], confidence: 'medium', pass: 'tie-break' }]);
    store.saveMatches([{ bankTxnId: 'b1', amazonTxnIds: ['a1'], confidence: 'high', pass: 'exact' }]);

    const rows = store.allMatches();
    expect(rows).toHaveLength(1);
    expect(rows[0].confidence).toBe('high');
    expect(rows[0].pass).toBe('exact');
  });

  it('filterUnconsumed drops Amazon transactions already claimed by a saved match', () => {
    store.saveMatches([{ bankTxnId: 'b1', amazonTxnIds: ['a1'], confidence: 'high', pass: 'exact' }]);

    const pool: AmazonTransaction[] = [
      { id: 'a1', date: '2026-06-01', amount: -10, orderNumber: null },
      { id: 'a2', date: '2026-06-02', amount: -20, orderNumber: null },
    ];

    expect(store.filterUnconsumed(pool).map((t) => t.id)).toEqual(['a2']);
  });
});
