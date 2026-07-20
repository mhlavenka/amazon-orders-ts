import type { AnyNode } from 'domhandler';
import { select, toCurrency, toType, type Root } from '../html';
import type { Selector } from '../auth/selectors';
import { AmazonOrdersParseError } from '../errors';

export interface SimpleParseOptions {
  attrName?: string;
  textContains?: string;
  prefixSplit?: string;
  prefixSplitFuzzy?: boolean;
  suffixSplit?: string;
  suffixSplitFuzzy?: boolean;
}

/**
 * Extract the text (or an attribute) of the first selector match under `el`, mirroring
 * amazon-orders' Parsable.simple_parse(). Returns null on no match — callers decide whether
 * that's fatal via `required(...)`.
 */
export function simpleParse(
  $: Root,
  el: AnyNode,
  selector: Selector | Selector[],
  opts: SimpleParseOptions = {},
): string | number | boolean | null {
  const matches = select($, el, selector);
  if (!matches.length) return null;

  for (const tag of matches.toArray()) {
    const $tag = $(tag);

    if (opts.attrName) {
      const attr = $tag.attr(opts.attrName);
      if (attr === undefined) continue;
      return opts.attrName === 'href' || opts.attrName === 'src' ? attr : attr;
    }

    const rawText = $tag.text();
    if (opts.textContains && !rawText.includes(opts.textContains)) continue;

    // Amazon's markup occasionally wraps a field across lines (e.g. a payment method span
    // breaking "Mastercard" and "****1234" onto separate lines) — collapse to single spaces
    // so downstream consumers get the same clean value a browser's rendered text would show.
    let value = rawText.replace(/\s+/g, ' ');
    if (opts.prefixSplit) {
      if (!value.includes(opts.prefixSplit)) {
        if (!opts.prefixSplitFuzzy) continue;
        value = value.trim();
      } else {
        value = value.trim().split(opts.prefixSplit)[1] ?? '';
      }
    }

    if (opts.suffixSplit) {
      if (!value.includes(opts.suffixSplit)) {
        if (!opts.suffixSplitFuzzy) continue;
        value = value.trim();
      } else {
        value = value.trim().split(opts.suffixSplit)[0] ?? '';
      }
    }

    return toType(value.trim());
  }

  return null;
}

/** Throws AmazonOrdersParseError naming `fieldName` when `value` is null/undefined. */
export function required<T>(value: T | null | undefined, fieldName: string): T {
  if (value === null || value === undefined) {
    throw new AmazonOrdersParseError(
      `${fieldName} could not be parsed — the expected selector did not match. Amazon likely changed the HTML.`,
      { field: fieldName },
    );
  }
  return value;
}

export function parseCurrencyField(
  $: Root,
  el: AnyNode,
  selector: Selector | Selector[],
  opts: SimpleParseOptions = {},
): number | null {
  const value = simpleParse($, el, selector, opts);
  return toCurrency(typeof value === 'number' ? value : (value as string | null));
}

export function withBaseUrl(url: string, baseUrl: string): string {
  return url.startsWith('http') ? url : `${baseUrl}${url}`;
}
