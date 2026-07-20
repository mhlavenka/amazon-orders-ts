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

**Not yet done / open:**
- **A real user login (actual credentials/OTP) hasn't been confirmed yet** — only tested with a
  deliberately-wrong dummy password, by design (the assistant should never handle a real
  password). This is the very next thing to check with the user.
- Everything downstream of login — `src/parsing/*`'s order/transaction parsers — is still
  unverified against live markup. Don't assume they're broken OR working; nobody's reached them
  yet with real data.
- No CI workflow.
