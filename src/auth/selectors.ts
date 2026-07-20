// Ported from amazon-orders' selectors.py. Trimmed to what this library actually parses:
// login/auth forms, transaction history, and order history/number + line items. The
// upstream project's full-order-details selectors (subtotal, tax, gift cards, shipping,
// promotions, Whole Foods, cancelled-order edge cases, etc.) are intentionally NOT ported —
// out of scope for reconciliation, which only needs order number, date, total and item titles.

export interface TextSelector {
  css: string;
  /** Exact text match (after trim) required for a match. */
  text?: string;
  /** Case-insensitive substring match required for a match. */
  textContains?: string;
}

export type Selector = string | TextSelector;

export const BAD_INDEX_SELECTOR = 'html.a-tablet';

export const SIGN_IN_FORM_SELECTOR = "form[name='signIn']";
export const CLAIM_FORM_SELECTOR = "form[name='signIn'].auth-validate-form";
export const INTENT_FORM_SELECTOR = 'form#intent-confirmation-form';
export const INTENT_MESSAGE_SELECTOR = 'div#intent-confirmation-container';
export const MFA_DEVICE_SELECT_FORM_SELECTOR = 'form#auth-select-device-form';
export const MFA_DEVICE_SELECT_INPUT_SELECTOR = "input[name='otpDeviceContext']";
export const MFA_FORM_SELECTOR = 'form#auth-mfa-form';
export const CAPTCHA_1_FORM_SELECTOR = 'form.cvf-widget-form-captcha';
export const CAPTCHA_2_FORM_SELECTORS = ["form:has(input[id^='captchacharacters'])", "form[action$='validateCaptcha']"];
export const CAPTCHA_OTP_FORM_SELECTOR = 'form#verification-code-form';
export const DEFAULT_ERROR_TAG_SELECTOR = 'div#auth-error-message-box';
export const CAPTCHA_1_ERROR_SELECTOR = 'div.cvf-widget-alert';
export const CAPTCHA_2_ERROR_SELECTOR = 'div.a-alert-info';
export const ACIC_CHALLENGE_SELECTOR = '#aa-challenge-page-captcha-container';

export const NEXT_PAGE_LINK_SELECTOR = 'ul.a-pagination li.a-last a';

export const ORDER_HISTORY_ENTITY_SELECTORS = ['div.order-card', 'div.order'];
export const ORDER_HISTORY_COUNT_SELECTOR = '.js-yo-container span.num-orders';
export const ORDER_DETAILS_ENTITY_SELECTORS = ['div#orderDetails', 'div#ordersContainer', 'div#odp-main-section'];
export const ITEM_ENTITY_SELECTORS = [
  "[data-component='purchasedItems'] .a-fixed-left-grid",
  'div:has(> div.yohtmlc-item)',
  '.item-box',
];
// Order types this port doesn't attempt to parse items/shipments for (Amazon Fresh, physical stores, WFM).
export const ORDER_SKIP_ITEMS: Selector[] = [
  '.brand-info-box .brand-logo img',
  "a.yohtmlc-order-details-link[href^='/wholefoodsmarket']",
  { css: 'div.yohtmlc-shipment-status-primaryText', text: 'Purchased at Amazon' },
];

export const FIELD_ITEM_TITLE_SELECTORS = [
  "[data-component='itemTitle']",
  '.yohtmlc-item a',
  '.yohtmlc-product-title',
  'div.a-column.a-span10 > a',
];
export const FIELD_ITEM_LINK_SELECTORS = [
  "[data-component='itemTitle'] a",
  '.yohtmlc-item a',
  'a:has(> .yohtmlc-product-title)',
  '.yohtmlc-product-title a',
  'div.a-column.a-span10 > a',
];
export const FIELD_ITEM_QUANTITY_SELECTORS = ['.od-item-view-qty', 'span.item-view-qty', 'span.product-image__qty'];
export const FIELD_ITEM_PRICE_SELECTORS = [
  "[data-component='unitPrice'] .a-text-price :not(.a-offscreen)",
  '.yohtmlc-item .a-color-price',
  'div.a-section.a-text-right span.a-size-small',
];

export const FIELD_ORDER_NUMBER_SELECTORS = [
  "[data-component='orderId']",
  "[data-component='briefOrderInfo'] div.a-column",
  ".order-date-invoice-item :is(bdi, span)[dir='ltr']",
  ".yohtmlc-order-id :is(bdi, span)[dir='ltr']",
  ":is(bdi, span)[dir='ltr']",
];
export const FIELD_ORDER_GRAND_TOTAL_SELECTORS = [
  'div.yohtmlc-order-total span.value',
  'div.order-header div.a-column.a-span2',
  'div.order-header div.a-col-left .a-span9',
];
export const FIELD_ORDER_PLACED_DATE_SELECTORS = [
  "[data-component='orderDate']",
  'span.order-date-invoice-item',
  "[data-component='briefOrderInfo'] div.a-column",
  'div:is(.a-span3, .a-span12)',
];
// Identifies a cancelled order on the history page — grand_total is not parsed for these.
export const ORDER_SKIP_TOTALS: Selector[] = [{ css: 'div.yohtmlc-shipment-status-primaryText', text: 'Cancelled' }];

export const TRANSACTION_HISTORY_FORM_SELECTOR = "form:has(input[name='ppw-widgetState'])";
export const TRANSACTION_HISTORY_CONTAINER_SELECTOR = '.pmts-portal-component';
export const TRANSACTION_DATE_CONTAINERS_SELECTOR = 'div.apx-transaction-date-container';
export const TRANSACTIONS_SELECTOR = 'div.apx-transactions-line-item-component-container:has(*)';
export const TRANSACTIONS_NEXT_PAGE_INPUT_SELECTOR =
  "input[type='submit'][name^='ppw-widgetEvent:DefaultNextPageNavigationEvent']";
export const TRANSACTIONS_NEXT_PAGE_INPUT_STATE_SELECTOR = "input[name='ppw-widgetState']";
export const TRANSACTIONS_NEXT_PAGE_INPUT_IE_SELECTOR = "input[name='ie']";

export const FIELD_TRANSACTION_PAYMENT_METHOD_SELECTORS = [
  'div.apx-transactions-line-item-component-container > div:nth-child(1) span.a-size-base',
];
export const FIELD_TRANSACTION_GRAND_TOTAL_SELECTORS = [
  'div.apx-transactions-line-item-component-container > div:nth-child(1) span.a-size-base-plus',
];
export const FIELD_TRANSACTION_ORDER_NUMBER_SELECTORS = [
  'div.apx-transactions-line-item-component-container div .a-span12',
];
export const FIELD_TRANSACTION_ORDER_LINK_SELECTORS = [
  'div.apx-transactions-line-item-component-container a.a-link-normal',
];
