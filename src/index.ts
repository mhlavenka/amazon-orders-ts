export { AmazonSession, type AmazonSessionOptions, type RequestResult } from './auth/session';
export type { AuthIO } from './auth/io';
export { ConsoleIO } from './auth/io';
export { defaultConfig, type AmazonOrdersConfig } from './config';
export {
  AmazonOrdersError,
  AmazonOrdersAuthError,
  AmazonOrdersAuthRedirectError,
  AmazonOrdersNotFoundError,
  AmazonOrdersParseError,
} from './errors';

export { parseTransactionsPage, type TransactionPageResult } from './parsing/transactions';
export { parseOrderHistoryPage, parseOrderDetailsPage, type OrderHistoryPageResult } from './parsing/orders';
export type { Order, Item, Transaction } from './parsing/types';

export { getOrderHistory, type OrderHistoryOptions } from './orders';
export { getTransactionHistory, type TransactionHistoryOptions } from './transactions';
