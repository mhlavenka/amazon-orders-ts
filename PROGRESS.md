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
8. **Real-data test**: user dropped a real MBNA card statement (`examples/Jul2026_9245.csv`,
   gitignored, never committed) for local testing. Two real findings from it:
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
`--help` and the web tester both smoke-tested manually.

**Not yet done:**
- Real amazon.ca login/parsing smoke test (needs the user's actual credentials/OTP — by design,
  login is always interactive and must be run by the user themselves, not by an agent).
- No CI workflow.
- Not yet wired into ledgerNest's backend as a git dependency (next step).
- Not yet pushed to GitHub (repo created locally; `gh repo create` + push still pending as of
  this entry — check `git remote -v` / `git log` to see if that's since been done).
