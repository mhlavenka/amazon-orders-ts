import { describe, expect, it } from 'vitest';
import { parseBankCsvText } from '../../src/cli/bankCsv';

describe('parseBankCsvText', () => {
  it('parses our own sample schema (id,date,description,amount,currency)', () => {
    const csv = 'id,date,description,amount,currency\ntxn-1,2026-06-01,STARBUCKS,-4.85,CAD\n';
    expect(parseBankCsvText(csv)).toEqual([
      { id: 'txn-1', date: '2026-06-01', description: 'STARBUCKS', amount: -4.85, currency: 'CAD' },
    ]);
  });

  it('parses an MBNA-style export (Posted Date/Payee/Address/Amount, MM/DD/YYYY, no id/currency)', () => {
    const csv =
      'Posted Date,Payee,Address,Amount\n' +
      '01/15/2026,"AMAZON.CA* AB1CD23EF TORONTO ON","TORONTO ",-19.99\n' +
      '01/20/2026,"PAYMENT"," ",250.00\n';

    const rows = parseBankCsvText(csv);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: '2026-01-15',
      description: 'AMAZON.CA* AB1CD23EF TORONTO ON',
      amount: -19.99,
      currency: 'CAD',
    });
    expect(rows[0].id).toBe('row-1'); // no id column -> synthesized
    expect(rows[1]).toMatchObject({ date: '2026-01-20', description: 'PAYMENT', amount: 250.0 });
  });

  it('matches header names case- and whitespace-insensitively', () => {
    const csv = 'ID, Date , DESCRIPTION,Amount,Currency\nx1,2026-01-05,Foo,-1.5,USD\n';
    expect(parseBankCsvText(csv)[0]).toEqual({ id: 'x1', date: '2026-01-05', description: 'Foo', amount: -1.5, currency: 'USD' });
  });

  it('throws a clear error when no amount column matches', () => {
    const csv = 'date,description\n2026-01-01,Foo\n';
    expect(() => parseBankCsvText(csv)).toThrow(/amount/i);
  });

  it('throws a clear error for an unrecognized date format', () => {
    const csv = 'date,description,amount\nJan 1 2026,Foo,-1\n';
    expect(() => parseBankCsvText(csv)).not.toThrow(); // "Jan 1 2026" still parses via the Date() fallback

    const csvBad = 'date,description,amount\nnot-a-date,Foo,-1\n';
    expect(() => parseBankCsvText(csvBad)).toThrow(/Unrecognized date format/);
  });
});
