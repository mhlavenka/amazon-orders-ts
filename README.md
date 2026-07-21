# amazon-orders-ts

Fetch Amazon order & transaction history and match it against your bank transactions — built for
personal finance reconciliation (e.g. [LedgerNest](https://github.com/mhlavenka/ledgerNest)).
Plain HTTP by default; falls back to a real (Playwright) browser only if Amazon serves a
JS-based bot challenge it can't otherwise clear.

This is a **TypeScript port of the login flow and page-parsing approach** from the Python
[`amazon-orders`](https://github.com/alexdlaird/amazon-orders) project by Alex Laird (MIT
licensed — see [NOTICE](./NOTICE)). Only what's needed for reconciliation was ported:
session/login, transaction history (card charges), and order history (order numbers + line
items). Returns, invoices, Whole Foods orders, and the full order-details field set (subtotal,
tax breakdown, gift cards, promotions, etc.) are intentionally **not** ported — out of scope for
matching bank transactions to orders.

Defaults to **amazon.ca**, configurable via `domain`.

## Status / scope notes

- **Fully verified against a live amazon.ca account and a real bank statement (2026-07-20)**:
  real login, real transaction/order history, real item-name parsing, and real matching all
  confirmed working end-to-end. Login itself is 100% plain HTTP; a browser only ever bootstraps
  past a JS/bot challenge if one appears (see "Browser fallback" below), then hands straight back
  to the normal HTTP flow for everything else — orders, transactions, matching.
- This library never auto-solves visual/text captchas. If Amazon presents an actual CAPTCHA
  during sign-in, it's surfaced to you interactively (or, for a JS-rendered interactive one that
  has no static text/image, via the browser fallback in `--headed` mode so you can solve it
  yourself).
- Login is always interactive and is never retried unattended: if your session expires,
  every call fails fast with an error telling you to re-run `login`.
- **`getItemCategory` (product-page category breadcrumb) is new and not yet verified against a
  live account** — everything else above has been confirmed end-to-end against real amazon.ca
  data; this one selector (`#wayfinding-breadcrumbs_feature_div`) is Amazon's standard, widely
  documented product-page structure but hasn't been spot-checked live yet. Treat it as
  best-effort until it has (it already fails soft — returns `null` rather than throwing).

### Browser fallback (optional)

If Amazon serves a JS/bot challenge (like the AWS WAF one above) that plain HTTP can't solve,
`AmazonSession` can drive a real Chromium browser through Playwright to clear it, then copy the
resulting cookies back into the normal HTTP session — confirmed working against the live
challenge above. Playwright is an **optional peer dependency**, not installed by default:

```bash
npm install playwright
npx playwright install chromium
```

With that installed, the fallback triggers automatically (`config.browserFallback` defaults to
`true`) — no code changes needed. Without it, the original clear error is thrown instead, telling
you how to enable it. `amazon-orders-ts login --headed` runs the fallback browser visibly instead
of headless (`--no-browser-fallback` disables it entirely).

## Install

```bash
npm install amazon-orders-ts
```

Requires Node **>=22.5.0** (uses the built-in `node:sqlite` module for the match store — no
native/C++ build step needed to install this package).

## Quick start (library)

```ts
import { AmazonSession, getTransactionHistory, getOrderHistory } from 'amazon-orders-ts';

const session = new AmazonSession({ domain: 'amazon.ca' }); // prompts for email/password/OTP on first run
await session.login(); // persists cookies to ~/.ledgernest/amazon/cookies.json

const transactions = await getTransactionHistory(session, { days: 90 });
const orders = await getOrderHistory(session, { year: 2026 }); // add fullDetails: true for items on cancelled/partial orders
```

Re-running `session.login()` reuses the persisted cookie jar; if it's stale, `checkResponse()`
throws `AmazonOrdersAuthRedirectError` telling you to log in again — it will not retry silently.

### Item category (optional, one extra request per new item)

Neither `getTransactionHistory` nor `getOrderHistory` carries a product category — the order
list and an order's own details page only ever have title/price/quantity. The real category
(e.g. `Industrial & Scientific › Test, Measure & Inspect › Pressure & Vacuum › Pressure & Vacuum
Gauges › Pressure Switches`) lives on the item's own product page, so getting it means one more
fetch per item — `getItemCategory` does that fetch and returns the breadcrumb, root-first:

```ts
import { getItemCategory } from 'amazon-orders-ts';

const item = order.items[0]; // { title, asin, link, price, quantity }
const breadcrumb = item.link ? await getItemCategory(session, item.link) : null;
// breadcrumb -> ["Industrial & Scientific", "Test, Measure & Inspect", ...] or null
```

A product's category never changes, so a host app should cache the result by `asin` (including a
`null`/empty result, so a page that doesn't parse isn't retried on every run) rather than call
this on every lookup. Best-effort like everything else here: resolves to `null` instead of
throwing if the page can't be fetched or no breadcrumb is found.

## CLI (thin wrapper for manual testing)

```bash
npx amazon-orders-ts login                          # interactive: email, password, OTP if prompted
npx amazon-orders-ts match --csv bank.csv --months 3 # fetches + matches + saves + prints a report
npx amazon-orders-ts report --format json            # re-prints the last report (json|table)
```

`match` accepts our own `id,date,description,amount,currency` schema (see
[`samples/bank-sample.csv`](./samples/bank-sample.csv)) or common real export headers —
column matching is case/whitespace-insensitive with synonyms (e.g. MBNA's
`Posted Date,Payee,Address,Amount`, no `id`/`currency` columns, `MM/DD/YYYY` dates all work
as-is). See `src/cli/bankCsv.ts` for the exact synonym list.

## Smoke test first (before trusting the parsers)

Per the porting plan, verify the real markup before relying on this. Worked example — build the
CLI, log in, then run `match` against a real card statement CSV (any bank/card export works, not
just our own sample schema — see the column-synonym note above). Output shown is illustrative,
not a real run:

```bash
npm run build
node dist/cli/index.js login
--> Amazon email: you@example.com
--> Amazon password: ************
Logged in and saved session to /home/you/.ledgernest/amazon/cookies.json

node dist/cli/index.js match --csv examples/your-statement.csv --months 1
Loaded 11 bank rows from examples/your-statement.csv
Fetching ~1 month(s) of Amazon transaction history...
Fetched 9 Amazon transactions.
Fetching 2026 order history (for item names)...
Fetched 6 orders.

Matches (7)
  [high/exact] AMAZON.CA* AB1CD23EF TORONTO ON -26.47  <-  111-1111111-1111111
      items: USB-C Cable, Kitchen Sponges
  ...
```

If `login` fails, the error names which step of the flow it broke on (sign-in form, MFA, captcha,
or a JS/bot challenge — see "Browser fallback" above if it's the latter). If `match` runs but the
report looks wrong, capture the page HTML by adjusting `AmazonSession.request()` to dump
`result.html` for the transaction/order pages and compare against `src/auth/selectors.ts` —
`AmazonOrdersParseError` names the exact field that failed to parse.

Real-world note: real bank/card exports rarely match any invented schema, and Amazon's own
descriptor text varies more than you'd expect — `src/cli/bankCsv.ts`'s column matching and
`matching/filter.ts`'s `DEFAULT_AMAZON_DESCRIPTOR_PATTERNS` were both broadened after testing
against a real MBNA statement (`Posted Date,Payee,Address,Amount`, plain `AMAZON*` descriptors
with no `.CA`). If your bank's format or descriptor style trips up either one, that's a real gap
worth fixing the same way, not a one-off workaround.

## Matching engine (pure, no network)

```ts
import { matchTransactions } from 'amazon-orders-ts/matching';

const report = matchTransactions(bankTxns, amazonTxns);
// report.matches        — [{ bankTxnId, amazonTxnIds, confidence: 'high'|'medium'|'low', pass }]
// report.reviewQueue     — ambiguous bank rows the algorithm wouldn't guess on
// report.unmatchedBank   — Amazon-descriptor bank rows with no match
// report.unmatchedAmazon — Amazon transactions with no bank match (often gift-card-funded)
```

Matching runs three passes: exact amount+date, tie-break (closest date, then an order-number
fragment in the bank descriptor), then a combination pass for split-shipment charges (subsets of
up to 3 same-order Amazon transactions). It's a pure function of its inputs — persisting results
via `MatchStore` (`node:sqlite`-backed, keyed by `(bankTxnId, amazonTxnId)`) is naturally
idempotent across re-runs.

### One transaction at a time (the LedgerNest integration shape)

The batch `matchTransactions()` above is what the CLI/web tester use, but a host app like
LedgerNest typically has one register row in hand and wants "does this match an Amazon charge,
and what did I buy?" — `findAmazonMatchForTransaction` wraps the same engine for that:

```ts
import { findAmazonMatchForTransaction, type MatchStore } from 'amazon-orders-ts/matching';

// amazonTxns/orders fetched once (e.g. daily) via getTransactionHistory()/getOrderHistory() and
// cached; store is the same MatchStore used to persist results, so already-matched Amazon
// transactions are excluded before each lookup — otherwise one Amazon charge could satisfy two
// different bank rows.
const pool = store.filterUnconsumed(amazonTxns);
const result = findAmazonMatchForTransaction(bankTxn, pool, orders);

if (result.matched) {
  // result.items -> ["USB-C Cable", "Kitchen Sponges"], result.isRefund, result.confidence, ...
  // result.matchedItems -> same items with { title, asin, link } — feed to getItemCategory() above
  // for a real category instead of guessing from the title text.
  store.saveMatches([{ bankTxnId: bankTxn.id, amazonTxnIds: result.amazonTxnIds, confidence: result.confidence!, pass: result.pass! }]);
} else if (result.ambiguousCandidates) {
  // multiple equally-plausible Amazon transactions — surface for manual review, don't guess
}
```

### Try the matching engine in a browser

No Amazon login needed — paste a bank CSV and an Amazon-transactions JSON and see the report
rendered as tables:

```bash
npm run demo:web
# open http://localhost:4321 — sample data loads automatically
```

See [`examples/web-tester`](./examples/web-tester) (a ~150-line dependency-free Node `http`
server + single static HTML page).

## Development

```bash
npm install
npm test        # vitest — matching unit tests + parser tests against real HTML fixtures
npm run build   # tsc -> dist/
```

`reference/` (gitignored) is a local clone of the Python project used as the porting spec — see
`amazon-orders/PORTING-NOTES` in commit history, or just `git clone
https://github.com/alexdlaird/amazon-orders reference` if you need to re-check something against
the original source.

## License

MIT — see [LICENSE](./LICENSE). Portions of the login-flow and parsing approach are ported from
[`amazon-orders`](https://github.com/alexdlaird/amazon-orders) (MIT, Alex Laird) — see
[NOTICE](./NOTICE).
