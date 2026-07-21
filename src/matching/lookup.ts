import { matchTransactions, type MatchOptions } from './match';
import { itemTitlesForOrder, itemsForOrder } from './items';
import type { AmazonOrderRef, AmazonTransaction, BankTransaction, Confidence, MatchPass } from './types';

export interface TransactionMatchLookup {
  matched: boolean;
  confidence?: Confidence;
  pass?: MatchPass;
  /** True if the matched Amazon transaction(s) were a refund (positive amount) rather than a charge. */
  isRefund?: boolean;
  amazonTxnIds: string[];
  orderNumbers: string[];
  /** Item titles across all matched order(s) — the "what was purchased" for this transaction. */
  items: string[];
  /** Same items, with asin/link when known — lets a caller look up each item's own category page. */
  matchedItems: AmazonOrderRef['items'];
  /** Present when unmatched because multiple equally-plausible Amazon transactions were found. */
  ambiguousCandidates?: AmazonTransaction[];
}

/**
 * Looks up a single bank transaction against a pool of Amazon transactions — the integration
 * shape LedgerNest actually uses: for each bank register row, "does this match an Amazon charge,
 * and what was purchased?" Runs the same matchTransactions() engine scoped to one bank row, then
 * resolves item titles from `orders` so the caller gets a ready-to-display description.
 *
 * `amazonTxns` should already exclude transactions consumed by earlier lookups in the same batch
 * (e.g. via `MatchStore.filterUnconsumed`) so the same Amazon charge isn't matched twice.
 */
export function findAmazonMatchForTransaction(
  bankTxn: BankTransaction,
  amazonTxns: AmazonTransaction[],
  orders: AmazonOrderRef[] = [],
  options: MatchOptions = {},
): TransactionMatchLookup {
  const report = matchTransactions([bankTxn], amazonTxns, options);

  if (report.matches.length) {
    const m = report.matches[0];
    const matchedTxns = m.amazonTxnIds
      .map((id) => amazonTxns.find((t) => t.id === id))
      .filter((t): t is AmazonTransaction => t !== undefined);

    const orderNumbers = [...new Set(matchedTxns.map((t) => t.orderNumber).filter((o): o is string => o !== null))];
    const items = orderNumbers.flatMap((on) => itemTitlesForOrder(orders, on));
    const matchedItems = orderNumbers.flatMap((on) => itemsForOrder(orders, on));

    return {
      matched: true,
      confidence: m.confidence,
      pass: m.pass,
      isRefund: matchedTxns.some((t) => t.amount > 0),
      amazonTxnIds: m.amazonTxnIds,
      orderNumbers,
      items,
      matchedItems,
    };
  }

  if (report.reviewQueue.length) {
    return { matched: false, amazonTxnIds: [], orderNumbers: [], items: [], matchedItems: [], ambiguousCandidates: report.reviewQueue[0].candidates };
  }

  return { matched: false, amazonTxnIds: [], orderNumbers: [], items: [], matchedItems: [] };
}
