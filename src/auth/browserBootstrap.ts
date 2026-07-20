import type { CookieJar } from 'tough-cookie';
import { AmazonOrdersError } from '../errors';

// Minimal local shims for the tiny slice of Playwright's API this module uses — deliberately
// NOT importing playwright's own types, so this package has no hard (dev)dependency on it.
// Playwright is an optional peer dependency; consumers who want the browser fallback install it
// themselves, and it's `require()`'d lazily here so nothing breaks when it's absent.
interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: number;
}
interface PlaywrightPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  // Playwright evaluates a string expression in the page/browser context, not this module's —
  // passed as a string (rather than a real function) so this file needs no DOM lib types.
  waitForFunction(expression: string, arg?: unknown, opts?: { timeout?: number; polling?: number }): Promise<unknown>;
}
interface PlaywrightBrowserContext {
  newPage(): Promise<PlaywrightPage>;
  cookies(): Promise<PlaywrightCookie[]>;
  addCookies(cookies: PlaywrightCookie[]): Promise<void>;
  close(): Promise<void>;
}
interface PlaywrightBrowser {
  newContext(): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
}
interface PlaywrightModule {
  chromium: { launch(opts?: { headless?: boolean }): Promise<PlaywrightBrowser> };
}

function loadPlaywright(): PlaywrightModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('playwright') as PlaywrightModule;
  } catch {
    throw new AmazonOrdersError(
      'Playwright is not installed. Run `npm install playwright && npx playwright install chromium` to enable ' +
        "the browser fallback for Amazon's JS/bot challenges.",
    );
  }
}

/** Copies every cookie the jar holds for `url` into the browser context — needed when the
 * challenge occurs mid-flow (e.g. a verification step after submitting the sign-in form), where
 * the browser must continue the SAME session, not start a fresh anonymous one. */
async function injectCookiesFromJar(context: PlaywrightBrowserContext, jar: CookieJar, url: string): Promise<void> {
  const cookies = await jar.getCookies(url);
  if (!cookies.length) return;

  const playwrightCookies: PlaywrightCookie[] = cookies.map((c) => ({
    name: c.key,
    value: c.value,
    domain: c.domain ?? new URL(url).hostname,
    path: c.path ?? '/',
    secure: c.secure ?? false,
    httpOnly: c.httpOnly ?? false,
    ...(c.expires instanceof Date ? { expires: Math.floor(c.expires.getTime() / 1000) } : {}),
  }));

  await context.addCookies(playwrightCookies);
}

/**
 * Loads `url` in a real Chromium browser so its JS challenge (e.g. an AWS WAF challenge, or an
 * interactive visual CAPTCHA — see AmazonOrdersBrowserChallengeError) resolves the way it would
 * for an actual browser/human, then copies the resulting cookies into `jar` so the rest of
 * AmazonSession's plain-HTTP flow can continue normally. Only ever invoked from AmazonSession's
 * own fallback — never required for the base HTTP-only flow.
 *
 * `challengeTimeoutMs` should be generous when `headless` is false — some challenges (visual
 * grid CAPTCHAs) are specifically designed to require actual human interaction, not just a real
 * browser's JS engine, so the user needs real time to solve it visually before we give up.
 */
export async function bootstrapCookiesViaBrowser(
  url: string,
  jar: CookieJar,
  headless = true,
  challengeTimeoutMs = headless ? 45_000 : 180_000,
): Promise<void> {
  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch({ headless });

  try {
    const context = await browser.newContext();
    await injectCookiesFromJar(context, jar, url);
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Don't wait for 'networkidle' — a WAF challenge script's own polling/beacon requests can
    // keep the page from ever reaching it. Instead poll until the challenge markup itself is
    // gone (the challenge script reloads/replaces the page once it resolves). Not fatal if this
    // times out — we still copy whatever cookies exist afterward.
    await page
      .waitForFunction(
        '!document.documentElement.innerHTML.includes("awswaf.com") && ' +
          '!document.getElementById("cvf-aamation-container")',
        undefined,
        { timeout: challengeTimeoutMs, polling: 500 },
      )
      .catch(() => undefined);

    const cookies = await context.cookies();
    for (const c of cookies) {
      const domain = c.domain.replace(/^\./, '');
      const cookieStr = `${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}${c.secure ? '; Secure' : ''}${c.httpOnly ? '; HttpOnly' : ''}`;
      await jar.setCookie(cookieStr, `https://${domain}${c.path}`).catch(() => undefined);
    }
  } finally {
    await browser.close();
  }
}
