import type { BankTransaction } from './types';

/**
 * Descriptors Amazon.ca charges/refunds actually show up as on Canadian bank/card statements.
 * Broad by design (word-boundary "AMAZON"/"AMZN", not full descriptor strings) — a real MBNA
 * export showed plain "AMAZON* <code> VANCOUVER BC" (no ".CA") alongside "AMAZON.CA* ...", and
 * bank exports vary too much to enumerate exhaustively. Override via `amazonDescriptorPatterns`
 * if this is too broad (or not broad enough) for your data.
 */
export const DEFAULT_AMAZON_DESCRIPTOR_PATTERNS: RegExp[] = [/\bAMAZON\b/i, /\bAMZN\b/i];

export function isAmazonDescriptor(description: string, patterns: RegExp[] = DEFAULT_AMAZON_DESCRIPTOR_PATTERNS): boolean {
  return patterns.some((re) => re.test(description));
}

export function filterAmazonBankTxns(
  bankTxns: BankTransaction[],
  patterns: RegExp[] = DEFAULT_AMAZON_DESCRIPTOR_PATTERNS,
): BankTransaction[] {
  return bankTxns.filter((t) => isAmazonDescriptor(t.description, patterns));
}
