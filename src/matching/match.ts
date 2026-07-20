import { DEFAULT_AMAZON_DESCRIPTOR_PATTERNS, filterAmazonBankTxns } from './filter';
import { withinMatchWindow, dayDistance } from './dates';
import type { AmazonTransaction, BankTransaction, MatchReport, MatchResult, ReviewQueueEntry } from './types';

export interface MatchOptions {
  amazonDescriptorPatterns?: RegExp[];
}

function amountsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/** Checks whether any dash-delimited segment (length >= 4) of the order number appears verbatim in the descriptor. */
function orderFragmentInDescriptor(orderNumber: string | null, descriptor: string): boolean {
  if (!orderNumber) return false;
  const compact = descriptor.replace(/\s+/g, '');
  return orderNumber
    .split('-')
    .filter((seg) => seg.length >= 4)
    .some((seg) => compact.includes(seg));
}

function* combinations<T>(items: T[], size: number): Generator<T[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= items.length - size; i++) {
    for (const rest of combinations(items.slice(i + 1), size - 1)) {
      yield [items[i], ...rest];
    }
  }
}

/**
 * Matches bank transactions against Amazon transactions in three passes:
 *  1. Exact — same amount, Amazon date within window, exactly one candidate.
 *  2. Tie-break — multiple exact-amount candidates; resolved by closest date, then by an
 *     order-number fragment appearing in the bank descriptor. Still ambiguous -> review queue.
 *  3. Combination — subsets of up to 3 unconsumed same-order Amazon transactions whose amounts
 *     sum to an unmatched bank amount within the date window (e.g. a split-shipment charge).
 *
 * Pure and deterministic: re-running with the same inputs always yields the same MatchReport,
 * so persisting the result (see matching/store.ts) is naturally idempotent.
 */
export function matchTransactions(
  bankTxns: BankTransaction[],
  amazonTxns: AmazonTransaction[],
  options: MatchOptions = {},
): MatchReport {
  const patterns = options.amazonDescriptorPatterns ?? DEFAULT_AMAZON_DESCRIPTOR_PATTERNS;
  const amazonBank = filterAmazonBankTxns(bankTxns, patterns);

  const consumedBank = new Set<string>();
  const consumedAmazon = new Set<string>();
  const matches: MatchResult[] = [];
  const reviewQueue: ReviewQueueEntry[] = [];

  const remainingAmazon = () => amazonTxns.filter((t) => !consumedAmazon.has(t.id));

  // Pass 1: exact match + tie-break among same-amount/window candidates.
  for (const bank of amazonBank) {
    const candidates = remainingAmazon().filter(
      (az) => amountsEqual(az.amount, bank.amount) && withinMatchWindow(bank.date, az.date),
    );
    if (!candidates.length) continue;

    if (candidates.length === 1) {
      matches.push({ bankTxnId: bank.id, amazonTxnIds: [candidates[0].id], confidence: 'high', pass: 'exact' });
      consumedBank.add(bank.id);
      consumedAmazon.add(candidates[0].id);
      continue;
    }

    const minDist = Math.min(...candidates.map((az) => dayDistance(bank.date, az.date)));
    const closest = candidates.filter((az) => dayDistance(bank.date, az.date) === minDist);

    let resolved: AmazonTransaction | null = closest.length === 1 ? closest[0] : null;
    if (!resolved) {
      const byFragment = closest.filter((az) => orderFragmentInDescriptor(az.orderNumber, bank.description));
      if (byFragment.length === 1) resolved = byFragment[0];
    }

    if (resolved) {
      matches.push({ bankTxnId: bank.id, amazonTxnIds: [resolved.id], confidence: 'medium', pass: 'tie-break' });
      consumedBank.add(bank.id);
      consumedAmazon.add(resolved.id);
    } else {
      reviewQueue.push({ bankTxn: bank, candidates });
    }
  }

  // Pass 2: combinations of <=3 same-order Amazon transactions summing to an unmatched bank amount.
  for (const bank of amazonBank) {
    if (consumedBank.has(bank.id)) continue;
    if (reviewQueue.some((r) => r.bankTxn.id === bank.id)) continue;

    const windowed = remainingAmazon().filter((az) => withinMatchWindow(bank.date, az.date));
    const byOrder = new Map<string, AmazonTransaction[]>();
    for (const az of windowed) {
      if (!az.orderNumber) continue;
      if (!byOrder.has(az.orderNumber)) byOrder.set(az.orderNumber, []);
      byOrder.get(az.orderNumber)!.push(az);
    }

    let found: AmazonTransaction[] | null = null;
    for (const group of byOrder.values()) {
      if (found || group.length < 2) continue;
      for (let size = 2; size <= 3 && !found; size++) {
        for (const combo of combinations(group, size)) {
          if (amountsEqual(combo.reduce((sum, t) => sum + t.amount, 0), bank.amount)) {
            found = combo;
            break;
          }
        }
      }
    }

    if (found) {
      matches.push({ bankTxnId: bank.id, amazonTxnIds: found.map((t) => t.id), confidence: 'medium', pass: 'combination' });
      consumedBank.add(bank.id);
      for (const t of found) consumedAmazon.add(t.id);
    }
  }

  const reviewedBankIds = new Set(reviewQueue.map((r) => r.bankTxn.id));
  const unmatchedBank = amazonBank.filter((b) => !consumedBank.has(b.id) && !reviewedBankIds.has(b.id));
  const unmatchedAmazon = remainingAmazon();

  return { matches, unmatchedBank, unmatchedAmazon, reviewQueue };
}
