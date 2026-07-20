// Ported from amazon-orders' constants.py. Only the .com defaults plus the region
// overrides actually needed for amazon.ca are kept (the Python project supports several
// English-locale TLDs; this port is amazon.ca-first per this library's use case, but
// keeps the same normalization logic so other TLDs can be added later without rework).

const REGION_LANGUAGES: Record<string, string> = {
  ca: 'en-CA,en;q=0.9,en-US;q=0.8',
  'co.uk': 'en-GB,en;q=0.9,en-US;q=0.8',
  'com.au': 'en-AU,en;q=0.9,en-US;q=0.8',
};

// The Python source hardcodes 'usflex' — an OpenID association handle Amazon's backend uses to
// look up the marketplace config for the sign-in request. It's US-specific: using it on amazon.ca
// makes /ap/signin 404 (confirmed live — a real browser's own "Sign in" link resolves to
// assoc_handle=caflex). The Python project's own docs note non-.com domains aren't officially
// supported for exactly this reason. Only .ca is confirmed; other TLDs would need discovering the
// same way (open the site, click Sign in, read the assoc_handle off the resulting URL).
const REGION_ASSOC_HANDLES: Record<string, string> = {
  ca: 'caflex',
};

// The Python source hardcodes 'x-main' — the legacy .com cookie marking an authenticated
// session. amazon.ca uses a region-suffixed scheme instead ("acbca" = amazon.ca's internal
// marketplace code) — confirmed live: a real successful login produced x-acbca, at-acbca,
// sess-at-acbca, sst-acbca, etc., but never x-main, so this check silently reported "not logged
// in" for a perfectly valid session. x-acbca is the direct analog of x-main here.
const REGION_AUTH_COOKIES: Record<string, string> = {
  ca: 'x-acbca',
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

  const host = new URL(baseUrl).host.toLowerCase();
  const bareHost = host.startsWith('www.') ? host.slice(4) : host;
  const tld = bareHost.startsWith('amazon.') ? bareHost.slice('amazon.'.length) : '';

  const signInQueryParams: Record<string, string> = {
    'openid.pape.max_auth_age': '0',
    'openid.return_to': `${baseUrl}/?ref_=nav_custrec_signin`,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.assoc_handle': REGION_ASSOC_HANDLES[tld] ?? 'usflex',
    'openid.mode': 'checkid_setup',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.ns': 'http://specs.openid.net/auth/2.0',
  };
  const signInUrl = `${baseUrl}/ap/signin`;

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
    COOKIES_SET_WHEN_AUTHENTICATED: [REGION_AUTH_COOKIES[tld] ?? 'x-main'],
    JS_ROBOT_TEXT_REGEX: /[.\s\S]*verify that you're not a robot[.\s\S]*Enable JavaScript[.\s\S]*/,
  };
}
