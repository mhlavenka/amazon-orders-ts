import os from 'node:os';
import path from 'node:path';

export interface AmazonOrdersConfig {
  /** Amazon domain or full base URL, e.g. "amazon.ca" or "https://www.amazon.ca". Defaults to amazon.ca. */
  domain: string;
  /** Directory where the cookie jar and other session state are persisted. */
  configDir: string;
  /** Path to the persisted cookie jar (tough-cookie serialized JSON). */
  cookieJarPath: string;
  /** Path to the SQLite match store used by the matching module's CLI. */
  matchDbPath: string;
  /** Max login attempts before giving up (mirrors amazon-orders' max_auth_attempts). */
  maxAuthAttempts: number;
  /**
   * If Amazon serves a JS/bot challenge (e.g. AWS WAF) plain HTTP can't solve, and Playwright is
   * installed (`npm install playwright && npx playwright install chromium` — it's an optional
   * peer dependency, not a hard one), automatically drive a real browser to clear it and copy
   * the resulting cookies back into the HTTP session. If Playwright isn't installed, the
   * original clear error is thrown instead — set this false to always throw immediately.
   */
  browserFallback: boolean;
  /** Whether the Playwright fallback browser runs headless. Some bot checks specifically target
   * headless fingerprints — set false to run a visible browser if headless fails to pass. */
  browserHeadless: boolean;
  /**
   * Per-request timeout in ms. Amazon (or a WAF/proxy in front of it) can silently hold a
   * connection open without ever responding to a suspicious-looking request instead of
   * rejecting it outright — without a timeout, that hangs `request()` forever with no error at
   * all. Fails loudly with the URL and duration instead.
   */
  requestTimeoutMs: number;
}

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.ledgernest', 'amazon');

export function defaultConfig(overrides: Partial<AmazonOrdersConfig> = {}): AmazonOrdersConfig {
  const configDir = overrides.configDir ?? DEFAULT_CONFIG_DIR;
  return {
    domain: 'amazon.ca',
    configDir,
    cookieJarPath: path.join(configDir, 'cookies.json'),
    matchDbPath: path.join(configDir, 'matches.sqlite'),
    maxAuthAttempts: 10,
    browserFallback: true,
    browserHeadless: true,
    requestTimeoutMs: 30_000,
    ...overrides,
  };
}
