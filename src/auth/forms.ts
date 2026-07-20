import type { AnyNode } from 'domhandler';
import type { Cheerio } from 'cheerio';
import { selectOne, cleanupHtmlText, type Root } from '../html';
import * as sel from './selectors';
import type { Selector } from './selectors';
import { AmazonOrdersAuthError, AmazonOrdersBrowserChallengeError, AmazonOrdersError } from '../errors';
import type { AuthIO } from './io';

export interface PageResponse {
  url: string;
  html: string;
  $: Root;
}

/** What a form needs from the session to fill in credentials/OTP and to submit itself. */
export interface FormSubmitter {
  username?: string;
  password?: string;
  io: AuthIO;
  submitForm(method: string, url: string, data: Record<string, string>): Promise<PageResponse>;
}

function resolveFormAction(form: Cheerio<AnyNode>, currentUrl: string): string {
  const action = form.attr('action');
  if (!action) return currentUrl;
  if (action.startsWith('http')) return action;
  if (action.startsWith('/')) {
    const u = new URL(currentUrl);
    return `${u.protocol}//${u.host}${action}`;
  }
  return `${currentUrl.split('/').slice(0, -1).join('/')}/${action}`;
}

/** Base class for one step (a `<form>` or a page-content check) in the login state machine. */
export abstract class AuthForm {
  protected form: Cheerio<AnyNode> | null = null;
  protected data: Record<string, string> | null = null;

  constructor(
    protected readonly selector: Selector | Selector[] | null,
    protected readonly errorSelector: Selector = sel.DEFAULT_ERROR_TAG_SELECTOR,
    protected readonly critical = false,
  ) {}

  /** Returns true (and captures `this.form`) if this step applies to the current page. */
  select(page: PageResponse): boolean {
    if (!this.selector) return false;
    this.form = selectOne(page.$, page.$.root().get(0)!, this.selector);
    return this.form !== null;
  }

  protected fillInputs(additional: Record<string, string> = {}): void {
    if (!this.form) throw new AmazonOrdersError('select() must be called before fill().');
    this.data = {};
    this.form.find('input').each((_, input) => {
      const $input = this.form!.find(input);
      const name = $input.attr('name');
      if (name !== undefined) this.data![name] = $input.attr('value') ?? '';
    });
    Object.assign(this.data, additional);
  }

  abstract fill(submitter: FormSubmitter): Promise<void> | void;

  async submit(page: PageResponse, submitter: FormSubmitter): Promise<PageResponse> {
    if (!this.form || !this.data) throw new AmazonOrdersError('select()/fill() must be called before submit().');

    const method = (this.form.attr('method') ?? 'GET').toUpperCase();
    const url = resolveFormAction(this.form, page.url);
    const result = await submitter.submitForm(method, url, this.data);

    this.handleErrors(result, submitter.io);
    this.form = null;
    this.data = null;

    return result;
  }

  protected handleErrors(result: PageResponse, io?: AuthIO): void {
    const errorTag = selectOne(result.$, result.$.root().get(0)!, this.errorSelector);
    if (!errorTag) return;

    const message = `Error from Amazon: ${cleanupHtmlText(errorTag.text())}`;
    if (this.critical) throw new AmazonOrdersAuthError(message);
    io?.echo(message);
  }
}

export class SignInForm extends AuthForm {
  constructor(selector: Selector | Selector[] = sel.SIGN_IN_FORM_SELECTOR) {
    super(selector, sel.DEFAULT_ERROR_TAG_SELECTOR, true);
  }

  fill(submitter: FormSubmitter): void {
    this.fillInputs({
      email: submitter.username ?? '',
      password: submitter.password ?? '',
      rememberMe: 'true',
    });
  }
}

/** Amazon's alternate "confirm your identity" sign-in variant — same fields, different form selector. */
export class ClaimForm extends SignInForm {
  constructor() {
    super(sel.CLAIM_FORM_SELECTOR);
  }
}

/**
 * An informational "confirm intent" page with no credential fields to submit — within this
 * library's headless flow, encountering it is a terminal condition, so its message (rather
 * than a submitted response) becomes the raised error.
 */
export class IntentForm extends AuthForm {
  constructor() {
    super(sel.INTENT_FORM_SELECTOR, sel.INTENT_MESSAGE_SELECTOR, true);
  }

  fill(): void {
    this.data = {};
  }

  override async submit(page: PageResponse): Promise<PageResponse> {
    this.handleErrors(page);
    return page;
  }
}

export class MfaDeviceSelectForm extends AuthForm {
  constructor() {
    super(sel.MFA_DEVICE_SELECT_FORM_SELECTOR);
  }

  async fill(submitter: FormSubmitter): Promise<void> {
    this.fillInputs();
    const contexts = this.form!.find(sel.MFA_DEVICE_SELECT_INPUT_SELECTOR).toArray();
    const choices = contexts.map((el, i) => `${i}: ${this.form!.find(el).attr('value')?.trim() ?? ''}`);

    const answer = await submitter.io.prompt('Choose where you would like your one-time passcode sent', { choices });
    const index = parseInt(answer, 10);
    const chosen = this.form!.find(contexts[index]);
    this.data!.otpDeviceContext = chosen.attr('value') ?? '';
  }
}

export class MfaForm extends AuthForm {
  constructor(selector: Selector | Selector[] = sel.MFA_FORM_SELECTOR) {
    super(selector, sel.DEFAULT_ERROR_TAG_SELECTOR, true);
  }

  async fill(submitter: FormSubmitter): Promise<void> {
    this.fillInputs();
    const otp = await submitter.io.prompt('Enter the one-time passcode from your preferred 2FA method');
    this.data!.otpCode = otp;
    this.data!.rememberDevice = '';
    if (!('deviceId' in this.data!)) this.data!.deviceId = '';
  }
}

/**
 * A text captcha. This library never auto-solves captchas — the image URL (or, for the
 * "type this word" variant with no image, its pre-filled solution) is surfaced to the caller.
 */
export class CaptchaForm extends AuthForm {
  constructor(
    selector: Selector | Selector[] = sel.CAPTCHA_1_FORM_SELECTOR,
    errorSelector: Selector = sel.CAPTCHA_1_ERROR_SELECTOR,
    private readonly solutionAttrKey = 'cvf_captcha_input',
  ) {
    super(selector, errorSelector, false);
  }

  async fill(submitter: FormSubmitter): Promise<void> {
    this.fillInputs();

    const parent = this.form!.parent();
    const img = parent.find('img').first();
    const solutionInput = parent.find(`input[name='${this.solutionAttrKey}']`).first();

    let solution: string;
    if (img.length) {
      let imgUrl = img.attr('src') ?? '';
      if (!imgUrl.startsWith('http')) imgUrl = new URL(imgUrl, this.form!.attr('action') ?? '').toString();
      solution = await submitter.io.prompt(
        `Captcha challenge — open this image and enter the characters shown: ${imgUrl}`,
      );
    } else if (solutionInput.length) {
      solution = solutionInput.attr('value') ?? '';
    } else if (parent.find('#cvf-aamation-container').length) {
      // An interactive visual challenge (Amazon's "WAF_ADVERSARIAL_SYNTHETIC_GRID" CAPTCHA type),
      // rendered entirely by JS with no static image/text to solve — confirmed live. Genuinely
      // needs a real browser, and likely an actual human (it's specifically designed to detect
      // automated interaction, unlike the simpler token-based WAF gate at login's start).
      throw new AmazonOrdersBrowserChallengeError(
        "Amazon presented an interactive visual CAPTCHA (not a static image) that plain HTTP can't solve, and " +
          'likely needs a human to click through it. Install the optional browser fallback ' +
          '(`npm install playwright && npx playwright install chromium`) and run with `--headed` so you can ' +
          'solve it yourself in the browser window that opens.',
      );
    } else {
      throw new AmazonOrdersError(
        `CaptchaForm <img> or <input name='${this.solutionAttrKey}'> not found — check if Amazon changed their captcha flow.`,
      );
    }

    this.data![this.solutionAttrKey] = solution;
  }
}

/** Detects Amazon's JS-rendered ("Additional Customer Identity Challenge") bot check, which this HTTP-only library can't pass. */
export class AcicAuthBlocker extends AuthForm {
  constructor() {
    super(null);
  }

  override select(page: PageResponse): boolean {
    if (page.$(sel.ACIC_CHALLENGE_SELECTOR).length) {
      throw new AmazonOrdersBrowserChallengeError(
        'Amazon returned a JavaScript-based identity challenge (ACIC) that plain HTTP cannot solve. Install ' +
          'the optional browser fallback: `npm install playwright && npx playwright install chromium` — ' +
          'AmazonSession will then drive a real browser to clear this automatically. Without it, try again ' +
          'later or from a different network.',
      );
    }
    return false;
  }

  fill(): void {
    /* never reached — select() always throws or returns false */
  }
}

// Plain substring checks, not a regex: a `[.\s\S]*X[.\s\S]*Y[.\s\S]*`-shaped pattern is
// catastrophically slow on large inputs (backtracking-based engines like V8's try every split
// point for each greedy wildcard) — confirmed live: this didn't finish in 30+ seconds against a
// real ~1MB Amazon homepage's full text (cheerio's .text() includes embedded <script>/JSON
// content too, so "large" here is not a hypothetical edge case). Two .includes() calls do the
// same job in linear time.
function looksLikeJsRobotChallenge(text: string): boolean {
  return text.includes("verify that you're not a robot") && text.includes('Enable JavaScript');
}

/** Detects Amazon's "Enable JavaScript" bot-check interstitial. */
export class JsAuthBlocker extends AuthForm {
  constructor() {
    super(null);
  }

  override select(page: PageResponse): boolean {
    if (looksLikeJsRobotChallenge(page.$.root().text())) {
      throw new AmazonOrdersBrowserChallengeError(
        'Amazon returned a JavaScript-based bot challenge (e.g. an AWS WAF challenge) that plain HTTP cannot ' +
          'solve. Install the optional browser fallback: `npm install playwright && npx playwright install ' +
          'chromium` — AmazonSession will then drive a real browser to clear this automatically.',
      );
    }
    return false;
  }

  fill(): void {
    /* never reached */
  }
}

/** The ordered chain of steps tried against every page encountered during login. */
export function defaultAuthForms(): AuthForm[] {
  return [
    new ClaimForm(),
    new IntentForm(),
    new SignInForm(),
    new MfaDeviceSelectForm(),
    new MfaForm(),
    new CaptchaForm(),
    new CaptchaForm(sel.CAPTCHA_2_FORM_SELECTORS, sel.CAPTCHA_2_ERROR_SELECTOR, 'field-keywords'),
    new MfaForm(sel.CAPTCHA_OTP_FORM_SELECTOR),
    new AcicAuthBlocker(),
    new JsAuthBlocker(),
  ];
}
