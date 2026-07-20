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

// Widened from -1 to -3 business days after real statement data: a refund can show on Amazon's
// side up to a couple of days before the bank actually posts the credit (a purchase's bank post
// tends to follow Amazon closely, but a refund's does not) — a real -2-business-day gap between
// an Amazon refund and its bank posting fell just outside the original -1 bound.
const LOWER_BOUND_BUSINESS_DAYS = -3;
const UPPER_BOUND_BUSINESS_DAYS = 4;

/** True if `amazonDate` falls within [bankDate - 3 business days, bankDate + 4 business days]. */
export function withinMatchWindow(bankDateIso: string, amazonDateIso: string): boolean {
  const bank = parseIsoDateUtc(bankDateIso);
  const lo = addBusinessDays(bank, LOWER_BOUND_BUSINESS_DAYS);
  const hi = addBusinessDays(bank, UPPER_BOUND_BUSINESS_DAYS);
  const az = parseIsoDateUtc(amazonDateIso);
  return az.getTime() >= lo.getTime() && az.getTime() <= hi.getTime();
}

export function dayDistance(aIso: string, bIso: string): number {
  return Math.abs(parseIsoDateUtc(aIso).getTime() - parseIsoDateUtc(bIso).getTime());
}
