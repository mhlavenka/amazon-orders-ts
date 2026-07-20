export interface BankTransaction {
  id: string;
  date: string; // ISO yyyy-mm-dd
  description: string;
  /** Signed, matching the bank statement's own convention (a purchase is typically negative). */
  amount: number;
  currency: string;
}

export interface AmazonTransaction {
  id: string;
  date: string; // ISO yyyy-mm-dd
  /** Signed — negative for a charge, positive for a refund (mirrors parsing.Transaction.grandTotal). */
  amount: number;
  orderNumber: string | null;
}

export interface AmazonOrderRef {
  orderNumber: string;
  items: { title: string }[];
}

export type Confidence = 'high' | 'medium' | 'low';
export type MatchPass = 'exact' | 'tie-break' | 'combination';

export interface MatchResult {
  bankTxnId: string;
  amazonTxnIds: string[];
  confidence: Confidence;
  pass: MatchPass;
}

export interface ReviewQueueEntry {
  bankTxn: BankTransaction;
  candidates: AmazonTransaction[];
}

export interface MatchReport {
  matches: MatchResult[];
  /** Amazon-descriptor bank rows with no resolved match. */
  unmatchedBank: BankTransaction[];
  /** Amazon transactions with no matching bank row — often a gift-card-funded purchase. */
  unmatchedAmazon: AmazonTransaction[];
  /** Ambiguous bank rows where multiple equally-plausible Amazon transactions were found. */
  reviewQueue: ReviewQueueEntry[];
}
