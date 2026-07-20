import fs from 'node:fs';
import path from 'node:path';
import { CookieJar } from 'tough-cookie';
import { defaultConfig, type AmazonOrdersConfig } from '../config';
import { buildConstants, type Constants } from './constants';
import * as sel from './selectors';
import { parseHtml, selectOne, type Root } from '../html';
import {
  AmazonOrdersAuthError,
  AmazonOrdersAuthRedirectError,
  AmazonOrdersBrowserChallengeError,
  AmazonOrdersError,
} from '../errors';
import { ConsoleIO, type AuthIO } from './io';
import { defaultAuthForms, type AuthForm, type FormSubmitter, type PageResponse } from './forms';
import { bootstrapCookiesViaBrowser } from './browserBootstrap';

// Node's global `fetch` is undici under the hood (Node >=18); we drive it manually with
// redirect: 'manual' rather than letting it auto-follow, because auto-follow only exposes the
// FINAL response — Amazon's login flow sets important cookies on intermediate redirect hops,
// which we'd otherwise silently lose.
const MAX_REDIRECTS = 20;

/**
 * fetch()'s own AbortSignal only bounds getting the response (status/headers) — once that
 * resolves, reading the body (response.text()/arrayBuffer()) is a separate, unbounded operation.
 * If Amazon (or a WAF) sends headers promptly but then stalls or truncates the body — plausible
 * anti-automation behavior, and reproduced live: a request logged its 200 response but then hung
 * indefinitely with no further output — this races the read against its own timeout so that hangs
 * there fail loudly too, not just ones during the initial connect.
 */
async function readBodyWithTimeout<T>(read: () => Promise<T>, timeoutMs: number, url: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AmazonOrdersError(`Reading the response body from ${url} timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export interface AmazonSessionOptions {
  username?: string;
  password?: string;
  domain?: string;
  io?: AuthIO;
  config?: Partial<AmazonOrdersConfig>;
}

export interface RequestResult extends PageResponse {
  status: number;
}

export class AmazonSession implements FormSubmitter {
  readonly config: AmazonOrdersConfig;
  readonly constants: Constants;
  readonly io: AuthIO;
  username?: string;
  password?: string;
  isAuthenticated = false;

  private cookieJar: CookieJar;
  private readonly authForms: AuthForm[];

  constructor(options: AmazonSessionOptions = {}) {
    this.config = defaultConfig(options.config);
    this.constants = buildConstants(options.domain ?? this.config.domain);
    this.io = options.io ?? new ConsoleIO();
    this.username = options.username;
    this.password = options.password;
    this.authForms = defaultAuthForms();

    fs.mkdirSync(this.config.configDir, { recursive: true });
    this.cookieJar = this.loadCookieJar();
  }

  private loadCookieJar(): CookieJar {
    if (fs.existsSync(this.config.cookieJarPath)) {
      const raw = fs.readFileSync(this.config.cookieJarPath, 'utf-8');
      try {
        return CookieJar.deserializeSync(JSON.parse(raw));
      } catch {
        // Corrupt or foreign-format cookie file — start fresh rather than fail hard.
      }
    }
    return new CookieJar();
  }

  private persistCookies(): void {
    const serialized = this.cookieJar.serializeSync();
    fs.mkdirSync(path.dirname(this.config.cookieJarPath), { recursive: true });
    fs.writeFileSync(this.config.cookieJarPath, JSON.stringify(serialized), { mode: 0o600 });
  }

  /** Clears the persisted session — the caller must re-run login() after this. */
  clearSession(): void {
    this.cookieJar = new CookieJar();
    this.isAuthenticated = false;
    if (fs.existsSync(this.config.cookieJarPath)) fs.rmSync(this.config.cookieJarPath);
  }

  private vlog(msg: string): void {
    if (this.config.verbose) this.io.echo(`[verbose] ${msg}`);
  }

  private async authCookiesStored(): Promise<boolean> {
    const cookieHeader = await this.cookieJar.getCookieString(this.constants.BASE_URL);
    return this.constants.COOKIES_SET_WHEN_AUTHENTICATED.every((name) => cookieHeader.includes(`${name}=`));
  }

  /**
   * Low-level request, following redirects manually (see MAX_REDIRECTS comment) so cookies set
   * on intermediate hops are captured into the jar before the next hop is requested.
   */
  async request(
    method: string,
    url: string,
    init: { params?: Record<string, string>; data?: Record<string, string> } = {},
  ): Promise<RequestResult> {
    let currentUrl = url;
    if (init.params) {
      const u = new URL(currentUrl);
      for (const [k, v] of Object.entries(init.params)) u.searchParams.set(k, v);
      currentUrl = u.toString();
    }

    let currentMethod = method.toUpperCase();
    let body: string | undefined =
      currentMethod !== 'GET' && init.data ? new URLSearchParams(init.data).toString() : undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const cookieHeader = await this.cookieJar.getCookieString(currentUrl);
      const headers: Record<string, string> = { ...this.constants.BASE_HEADERS };
      if (cookieHeader) headers.Cookie = cookieHeader;
      if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';

      this.vlog(`${currentMethod} ${currentUrl} (hop ${hop})...`);
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: currentMethod,
          headers,
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
          throw new AmazonOrdersError(
            `Request to ${currentUrl} timed out after ${this.config.requestTimeoutMs}ms with no response. ` +
              'Amazon (or a proxy/WAF in front of it) may be silently holding the connection open rather than ' +
              'rejecting it outright.',
          );
        }
        throw err;
      }
      this.vlog(`-> ${response.status} ${response.url || currentUrl}`);

      const setCookies = response.headers.getSetCookie?.() ?? [];
      for (const cookieStr of setCookies) {
        await this.cookieJar.setCookie(cookieStr, currentUrl).catch(() => {
          /* malformed/rejected cookie (e.g. domain mismatch) — ignore, matches browser behavior */
        });
      }

      const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
      const location = response.headers.get('location');
      if (isRedirect && location) {
        await readBodyWithTimeout(() => response.arrayBuffer(), this.config.requestTimeoutMs, currentUrl).catch(
          () => undefined,
        );
        currentUrl = new URL(location, currentUrl).toString();
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod !== 'GET' && currentMethod !== 'HEAD')) {
          currentMethod = 'GET';
          body = undefined;
        }
        continue;
      }

      this.vlog('Reading response body...');
      const html = await readBodyWithTimeout(() => response.text(), this.config.requestTimeoutMs, currentUrl);
      this.vlog(`Body read (${html.length} bytes).`);
      const result: RequestResult = { url: response.url || currentUrl, html, $: parseHtml(html), status: response.status };
      this.persistCookies();
      return result;
    }

    throw new AmazonOrdersError(`Too many redirects requesting ${url}.`);
  }

  async get(url: string, params?: Record<string, string>): Promise<RequestResult> {
    return this.request('GET', url, { params });
  }

  async post(url: string, data?: Record<string, string>): Promise<RequestResult> {
    return this.request('POST', url, { data });
  }

  /** Implements FormSubmitter — used by AuthForm.submit(). */
  async submitForm(method: string, url: string, data: Record<string, string>): Promise<PageResponse> {
    return this.request(method, url, method === 'GET' ? { params: data } : { data });
  }

  /**
   * Runs the login state machine: sign-in form, then whichever of OTP / device-select /
   * captcha / bot-challenge steps Amazon presents, until `COOKIES_SET_WHEN_AUTHENTICATED`
   * show up or `maxAuthAttempts` is exhausted. Safe to call again on an existing session —
   * it will just re-confirm auth cookies and return immediately.
   */
  async login(): Promise<void> {
    if (!this.username || !this.password) {
      this.username = this.username ?? (await this.io.prompt('Amazon email'));
      this.password = this.password ?? (await this.io.promptSecret('Amazon password'));
    }

    this.vlog('Provisioning cookies (fetching home page)...');
    await this.provisionCookies();
    this.vlog('Cookies provisioned.');

    this.vlog('Fetching sign-in page...');
    let page: PageResponse = await this.get(this.constants.SIGN_IN_URL, this.constants.SIGN_IN_QUERY_PARAMS);

    this.isAuthenticated = false;
    let formFound = false;
    let attempts = 0;

    while (!this.isAuthenticated && attempts < this.config.maxAuthAttempts) {
      this.vlog(`Checking auth state (attempt ${attempts + 1}/${this.config.maxAuthAttempts})...`);
      const hasSignOutNav = page.html.includes('nav-item-signout');
      const hasSignInPrompt = page.html.includes('Hello, sign in');
      if ((await this.authCookiesStored()) || (!hasSignInPrompt && hasSignOutNav)) {
        this.isAuthenticated = true;
        break;
      }

      if (attempts > 0 && (!formFound || page.url.replace(/\/$/, '') === this.constants.BASE_URL)) {
        this.vlog('Re-fetching sign-in page...');
        page = await this.get(this.constants.SIGN_IN_URL, this.constants.SIGN_IN_QUERY_PARAMS);
      }
      formFound = false;

      this.vlog('Matching page against known auth forms...');
      const formResponse = await this.processForms(page);
      if (formResponse) {
        page = formResponse;
        formFound = true;
      }

      if (!formFound) {
        throw new AmazonOrdersAuthError(
          `This is an unknown page, or its parsed contents don't match a known auth flow: ${page.url}`,
        );
      }

      attempts += 1;
    }

    if (!this.isAuthenticated) {
      throw new AmazonOrdersAuthError(
        'Authentication attempts exhausted. If your email/password are correct, Amazon may be presenting a ' +
          'challenge this library does not recognize.',
      );
    }
  }

  async logout(): Promise<void> {
    await this.get(this.constants.SIGN_OUT_URL);
    this.clearSession();
  }

  /**
   * Every parsed request should be run through this: throws AmazonOrdersAuthRedirectError (and
   * clears the session) if Amazon bounced us back to login — the caller must re-run login()
   * to continue; this library never retries authentication unattended.
   */
  checkResponse(result: RequestResult, meta?: Record<string, unknown>): void {
    if (result.status >= 400) {
      throw new AmazonOrdersError(`The page ${result.url} returned ${result.status}.`, meta);
    }

    const onSignIn = result.url.startsWith(this.constants.SIGN_IN_URL);
    const hasSignInForm = selectOne(result.$, result.$.root().get(0)!, sel.SIGN_IN_FORM_SELECTOR) !== null;
    if (onSignIn || hasSignInForm) {
      this.clearSession();
      throw new AmazonOrdersAuthRedirectError(
        'Amazon redirected to login — the session has expired. Re-run login() to reauthenticate.',
        meta,
      );
    }
  }

  /**
   * Tries each auth form/blocker against `page`; runs the matched one's fill+submit and returns
   * the resulting page, or null if nothing matched. Blockers (ACIC/JS-challenge detection) throw
   * directly from `select()`, so calling this is also how those get a chance to fire — including
   * on unauthenticated pages, where Amazon can present a bot challenge before login even starts.
   *
   * If a blocker throws AmazonOrdersBrowserChallengeError and `browserFallback` is enabled, this
   * drives a real (Playwright) browser through `page.url` once to clear the challenge, copies the
   * resulting cookies into the jar, and retries the SAME url via plain HTTP — once only, so a
   * challenge the browser fallback can't clear either still surfaces as a real error rather than
   * looping.
   */
  private async processForms(page: PageResponse): Promise<PageResponse | null> {
    try {
      const matched = this.authForms.find((form) => form.select(page));
      if (!matched) return null;
      this.vlog(`Matched ${matched.constructor.name} — filling...`);

      await matched.fill(this);
      this.vlog(`${matched.constructor.name} filled — submitting...`);
      const result = await matched.submit(page, this);
      this.vlog(`${matched.constructor.name} submitted.`);
      return result;
    } catch (err) {
      if (err instanceof AmazonOrdersBrowserChallengeError && this.config.browserFallback) {
        this.io.echo(`${err.message}\nAttempting the browser fallback...`);
        await bootstrapCookiesViaBrowser(page.url, this.cookieJar, this.config.browserHeadless);
        this.persistCookies();
        return this.get(page.url);
      }
      throw err;
    }
  }

  private async provisionCookies(): Promise<void> {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500));

      this.vlog(`Fetching home page (provisioning attempt ${attempt + 1}/${maxAttempts})...`);
      let page: PageResponse = await this.get(this.constants.BASE_URL);
      const formResponse = await this.processForms(page);
      if (formResponse) page = formResponse;

      const badIndex = selectOne(page.$, page.$.root().get(0)!, sel.BAD_INDEX_SELECTOR);
      if (!badIndex) return;
      this.vlog('Got a bad-index (mobile) page — retrying...');
    }

    throw new AmazonOrdersAuthError(
      'Amazon is not returning a parsable home page after repeated attempts. This IP may be flagged as a bot.',
    );
  }
}

export type { Root, PageResponse };
