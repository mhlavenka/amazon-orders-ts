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
    ...overrides,
  };
}
