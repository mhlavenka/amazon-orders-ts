import type { AnyNode } from 'domhandler';
import { parseHtml, select, selectOne, toCurrency, type Root } from '../html';
import * as sel from '../auth/selectors';
import { simpleParse, required } from './parsable';
import { AmazonOrdersParseError } from '../errors';
import type { Transaction } from './types';

function parseTransactionDate(text: string): string {
  const d = new Date(text.trim());
  if (Number.isNaN(d.getTime())) {
    throw new AmazonOrdersParseError(`Transaction date "${text}" could not be parsed.`, { rawDate: text });
  }
  return d.toISOString().slice(0, 10);
}

function parseOrderNumberFromText(value: string | null): string | null {
  if (!value) return null;
  const match = /.*#([0-9-]+)$/.exec(value.trim());
  return match ? match[1] : null;
}

function parsePaymentLast4(paymentMethod: string | null): string | null {
  if (!paymentMethod) return null;
  const match = /\*+(\d+)$/.exec(paymentMethod);
  return match ? match[1] : null;
}

function parseTransactionTag($: Root, el: AnyNode, completedDate: string): Transaction {
  const paymentMethod = simpleParse($, el, sel.FIELD_TRANSACTION_PAYMENT_METHOD_SELECTORS) as string | null;
  const grandTotalRaw = simpleParse($, el, sel.FIELD_TRANSACTION_GRAND_TOTAL_SELECTORS);
  const grandTotal = required(
    toCurrency(typeof grandTotalRaw === 'number' ? grandTotalRaw : (grandTotalRaw as string | null)),
    'Transaction.grandTotal',
  );
  const orderNumberText = simpleParse($, el, sel.FIELD_TRANSACTION_ORDER_NUMBER_SELECTORS) as string | null;
  const orderNumber = parseOrderNumberFromText(orderNumberText);
  const orderLink = simpleParse($, el, sel.FIELD_TRANSACTION_ORDER_LINK_SELECTORS, { attrName: 'href' }) as
    | string
    | null;

  return {
    completedDate,
    paymentMethod,
    paymentMethodLast4: parsePaymentLast4(paymentMethod),
    grandTotal,
    isRefund: grandTotal > 0,
    orderNumber,
    orderDetailsLink: orderLink,
    seller: null,
  };
}

export interface TransactionPageResult {
  transactions: Transaction[];
  /** Form data needed to fetch the next page, or null if this was the last page. */
  nextPageData: Record<string, string> | null;
}

/**
 * Parses a single Amazon transaction-history page (POST response body). Mirrors
 * amazon-orders' _parse_transaction_form_tag(): each page groups transactions under
 * date-header containers, followed by a sibling container holding that date's line items.
 */
export function parseTransactionsPage(html: string): TransactionPageResult {
  const $ = parseHtml(html);
  const formTag = selectOne($, $.root().get(0)!, sel.TRANSACTION_HISTORY_FORM_SELECTOR);

  if (!formTag) {
    const container = selectOne($, $.root().get(0)!, sel.TRANSACTION_HISTORY_CONTAINER_SELECTOR);
    if (container && container.text().includes("don't have any transactions")) {
      return { transactions: [], nextPageData: null };
    }
    throw new AmazonOrdersParseError(
      'Could not parse transaction history — the expected form was not found. Check if Amazon changed the HTML.',
    );
  }

  const transactions: Transaction[] = [];
  const dateContainers = select($, formTag.get(0)!, sel.TRANSACTION_DATE_CONTAINERS_SELECTOR).toArray();

  for (const dateContainer of dateContainers) {
    const $dateContainer = $(dateContainer);
    const dateText = $dateContainer.find('span').first().text();
    if (!dateText) continue;
    const completedDate = parseTransactionDate(dateText);

    const transactionsContainer = $dateContainer.next('div');
    if (!transactionsContainer.length) continue;

    const txTags = select($, transactionsContainer.get(0)!, sel.TRANSACTIONS_SELECTOR).toArray();
    for (const txTag of txTags) {
      transactions.push(parseTransactionTag($, txTag, completedDate));
    }
  }

  const stateInput = selectOne($, formTag.get(0)!, sel.TRANSACTIONS_NEXT_PAGE_INPUT_STATE_SELECTOR);
  const ieInput = selectOne($, formTag.get(0)!, sel.TRANSACTIONS_NEXT_PAGE_INPUT_IE_SELECTOR);
  const nextPageInput = selectOne($, formTag.get(0)!, sel.TRANSACTIONS_NEXT_PAGE_INPUT_SELECTOR);

  if (!stateInput || !ieInput || !nextPageInput) {
    return { transactions, nextPageData: null };
  }

  const nextPageData: Record<string, string> = {
    'ppw-widgetState': stateInput.attr('value') ?? '',
    ie: ieInput.attr('value') ?? '',
    [nextPageInput.attr('name') ?? '']: '',
  };

  return { transactions, nextPageData };
}
