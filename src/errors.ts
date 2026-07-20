export class AmazonOrdersError extends Error {
  meta?: Record<string, unknown>;

  constructor(message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'AmazonOrdersError';
    this.meta = meta;
  }
}

/** Raised when Amazon presents an OTP/2FA, captcha, or JS/bot challenge that needs surfacing to the caller. */
export class AmazonOrdersAuthError extends AmazonOrdersError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'AmazonOrdersAuthError';
    this.meta = meta;
  }
}

/**
 * Raised when a previously authenticated session redirects back to login (cookies expired).
 * Callers must re-run interactive login — this library never retries auth unattended.
 */
export class AmazonOrdersAuthRedirectError extends AmazonOrdersAuthError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'AmazonOrdersAuthRedirectError';
    this.meta = meta;
  }
}

/**
 * Raised specifically by the ACIC/JS-bot blockers when Amazon serves a JavaScript-based
 * challenge (e.g. an AWS WAF challenge) that plain HTTP can't solve. Distinct from the base
 * AmazonOrdersAuthError so callers (and AmazonSession's own optional browser fallback) can
 * catch this specific case without swallowing unrelated auth failures like a wrong password.
 */
export class AmazonOrdersBrowserChallengeError extends AmazonOrdersAuthError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'AmazonOrdersBrowserChallengeError';
    this.meta = meta;
  }
}

export class AmazonOrdersNotFoundError extends AmazonOrdersError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'AmazonOrdersNotFoundError';
    this.meta = meta;
  }
}

/** Raised when a selector fails to match required markup — always includes the field name. */
export class AmazonOrdersParseError extends AmazonOrdersError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'AmazonOrdersParseError';
    this.meta = meta;
  }
}
