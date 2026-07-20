function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Adds (or, if negative, subtracts) `n` business days (Sat/Sun skipped; no holiday calendar). */
export function addBusinessDays(date: Date, n: number): Date {
  const d = new Date(date);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    if (!isWeekend(d)) remaining -= 1;
  }
  return d;
}

function parseIsoDateUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** True if `amazonDate` falls within [bankDate - 1 business day, bankDate + 4 business days]. */
export function withinMatchWindow(bankDateIso: string, amazonDateIso: string): boolean {
  const bank = parseIsoDateUtc(bankDateIso);
  const lo = addBusinessDays(bank, -1);
  const hi = addBusinessDays(bank, 4);
  const az = parseIsoDateUtc(amazonDateIso);
  return az.getTime() >= lo.getTime() && az.getTime() <= hi.getTime();
}

export function dayDistance(aIso: string, bIso: string): number {
  return Math.abs(parseIsoDateUtc(aIso).getTime() - parseIsoDateUtc(bIso).getTime());
}
