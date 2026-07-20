export interface Item {
  title: string;
  /** Product ASIN, derived from the item link. Null when not a standard product page. */
  asin: string | null;
  link: string | null;
  price: number | null;
  quantity: number | null;
}

export interface Order {
  orderNumber: string | null;
  orderPlacedDate: string | null; // ISO yyyy-mm-dd
  grandTotal: number | null;
  /** True if the order was cancelled — grandTotal/items are not parsed in that case. */
  cancelled: boolean;
  /** True when the history/details page markup identifies an order type this port doesn't parse items for. */
  skipped: boolean;
  items: Item[];
  /** Index of the order within the history page results it was fetched from, for resuming pagination. */
  index?: number;
}

export interface Transaction {
  completedDate: string; // ISO yyyy-mm-dd
  paymentMethod: string | null;
  paymentMethodLast4: string | null;
  grandTotal: number;
  isRefund: boolean;
  orderNumber: string | null;
  orderDetailsLink: string | null;
  seller: string | null;
}
