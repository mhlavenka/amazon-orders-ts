import type { AmazonSession } from './auth/session';
import { parseTransactionsPage } from './parsing/transactions';
import type { Transaction } from './parsing/types';
import { AmazonOrdersError } from './errors';

export interface TransactionHistoryOptions {
  /** How many days back to fetch (ignored once paging naturally runs out). Default 365. */
  days?: number;
  /** Set false to fetch only the first page. */
  keepPaging?: boolean;
}

/** Fetches Amazon transaction (card charge/refund) history for the last `days` days. */
export async function getTransactionHistory(
  session: AmazonSession,
  options: TransactionHistoryOptions = {},
): Promise<Transaction[]> {
  if (!session.isAuthenticated) throw new AmazonOrdersError('Call session.login() to authenticate first.');

  const minDate = new Date();
  minDate.setUTCDate(minDate.getUTCDate() - (options.days ?? 365));

  const transactions: Transaction[] = [];
  let nextPageData: Record<string, string> | undefined;
  let keepPaging = options.keepPaging ?? true;
  let firstPage = true;

  while (firstPage || keepPaging) {
    firstPage = false;

    const page = await session.post(session.constants.TRANSACTION_HISTORY_URL, nextPageData);
    session.checkResponse(page, { nextPageData });

    const { transactions: loaded, nextPageData: next } = parseTransactionsPage(page.html);

    let hitOldTransaction = false;
    for (const t of loaded) {
      if (new Date(`${t.completedDate}T00:00:00Z`).getTime() >= minDate.getTime()) {
        transactions.push(t);
      } else {
        hitOldTransaction = true;
        break;
      }
    }

    nextPageData = next ?? undefined;
    if (!nextPageData || hitOldTransaction) keepPaging = false;
  }

  return transactions;
}
