// A tiny, dependency-free local server for trying out the matching engine in a browser —
// paste/edit a bank CSV and an Amazon-transactions JSON, click "Run matching", see the report.
// No Amazon login involved; this only exercises src/matching/*.
//
// Run with:  npx tsx examples/web-tester/server.ts
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { parseBankCsvText } from '../../src/cli/bankCsv';
import { matchTransactions } from '../../src/matching/match';
import { buildReportView } from '../../src/cli/report';
import type { AmazonTransaction, BankTransaction } from '../../src/matching/types';

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.PORT ?? 4321);

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function sendFile(res: http.ServerResponse, filePath: string, contentType: string): void {
  const body = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/') {
      sendFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/samples/bank.csv') {
      sendFile(res, path.join(ROOT, 'samples', 'bank-sample.csv'), 'text/plain; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/samples/amazon.json') {
      sendFile(res, path.join(ROOT, 'samples', 'amazon-transactions-sample.json'), 'application/json; charset=utf-8');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/match') {
      const body = JSON.parse(await readBody(req)) as { bankCsv: string; amazonJson: string };

      let bankTxns: BankTransaction[];
      let amazonTxns: AmazonTransaction[];
      try {
        bankTxns = parseBankCsvText(body.bankCsv);
      } catch (err) {
        sendJson(res, 400, { error: `Bank CSV: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
      try {
        amazonTxns = JSON.parse(body.amazonJson) as AmazonTransaction[];
      } catch (err) {
        sendJson(res, 400, { error: `Amazon transactions JSON: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }

      const report = matchTransactions(bankTxns, amazonTxns);
      const amazonTxnsById = new Map(amazonTxns.map((t) => [t.id, t]));
      const bankTxnsById = new Map(bankTxns.map((t) => [t.id, t]));
      const view = buildReportView(report, amazonTxnsById, bankTxnsById);

      sendJson(res, 200, view);
      return;
    }

    res.writeHead(404).end('Not found');
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Matching tester running at http://localhost:${PORT}`);
});
