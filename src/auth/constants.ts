// Ported from amazon-orders' constants.py. Only the .com defaults plus the region
// overrides actually needed for amazon.ca are kept (the Python project supports several
// English-locale TLDs; this port is amazon.ca-first per this library's use case, but
// keeps the same normalization logic so other TLDs can be added later without rework).

const REGION_LANGUAGES: Record<string, string> = {
  ca: 'en-CA,en;q=0.9,en-US;q=0.8',
  'co.uk': 'en-GB,en;q=0.9,en-US;q=0.8',
  'com.au': 'en-AU,en;q=0.9,en-US;q=0.8',
};

function normalizeBaseUrl(value: string): string {
  const v = value.trim().replace(/\/+$/, '');
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  if (v.startsWith('www.')) return `https://${v}`;
  return `https://www.${v}`;
}

export interface Constants {
  BASE_URL: string;
  SIGN_IN_URL: string;
  SIGN_IN_QUERY_PARAMS: Record<string, string>;
  SIGN_OUT_URL: string;
  ORDER_HISTORY_URL: string;
  ORDER_DETAILS_URL: string;
  TRANSACTION_HISTORY_URL: string;
  HISTORY_FILTER_QUERY_PARAM: string;
  BASE_HEADERS: Record<string, string>;
  COOKIES_SET_WHEN_AUTHENTICATED: string[];
  JS_ROBOT_TEXT_REGEX: RegExp;
}

export function buildConstants(domain = 'amazon.ca'): Constants {
  const baseUrl = normalizeBaseUrl(domain);

  const signInQueryParams: Record<string, string> = {
    'openid.pape.max_auth_age': '0',
    'openid.return_to': `${baseUrl}/?ref_=nav_custrec_signin`,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.assoc_handle': 'usflex',
    'openid.mode': 'checkid_setup',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.ns': 'http://specs.openid.net/auth/2.0',
  };
  const signInUrl = `${baseUrl}/ap/signin`;

  const host = new URL(baseUrl).host.toLowerCase();
  const bareHost = host.startsWith('www.') ? host.slice(4) : host;
  const tld = bareHost.startsWith('amazon.') ? bareHost.slice('amazon.'.length) : '';

  const baseHeaders: Record<string, string> = {
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': REGION_LANGUAGES[tld] ?? 'en-US,en;q=0.9',
    Origin: baseUrl,
    Referer: `${signInUrl}?${new URLSearchParams(signInQueryParams).toString()}`,
    'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  };

  return {
    BASE_URL: baseUrl,
    SIGN_IN_URL: signInUrl,
    SIGN_IN_QUERY_PARAMS: signInQueryParams,
    SIGN_OUT_URL: `${baseUrl}/gp/flex/sign-out.html`,
    ORDER_HISTORY_URL: `${baseUrl}/your-orders/orders`,
    ORDER_DETAILS_URL: `${baseUrl}/gp/your-account/order-details`,
    TRANSACTION_HISTORY_URL: `${baseUrl}/cpe/yourpayments/transactions`,
    HISTORY_FILTER_QUERY_PARAM: 'timeFilter',
    BASE_HEADERS: baseHeaders,
    COOKIES_SET_WHEN_AUTHENTICATED: ['x-main'],
    JS_ROBOT_TEXT_REGEX: /[.\s\S]*verify that you're not a robot[.\s\S]*Enable JavaScript[.\s\S]*/,
  };
}
