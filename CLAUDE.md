# CLAUDE.md — amazon-orders-ts working notes

Standalone Node/TypeScript package: fetches Amazon order & transaction history over plain HTTP
(no browser automation) and matches it against bank transactions. Built as a dependency for
[LedgerNest](https://github.com/mhlavenka/ledgerNest) (personal finance app), but has no
LedgerNest-specific code — it's a generic library, published/consumed independently.

Authoritative background: `README.md`. Session-by-session history: `PROGRESS.md`.

## What this is

A TypeScript port of the **login flow and page-parsing approach** (not the code itself) from the
Python [`amazon-orders`](https://github.com/alexdlaird/amazon-orders) project (MIT, Alex Laird —
see `NOTICE`). Scope was deliberately narrowed to what reconciliation needs:

- **Ported:** session/login (incl. OTP/2FA, captcha surfacing, JS-bot-challenge detection),
  transaction history (card charges/refunds), order history (order number + placed date + grand
  total + item titles).
- **Not ported (intentionally out of scope):** returns, invoices, Whole Foods/FOPO orders, and
  most of `Order`'s "full details" fields (subtotal, tax breakdown, gift cards, shipping,
  promotions, cancelled-order edge cases). None of that is needed to match a bank charge to an
  order. See `src/auth/selectors.ts` and `src/parsing/orders.ts` top comments for exactly what
  was dropped.
- **Never implemented:** captcha auto-solving, browser automation (Playwright). If Amazon serves
  a JS-based bot challenge, `src/auth/forms.ts`'s `AcicAuthBlocker`/`JsAuthBlocker` throw a clear
  error explaining that would require driving a real browser — not built, since it hasn't been
  needed against amazon.ca yet.

Default domain is **amazon.ca** (configurable). Node **>=22.5.0** required — `matching/store.ts`
uses the built-in `node:sqlite` (stable since 22.5) specifically to avoid a native/node-gyp build
step for consumers.

## Layout

- `src/auth/` — `session.ts` (cookie jar via tough-cookie, manual redirect-following so
  intermediate-hop cookies aren't lost — see the comment in `session.ts` about why `redirect:
  'manual'` is used instead of fetch's auto-follow), `forms.ts` (the login state machine —
  SignIn/Claim/Intent/MfaDeviceSelect/Mfa/Captcha forms + the two bot-challenge blockers),
  `constants.ts` (domain-aware URLs/headers), `selectors.ts`, `io.ts` (interactive
  email/password/OTP prompts, masked password input).
- `src/parsing/` — `orders.ts`, `transactions.ts` (page parsers, cheerio-based), `parsable.ts`
  (the `simpleParse`/`required` helpers every field goes through — `required()` throws naming the
  field, per the "fail loudly" requirement).
- `src/orders.ts` / `src/transactions.ts` (top-level, not `parsing/`) — pagination/orchestration
  that combines a live `AmazonSession` with the pure parsers above.
- `src/matching/` — the pure, no-network matching engine. `match.ts` (3-pass algorithm: exact →
  tie-break → combination), `lookup.ts` (`findAmazonMatchForTransaction` — the one-row-at-a-time
  API LedgerNest actually calls), `store.ts` (`node:sqlite`-backed idempotent persistence),
  `filter.ts` (Amazon-descriptor regex list — broadened after real MBNA data showed bare
  `AMAZON*` with no `.CA`), `items.ts` (order → item-title lookup shared by `lookup.ts` and
  `cli/report.ts`).
- `src/cli/` — thin CLI (`login`/`match`/`report`) for manual testing before/without LedgerNest.
- `examples/web-tester/` — dependency-free `node:http` server + one static HTML page to exercise
  the matching engine in a browser with pasted CSV/JSON, no Amazon login needed
  (`npm run demo:web`).
- `samples/` — fictional sample data (`bank-sample.csv`, `amazon-transactions-sample.json`),
  safe to commit, used by the CLI/README/web-tester default demo.
- `reference/` (gitignored) — local clone of the Python project, used only as a reading reference
  when porting. Never committed. Re-clone with
  `git clone https://github.com/alexdlaird/amazon-orders reference` if needed again.

## Known gaps / next steps

- **The real amazon.ca smoke test hasn't been run yet.** Parsers were built from the Python
  project's selectors + its own real (sanitized) test fixtures — one of which (transactions)
  already happens to use `.ca`-formatted currency, which is reassuring but not a substitute for
  a live run. Before trusting this for real data: `npx amazon-orders-ts login` then `match` with
  a short `--months` window, and compare against what you see in the browser. If a selector
  breaks, `AmazonOrdersParseError` names the exact field that failed.
- Order-details full fetch (`--full-details` / `getOrderHistory({ fullDetails: true })`) is
  implemented but untested against real markup — same caveat as above.
- No CI workflow yet (`.github/workflows/` is empty) — add one before/at first npm publish.

## Working notes for future sessions

- `examples/*.csv` is gitignored — real bank/card statement exports get dropped there for local
  testing and must never be committed. `src/cli/bankCsv.ts`'s column-synonym matching (case/
  whitespace-insensitive, MM/DD/YYYY support) exists specifically because a real MBNA export
  (`Posted Date,Payee,Address,Amount`, no `id`/`currency`) was tested against it.
- When editing `src/auth/selectors.ts` or the parsers, cross-check against `reference/` (re-clone
  if it's not present) rather than guessing — that repo's own test fixtures under
  `reference/tests/resources/` are real (sanitized) Amazon HTML and several are already copied
  into `test/fixtures/`.
- Vitest + `node:sqlite`: esbuild (which vite-node uses) doesn't yet recognize `node:sqlite` as a
  builtin and mis-rewrites the specifier if imported via a static `import`. `matching/store.ts`
  loads it via `require('node:sqlite')` instead (with a `import type` for the type) — don't
  "clean this up" back to a static import without re-testing under vitest.
