import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { AmazonTransaction, Confidence, MatchPass, MatchResult } from './types';

// Loaded via require() rather than a static `import`, because esbuild (used by both this
// project's test runner and some consumers' bundlers) doesn't yet recognize node:sqlite —
// a very new built-in — and mis-rewrites the specifier. require() isn't statically analyzed,
// so Node resolves the real built-in at runtime regardless of the bundler's built-in list.
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

export interface StoredMatchRow {
  bankTxnId: string;
  amazonTxnId: string;
  matchGroupId: string;
  confidence: Confidence;
  pass: MatchPass;
  createdAt: string;
}

/**
 * Persists match results keyed by (bankTxnId, amazonTxnId), upserting on conflict — since
 * matchTransactions() is a pure function of its inputs, re-running match+save on the same data
 * always upserts the same rows, making repeated CLI runs idempotent.
 *
 * Uses Node's built-in `node:sqlite` (stable since Node 22.5) rather than a native addon like
 * better-sqlite3 — no node-gyp/C++ toolchain required to install this package.
 */
export class MatchStore {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        bank_txn_id TEXT NOT NULL,
        amazon_txn_id TEXT NOT NULL,
        match_group_id TEXT NOT NULL,
        confidence TEXT NOT NULL,
        pass TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (bank_txn_id, amazon_txn_id)
      );
    `);
  }

  saveMatches(matches: MatchResult[]): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO matches (bank_txn_id, amazon_txn_id, match_group_id, confidence, pass, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(bank_txn_id, amazon_txn_id) DO UPDATE SET
        match_group_id = excluded.match_group_id,
        confidence = excluded.confidence,
        pass = excluded.pass
    `);

    const rows: StoredMatchRow[] = matches.flatMap((m) =>
      m.amazonTxnIds.map((amazonTxnId) => ({
        bankTxnId: m.bankTxnId,
        amazonTxnId,
        matchGroupId: `${m.bankTxnId}:${m.amazonTxnIds.join(',')}`,
        confidence: m.confidence,
        pass: m.pass,
        createdAt: now,
      })),
    );

    this.db.exec('BEGIN');
    try {
      for (const row of rows) {
        stmt.run(row.bankTxnId, row.amazonTxnId, row.matchGroupId, row.confidence, row.pass, row.createdAt);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  isBankTxnMatched(bankTxnId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM matches WHERE bank_txn_id = ? LIMIT 1').get(bankTxnId);
  }

  isAmazonTxnMatched(amazonTxnId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM matches WHERE amazon_txn_id = ? LIMIT 1').get(amazonTxnId);
  }

  /**
   * Drops already-matched transactions from a pool — for the "one bank row at a time" lookup
   * pattern (see matching/lookup.ts), call this before each `findAmazonMatchForTransaction` so
   * an Amazon charge already claimed by an earlier row can't also match a later one.
   */
  filterUnconsumed(amazonTxns: AmazonTransaction[]): AmazonTransaction[] {
    return amazonTxns.filter((t) => !this.isAmazonTxnMatched(t.id));
  }

  allMatches(): StoredMatchRow[] {
    const rows = this.db.prepare('SELECT * FROM matches').all() as Record<string, unknown>[];
    return rows.map((r) => ({
      bankTxnId: r.bank_txn_id as string,
      amazonTxnId: r.amazon_txn_id as string,
      matchGroupId: r.match_group_id as string,
      confidence: r.confidence as Confidence,
      pass: r.pass as MatchPass,
      createdAt: r.created_at as string,
    }));
  }

  close(): void {
    this.db.close();
  }
}
