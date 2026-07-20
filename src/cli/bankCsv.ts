import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import type { BankTransaction } from '../matching/types';

// Real bank/card exports never agree on header names or date format, so column lookup is
// case/space-insensitive with common synonyms, and dates accept either ISO or the MM/DD/YYYY
// style several Canadian card issuers (e.g. MBNA) export in.
const DATE_KEYS = ['date', 'posted date', 'postdate', 'transaction date'];
const DESCRIPTION_KEYS = ['description', 'payee', 'merchant', 'name'];
const AMOUNT_KEYS = ['amount', 'amt'];
const CURRENCY_KEYS = ['currency', 'ccy'];
const ID_KEYS = ['id', 'reference', 'ref'];

function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, ' ');
}

function lookup(row: Record<string, string>, keys: string[]): string | undefined {
  const normalized = new Map(Object.entries(row).map(([k, v]) => [normalizeKey(k), v]));
  for (const key of keys) {
    const value = normalized.get(key);
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

/** Normalizes "06/16/2026" (MM/DD/YYYY) to "2026-06-16"; passes through anything already ISO. */
function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const mdY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (mdY) {
    const [, mm, dd, yyyy] = mdY;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  throw new Error(`Unrecognized date format: "${raw}". Expected ISO (YYYY-MM-DD) or MM/DD/YYYY.`);
}

/**
 * Accepts columns id,date,description,amount,currency (our own sample format), or common bank/card
 * export headers — e.g. MBNA's "Posted Date,Payee,Address,Amount" — matched case-insensitively.
 */
export function parseBankCsvText(text: string): BankTransaction[] {
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];

  return rows.map((row, i) => {
    const id = lookup(row, ID_KEYS)?.trim() || `row-${i + 1}`;

    const amountRaw = lookup(row, AMOUNT_KEYS);
    const amount = Number(amountRaw);
    if (amountRaw === undefined || Number.isNaN(amount)) {
      throw new Error(`Bank CSV row ${i + 1} (id=${id}): "amount" column is missing or not a number: "${amountRaw}"`);
    }

    const dateRaw = lookup(row, DATE_KEYS);
    if (!dateRaw) {
      throw new Error(`Bank CSV row ${i + 1} (id=${id}): missing a date column (tried: ${DATE_KEYS.join(', ')}).`);
    }

    return {
      id,
      date: normalizeDate(dateRaw),
      description: lookup(row, DESCRIPTION_KEYS)?.trim() ?? '',
      amount,
      currency: lookup(row, CURRENCY_KEYS)?.trim() || 'CAD',
    };
  });
}

export function loadBankCsv(filePath: string): BankTransaction[] {
  return parseBankCsvText(fs.readFileSync(filePath, 'utf-8'));
}
