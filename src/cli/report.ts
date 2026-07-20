import type { AmazonOrderRef, AmazonTransaction, BankTransaction, MatchReport } from '../matching/types';
import { itemTitlesForOrder } from '../matching/items';

export interface ReportView {
  matches: {
    bankTxnId: string;
    bankDescription: string;
    bankAmount: number;
    amazonTxnIds: string[];
    items: string[];
    confidence: string;
    pass: string;
  }[];
  unmatchedBank: BankTransaction[];
  unmatchedAmazon: (AmazonTransaction & { note: string })[];
  reviewQueue: { bankTxn: BankTransaction; candidateIds: string[] }[];
}

export function buildReportView(
  report: MatchReport,
  amazonTxnsById: Map<string, AmazonTransaction>,
  bankTxnsById: Map<string, BankTransaction>,
  orders: AmazonOrderRef[] = [],
): ReportView {
  return {
    matches: report.matches.map((m) => {
      const bank = bankTxnsById.get(m.bankTxnId);
      const orderNumbers = new Set(m.amazonTxnIds.map((id) => amazonTxnsById.get(id)?.orderNumber ?? null));
      const items = [...orderNumbers].flatMap((on) => itemTitlesForOrder(orders, on));
      return {
        bankTxnId: m.bankTxnId,
        bankDescription: bank?.description ?? '',
        bankAmount: bank?.amount ?? 0,
        amazonTxnIds: m.amazonTxnIds,
        items,
        confidence: m.confidence,
        pass: m.pass,
      };
    }),
    unmatchedBank: report.unmatchedBank,
    unmatchedAmazon: report.unmatchedAmazon.map((t) => ({ ...t, note: 'no matching bank row — possible gift-card-funded purchase' })),
    reviewQueue: report.reviewQueue.map((r) => ({ bankTxn: r.bankTxn, candidateIds: r.candidates.map((c) => c.id) })),
  };
}

function money(n: number): string {
  return n.toFixed(2);
}

export function formatReportTable(view: ReportView): string {
  const lines: string[] = [];

  lines.push(`Matches (${view.matches.length})`);
  for (const m of view.matches) {
    lines.push(
      `  [${m.confidence}/${m.pass}] ${m.bankDescription} ${money(m.bankAmount)}  <-  ${m.amazonTxnIds.join(' + ')}` +
        (m.items.length ? `\n      items: ${m.items.join(', ')}` : ''),
    );
  }

  lines.push('');
  lines.push(`Review queue (${view.reviewQueue.length})`);
  for (const r of view.reviewQueue) {
    lines.push(`  ${r.bankTxn.description} ${money(r.bankTxn.amount)} on ${r.bankTxn.date} — candidates: ${r.candidateIds.join(', ')}`);
  }

  lines.push('');
  lines.push(`Unmatched bank rows (${view.unmatchedBank.length})`);
  for (const b of view.unmatchedBank) {
    lines.push(`  ${b.date}  ${b.description}  ${money(b.amount)}`);
  }

  lines.push('');
  lines.push(`Unmatched Amazon transactions (${view.unmatchedAmazon.length})`);
  for (const a of view.unmatchedAmazon) {
    lines.push(`  ${a.date}  order ${a.orderNumber ?? '?'}  ${money(a.amount)}  — ${a.note}`);
  }

  return lines.join('\n');
}
