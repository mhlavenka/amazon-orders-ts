# PROGRESS.md

Session log for amazon-orders-ts. Read this first on resume; continue without asking for a recap.

## 2026-07-20 — Initial build

Repo created standalone (not a subdir of ledgerNest) per decision: separate public GitHub repo
`mhlavenka/amazon-orders-ts`, consumed by ledgerNest's backend via a git dependency
(`github:mhlavenka/amazon-orders-ts#main`) rather than npm publish or a submodule — simplest for
a personal, evolving package with no publish-step friction.

**Done, in order:**
1. Cloned `alexdlaird/amazon-orders` (Python) into `reference/` (gitignored) and read
   `session.py`, `forms.py`, `constants.py`, `selectors.py`, `orders.py`, `transactions.py`,
   `entity/{order,item,transaction,parsable}.py`, `util.py`, `conf.py`, `exception.py` — this was
   the spec for the port, not code to reuse directly.
2. Scaffolded the package: `package.json` (CJS build, `bin` for the CLI, `exports` map for `.`
   and `./matching`), strict TS config, MIT `LICENSE` + `NOTICE` (attribution to the Python
   project per its MIT terms).
3. Ported the auth/login state machine (`src/auth/*`): cookie jar via tough-cookie, manual
   redirect-following (verified experimentally that Node's `fetch`/undici returns a real,
   non-opaque response for `redirect: 'manual'` even outside no-cors mode — confirmed via a quick
   `http://github.com` redirect test — so intermediate-hop `Set-Cookie` headers are actually
   captured, which fetch's auto-follow would have silently dropped). Login forms ported 1:1
   structurally (SignIn/Claim/Intent/MfaDeviceSelect/Mfa/Captcha + two bot-challenge blockers);
   no captcha auto-solve, no Playwright fallback — both explicitly out of scope, blockers throw a
   clear "would need a real browser, not implemented" error instead.
4. Ported parsers (`src/parsing/*`) for order history/details and transaction history, narrowed
   to order number + placed date + grand total + items (dropped the ~15 full-details-only fields
   the Python `Order` class has — subtotal, tax, gift cards, Whole Foods, cancelled-order
   fallbacks, etc.). Copied real (sanitized) HTML fixtures from the Python project's own test
   suite (`reference/tests/resources/`) into `test/fixtures/` and wrote parser tests against them
   — one transaction fixture already happened to use `.ca`-formatted currency (`CA$45.19`),
   reassuring but **not a substitute for testing against a real live amazon.ca session** (not yet
   done — see CLAUDE.md "Known gaps").
5. Built the matching engine (`src/matching/*`) — pure functions, 3 passes (exact → tie-break →
   combination), `MatchStore` for idempotent persistence. Originally speced with `better-sqlite3`,
   but that requires node-gyp/VS C++ build tools which this Windows machine doesn't have fully
   set up (`npm install` failed on native compile) — switched to Node's built-in `node:sqlite`
   (stable since Node 22.5) instead, which needs zero native compilation and bumped the package's
   Node floor to `>=22.5.0`. Had to load it via `require('node:sqlite')` rather than a static
   `import` because esbuild (used by vitest/vite-node) doesn't yet recognize it as a builtin and
   mis-rewrites the specifier — see the comment in `matching/store.ts`.
6. Built the CLI (`login`/`match`/`report`) and `samples/bank-sample.csv`.
7. Built `examples/web-tester/` (plain `node:http`, no framework) so the matching engine can be
   exercised in a browser without any Amazon login — paste/load a bank CSV + Amazon-transactions
   JSON, see matches/review-queue/unmatched rendered as tables. Sample data
   (`samples/amazon-transactions-sample.json`) deliberately covers all four outcomes (exact,
   combination, review-queue ambiguity, unmatched-Amazon "gift card" case) — verified via a
   scratch script before wiring the UI around it.
8. **Real-data test**: user dropped a real MBNA card statement CSV (filename redacted here —
   gitignored, never committed) into `examples/` for local testing. Two real findings from it:
   - The CSV loader only understood our own invented `id,date,description,amount,currency`
     schema. Rewrote `src/cli/bankCsv.ts` to match column names case/whitespace-insensitively
     with synonyms (`Posted Date`/`Payee`/`Amount` etc.) and accept `MM/DD/YYYY` dates, since real
     exports never match an invented schema exactly. This is a genuine capability, not a
     one-off — kept in the library.
   - The default Amazon-descriptor regex list missed real statement text: `AMAZON* <code>
     VANCOUVER BC` (no `.CA`) is common alongside `AMAZON.CA* ...`. Broadened
     `DEFAULT_AMAZON_DESCRIPTOR_PATTERNS` to word-boundary `/\bAMAZON\b/i` + `/\bAMZN\b/i` instead
     of enumerating exact substrings. Re-verified: 10/11 real rows now correctly identified as
     Amazon (only the genuine `PAYMENT` row excluded) — up from 4/11 before the fix.
   - The statement also contains real purchase→refund pairs (same payee/amount, opposite sign,
     later date) — confirms the matching engine's sign-exact comparison (not absolute value) is
     the right call; no code change needed there, already correct by construction.
9. **API shape correction mid-build**: user clarified LedgerNest's real integration is "one bank
   row at a time, find the matching Amazon transaction and what it was" — not primarily the
   batch `matchTransactions()` call. Added `src/matching/lookup.ts`
   (`findAmazonMatchForTransaction`) as a thin wrapper: runs the same engine scoped to one bank
   row, resolves item titles from `orders`, flags `isRefund`. Added
   `MatchStore.filterUnconsumed()` so repeated single-row calls against a shrinking pool don't
   double-match the same Amazon charge. Factored `itemTitlesForOrder` out of `cli/report.ts` into
   `matching/items.ts` so both share it. This is the primary documented usage pattern in
   `README.md` now ("One transaction at a time").

**Verification state:** 35 vitest tests passing, `tsc --noEmit` clean, `npm run build` clean, CLI
`--help` and the web tester both smoke-tested manually. Pushed to
https://github.com/mhlavenka/amazon-orders-ts (public) and wired into ledgerNest's
`backend/package.json` as `"amazon-orders-ts": "github:mhlavenka/amazon-orders-ts#main"` (had to
add a `prepare: npm run build` script — npm doesn't build git dependencies without one, so the
first install shipped raw TS source with no `dist/`; fixed and confirmed a clean reinstall
produces `dist/`).

10. **Real amazon.ca login smoke test — ATTEMPTED, BLOCKED.** User ran `login` themselves (their
    own terminal, own credentials — never passed through the assistant). Result: `AmazonSession`
    got as far as fetching the home page and immediately hit a real, live **AWS WAF JavaScript
    challenge** (`awswaf.com/challenge.js` + `window.gokuProps`, confirmed via a local debug
    script dumping the raw HTML). This is a client-side JS puzzle — solvable only by executing
    real JavaScript (a real browser) or a paid CAPTCHA-solving service; genuinely not solvable
    over plain HTTP. This is exactly why the upstream Python project ships optional
    `contrib/waf/{anticaptcha,capsolver,twocaptcha}.py` solver integrations and a Playwright
    fallback — this isn't a bug in the port, it's the same wall the original project exists to
    work around.
    - **Bug found and fixed along the way:** `AmazonSession.provisionCookies()` never ran the
      auth-form/blocker checks against the home page response — the Python source's
      `_provision_cookies` explicitly does ("we process forms just in case Amazon presents a
      Captcha challenge on unauthenticated URLs"), and that call was dropped during the port.
      Result: the WAF challenge page surfaced as a confusing "unknown page" error instead of the
      intended clear "JS-based bot challenge, can't solve it" one. Fixed by factoring form
      processing into `processForms()` and calling it from both `login()` and
      `provisionCookies()`. Verified fixed: re-ran with dummy credentials (blocker fires before
      credentials are ever checked) and got the correct `AmazonOrdersAuthError` message instead.
    - **Not yet resolved:** the WAF challenge itself. This blocks `login()` (and therefore
      everything downstream: `match`, `getOrderHistory`, `getTransactionHistory`) until either
      (a) tried from a different network in case this one's flagged, (b) a captcha-solving
      service is integrated, or (c) Playwright is added to execute the real challenge. This is a
      genuine architectural fork — flagged to the user, not decided unilaterally.

11. **WAF challenge resolved.** User confirmed the same challenge on a mobile hotspot too, ruling
    out IP-reputation — pointed at TLS-fingerprint-based bot detection (Node's TLS stack can't
    mimic a real browser's, no matter the headers), which only a real browser's own network stack
    fixes. User chose Playwright over a captcha-solving service. Added `browserBootstrap.ts`: on
    an `AmazonOrdersBrowserChallengeError`, launch a real Chromium (optional peer dep, lazy
    `require()` so it's not a hard dependency), navigate to the challenged URL, poll until the
    challenge markup is gone (NOT `networkidle` — the challenge script's own polling keeps that
    from ever firing), copy cookies into the jar, hand back to plain HTTP. Verified in an isolated
    scratch dir against the live challenge: headless Chromium cleared it fine (no headless-
    detection issue), got a real `aws-waf-token` cookie, and a plain-HTTP re-fetch with those
    cookies came back 200 with the real ~1MB homepage instead of the 2KB challenge stub.
    - **Privacy incident, self-caused:** while writing this feature's test fixtures, real data
      from the user's actual MBNA statement (a merchant code, city, date, amount) got copied into
      `test/cli/bankCsv.test.ts` instead of fictional placeholders, and pushed to the public repo;
      PROGRESS.md also referenced the statement's filename (containing the card's last 4 digits).
      Both fixed going forward (fictional data now). User was informed and explicitly chose to
      leave the old commits as-is rather than rewrite history — don't revisit this without them
      raising it.
    - With the fallback working, login still failed with a confusing "unknown page" error — this
      time for `/ap/signin` itself (a 404), not the WAF challenge. Traced to `openid.assoc_handle`:
      the Python source hardcodes `usflex` (US-specific); amazon.ca needs `caflex`. Found by using
      the now-working Playwright browser to click amazon.ca's real "Sign in" link and reading the
      handle off the resulting URL. Fixed via a `REGION_ASSOC_HANDLES` map in `constants.ts`.
      **Verified end-to-end with dummy credentials**: full flow now clears the WAF challenge,
      finds and fills the real sign-in form, submits it, and gets back Amazon's own "Your password
      is incorrect" — confirms the chain works up to actual credential validation.

12. **Real login attempt hung indefinitely (several minutes, Ctrl+C unresponsive) even with the
    request-timeout fix from #11.** User declined to share real credentials for the assistant to
    reproduce directly (right call — no `.env` workaround, kept the "never handle a real password"
    boundary). Diagnosed via a `config.verbose` flag added specifically for this (echoes each
    fetch/form-match step): the hang was actually in **two separate bugs**, found in order:
    - `io.ts`'s password masking manually toggled stdin raw mode, while the OTP prompt right after
      used a separate `readline.Interface` — reproduced in isolation (piped input): after a masked
      password prompt, a subsequent readline-based prompt never received further input at all.
      Rewrote to use one persistent `readline.Interface` for every prompt, masking via the
      standard `_writeToOutput` intercept technique instead of raw mode. (Also: `AmazonSession`
      constructs a `ConsoleIO` by default even for non-interactive commands, so the interface is
      now lazy — created on first prompt only — plus `AuthIO.close()` so the CLI can release
      stdin; otherwise even `match` would hang open forever after finishing.)
    - **The real one**: `JsAuthBlocker`'s regex (`[.\s\S]*X[.\s\S]*Y[.\s\S]*`) is catastrophically
      slow — didn't finish in 30+ seconds against a plain 1MB string in isolated timing. cheerio's
      `.text()` includes embedded `<script>`/JSON content, so a real ~1MB Amazon page hit this on
      *every* page load, non-deterministically depending on content (explains why some earlier
      dummy-credential runs finished fast and this one didn't). Replaced with two `.includes()`
      checks. Also added a body-read timeout (`fetch()`'s own `AbortSignal` only bounds getting
      the response, not reading the body after — a stalled/truncated body had zero protection).
    - With both fixed, a full dummy-credential run completes in seconds through cookie
      provisioning → sign-in → claim/redirect, and hits a new, well-defined wall: an **interactive
      visual CAPTCHA** (`WAF_ADVERSARIAL_SYNTHETIC_GRID_V2_LEVEL_2`, no static image/text, JS-
      rendered) on a post-signin verification step. Wired into the existing browser fallback:
      `browserBootstrap.ts` now injects the session's existing cookies into the Playwright context
      first (this challenge is mid-flow, tied to cookies already established over HTTP — unlike
      the anonymous home-page WAF gate, a fresh browser context won't do), non-headless wait
      raised to 180s (this challenge type likely needs an actual human to click through it, not
      just a real browser engine), and `CaptchaForm` distinguishes this case (via the
      `#cvf-aamation-container` marker) from a genuine selector mismatch.

13. **Real login confirmed working end-to-end.** User ran plain `login` (no `--headed` needed) —
    succeeded first try, no CAPTCHA, no hang: "Logged in and saved session to
    ~/.ledgernest/amazon/cookies.json". Confirms the interactive CAPTCHA in #12 was very likely
    triggered by the assistant's own repeated automated dummy-credential test attempts earlier in
    this session, not something a normal login hits. Login is now considered solid.

14. **`match` claimed "not logged in" right after a successful login, then a second `login`
    hit a fresh "unknown page" error.** Two bugs, same root shape as before:
    - `login()`'s docstring already claimed "safe to call again on an existing session — it will
      just re-confirm auth cookies and return immediately", but the implementation never actually
      did this: it always ran `provisionCookies()` (a fresh homepage fetch) before checking
      `authCookiesStored()`. Re-running `login()` on an already-valid session could disturb its
      cookies via that unnecessary fetch before ever confirming a login was even needed.
    - `match`'s own pre-check was a separate, unreliable heuristic: fetch the home page and guess
      "logged in?" from whether the markup happens to include "nav-item-signout" text.
    - Fixed by adding `AmazonSession.hasStoredSession()` (checks the persisted cookie jar only, no
      network) and using it in both places — `login()` now exits immediately if already
      authenticated, `match` checks stored-session validity directly.
    - With that in place, `hasStoredSession()` STILL returned false. Since this repo lives on the
      same machine/user as the person testing it, inspected their real persisted cookie jar file
      directly (safe — it holds only session tokens, never the password) instead of guessing:
      **same class of bug as the `assoc_handle` one.** `COOKIES_SET_WHEN_AUTHENTICATED` (ported
      from Python) checks for a cookie literally named `x-main` — the legacy `.com` name. A real
      successful login on amazon.ca produces `x-acbca`, `at-acbca`, `sess-at-acbca`, `sst-acbca`
      (region-suffixed scheme, "acbca" = amazon.ca's marketplace code) — never `x-main`. Added
      `REGION_AUTH_COOKIES` (`ca: 'x-acbca'`), alongside the existing `REGION_LANGUAGES`/
      `REGION_ASSOC_HANDLES` maps. Verified directly against the real cookie jar on disk:
      `hasStoredSession()` now correctly returns `true`.

15. **Full pipeline verified end-to-end against real data — the smoke test's original goal.**
    `match --csv <real MBNA statement> --months 1` ran clean: fetched 11 real Amazon transactions
    + 48 real orders (with correct real item titles — AirPods, a USB capture card, book titles,
    etc. — confirming `src/parsing/orders.ts`/`transactions.ts` parse real markup correctly), and
    produced 6 high-confidence exact matches against the real statement with items attached. The
    handful of "unmatched" rows all had mundane explanations, not bugs: 2 bank rows were just
    outside the `--months 1` fetch window (~30 days back from *today*, not from the statement's
    own date range); 2 Amazon transactions were genuinely too recent to be in the statement yet;
    2 pairs were a real near-miss (see #16 below).
16. **Match window widened from -1 to -3 business days (lower bound)**, per user's explicit choice
    after seeing the near-miss above: a refund's Amazon-side date was 2 business days before its
    bank posting date, just outside the original -1 bound. Purchases post to the bank quickly
    after Amazon; refunds evidently can lag more. `matching/dates.ts`'s `withinMatchWindow` and its
    tests updated accordingly.

**Not yet done / open:**
- If another region/TLD is ever added, remember it likely needs its OWN entries in all three
  region maps (`REGION_LANGUAGES`, `REGION_ASSOC_HANDLES`, `REGION_AUTH_COOKIES`) — three separate
  US-specific assumptions have now been found hardcoded from the Python source, each discovered
  the same way (inspect real markup/cookies from a live session), so don't assume amazon.ca's
  values (`caflex`, `x-acbca`) generalize to other TLDs.
- No CI workflow.

## 2026-07-21 — Item category (product-page breadcrumb)

LedgerNest's Amazon-item categorization was title-keyword guessing only (e.g. a pressure switch
had nothing to match on) — root cause: neither the order-history list nor an order's own details
page carries a category, only the item's own product page does (confirmed by grepping the
Python-port's reference HTML fixtures — the order-details breadcrumb present there is just
"Your Account › Your Orders" page-nav chrome, not a product category).

Added:
- `src/parsing/productCategory.ts` — `parseProductCategoryPage(html)`, reads
  `#wayfinding-breadcrumbs_feature_div` (Amazon's standard product-page breadcrumb container;
  `#wayfinding-breadcrumbs_container` as a fallback selector), returns the crumb list root-first
  or `null`.
- `src/productCategory.ts` — `getItemCategory(session, link)`, fetches the page and parses it;
  resolves to `null` (never throws) on any failure, matching this library's enrichment-not-
  requirement posture elsewhere.
- `AmazonOrderRef.items` (matching module) now carries `asin`/`link` alongside `title`, and
  `findAmazonMatchForTransaction`'s result gained `matchedItems` (same shape) so a caller can look
  up each matched item's own category page. `items: string[]` (titles only) kept as-is for
  back-compat.
- Exported `getItemCategory` / `parseProductCategoryPage` from the package root.

**Not yet verified against a live account** — everything else in this repo was fixed by iterating
against real amazon.ca responses; this selector hasn't had that pass yet. It's the standard,
widely-documented product-page structure, but treat it as unconfirmed until an actual live MBNA
import exercises it (LedgerNest caches by ASIN, so this only needs to work once per distinct item
to be useful going forward — see `AmazonItemCategory.model.ts` on the LedgerNest side).
