#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { AmazonSession } from '../auth/session';
import { defaultConfig } from '../config';
import { getTransactionHistory } from '../transactions';
import { getOrderHistory } from '../orders';
import { matchTransactions } from '../matching/match';
import { MatchStore } from '../matching/store';
import type { AmazonOrderRef, AmazonTransaction, BankTransaction } from '../matching/types';
import type { Order } from '../parsing/types';
import { loadBankCsv } from './bankCsv';
import { buildReportView, formatReportTable, type ReportView } from './report';
import { AmazonOrdersAuthRedirectError, AmazonOrdersError } from '../errors';

const program = new Command();
program.name('amazon-orders-ts').description('Fetch Amazon order/transaction history and match it against bank transactions.');

program
  .command('login')
  .description('Interactively log in to Amazon and persist the session cookie jar for later commands.')
  .option('--domain <domain>', 'Amazon domain', 'amazon.ca')
  .action(async (opts: { domain: string }) => {
    const session = new AmazonSession({ domain: opts.domain });
    await session.login();
    console.log(`Logged in and saved session to ${session.config.cookieJarPath}`);
  });

program
  .command('match')
  .description('Fetch Amazon transaction/order history and match it against a bank CSV export.')
  .requiredOption('--csv <path>', 'Path to a bank transactions CSV (columns: id,date,description,amount,currency)')
  .option('--months <n>', 'How many months of Amazon transaction history to fetch', '3')
  .option('--domain <domain>', 'Amazon domain', 'amazon.ca')
  .option('--order-year <year>', 'Year of order history to fetch (for item names in the report)', String(new Date().getFullYear()))
  .action(async (opts: { csv: string; months: string; domain: string; orderYear: string }) => {
    const bankTxns = loadBankCsv(opts.csv);
    console.log(`Loaded ${bankTxns.length} bank rows from ${opts.csv}`);

    const session = new AmazonSession({ domain: opts.domain });
    const authed = await session
      .get(session.constants.BASE_URL)
      .then((page) => {
        session.checkResponse(page);
        return page.html.includes('nav-item-signout');
      })
      .catch((err) => {
        if (err instanceof AmazonOrdersAuthRedirectError) return false;
        throw err;
      });
    if (!authed) {
      throw new AmazonOrdersError('Not logged in (or the session expired). Run `amazon-orders-ts login` first.');
    }
    session.isAuthenticated = true;

    const months = Number(opts.months);
    console.log(`Fetching ~${months} month(s) of Amazon transaction history...`);
    const amazonTxHistory = await getTransactionHistory(session, { days: Math.round(months * 30) });
    console.log(`Fetched ${amazonTxHistory.length} Amazon transactions.`);

    console.log(`Fetching ${opts.orderYear} order history (for item names)...`);
    const orders = await getOrderHistory(session, { year: Number(opts.orderYear) });
    console.log(`Fetched ${orders.length} orders.`);

    // Amazon's transaction rows have no stable ID of their own; synthesize one from fields that
    // together identify a specific charge, disambiguating true duplicates by their position.
    const seen = new Map<string, number>();
    const amazonTxns: AmazonTransaction[] = amazonTxHistory.map((t) => {
      const base = `${t.orderNumber ?? 'noorder'}:${t.completedDate}:${t.grandTotal}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { id: n === 0 ? base : `${base}#${n}`, date: t.completedDate, amount: t.grandTotal, orderNumber: t.orderNumber };
    });

    const orderRefs: AmazonOrderRef[] = orders
      .filter((o): o is Order & { orderNumber: string } => o.orderNumber !== null)
      .map((o) => ({ orderNumber: o.orderNumber, items: o.items.map((i) => ({ title: i.title })) }));

    const report = matchTransactions(bankTxns, amazonTxns);

    const store = new MatchStore(session.config.matchDbPath);
    store.saveMatches(report.matches);
    store.close();

    const amazonTxnsById = new Map(amazonTxns.map((t) => [t.id, t]));
    const bankTxnsById = new Map(bankTxns.map((t) => [t.id, t] as [string, BankTransaction]));
    const view = buildReportView(report, amazonTxnsById, bankTxnsById, orderRefs);

    fs.mkdirSync(session.config.configDir, { recursive: true });
    fs.writeFileSync(path.join(session.config.configDir, 'last-report.json'), JSON.stringify(view, null, 2));

    console.log('');
    console.log(formatReportTable(view));
    console.log('');
    console.log(`Saved to ${session.config.matchDbPath}. Re-view anytime with: amazon-orders-ts report`);
  });

program
  .command('report')
  .description('Re-print the report from the last `match` run.')
  .option('--format <format>', 'json or table', 'table')
  .action((opts: { format: string }) => {
    const config = defaultConfig();
    const reportPath = path.join(config.configDir, 'last-report.json');
    if (!fs.existsSync(reportPath)) {
      throw new AmazonOrdersError('No report found — run `amazon-orders-ts match` first.');
    }

    const view = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as ReportView;
    if (opts.format === 'json') {
      console.log(JSON.stringify(view, null, 2));
    } else {
      console.log(formatReportTable(view));
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
