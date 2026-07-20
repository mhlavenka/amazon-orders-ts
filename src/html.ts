import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Selector, TextSelector } from './auth/selectors';

export type Root = CheerioAPI;

export function parseHtml(html: string): Root {
  return cheerio.load(html);
}

function isTextSelector(s: Selector): s is TextSelector {
  return typeof s === 'object';
}

function textMatches($: Root, el: AnyNode, selector: TextSelector): boolean {
  const text = $(el).text();
  if (selector.text !== undefined) return text.trim() === selector.text;
  if (selector.textContains !== undefined) return text.toLowerCase().includes(selector.textContains.toLowerCase());
  return false;
}

/**
 * Extends cheerio's select to allow multiple candidate selectors (first one that matches
 * anything wins) and optional text-content filtering — mirrors amazon-orders' util.select().
 */
export function select($: Root, root: AnyNode | Root, selector: Selector | Selector[]): Cheerio<AnyNode> {
  const selectors = Array.isArray(selector) ? selector : [selector];
  const $root = typeof root === 'function' ? $.root() : $(root as AnyNode);

  for (const s of selectors) {
    if (isTextSelector(s)) {
      const matches = $root
        .find(s.css)
        .filter((_, el) => textMatches($, el, s))
        .toArray();
      if (matches.length) return $(matches);
    } else {
      const matches = $root.find(s);
      if (matches.length) return matches;
    }
  }

  return $([]);
}

export function selectOne($: Root, root: AnyNode | Root, selector: Selector | Selector[]): Cheerio<AnyNode> | null {
  const matches = select($, root, selector);
  return matches.length ? matches.first() : null;
}

/** Parse a string to int/float/bool where possible, mirroring amazon-orders' util.to_type(). */
export function toType(value: string): number | boolean | string | null {
  if (!value) return null;

  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  const f = Number(value);
  if (!Number.isNaN(f) && value.trim() !== '') return f;

  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  return value;
}

/**
 * Clean up a currency string, mirroring amazon-orders' Parsable.to_currency(): strips currency
 * symbols/letters/commas, handles parenthesized negatives and "FREE".
 */
export function toCurrency(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;

  let v = value.trim();
  if (!v) return null;
  if (v.toLowerCase() === 'free') return 0.0;

  if (v.startsWith('(') && v.endsWith(')')) {
    v = `-${v.slice(1, -1)}`;
  }

  v = v.replace(/[a-zA-Z$£€₹,]+/g, '');
  const parsed = toType(v);
  return typeof parsed === 'number' ? parsed : null;
}

export function cleanupHtmlText(text: string): string {
  let t = text.trim();
  t = t.replace(/\n\s*\n+/g, '\n');
  t = t.replace(/\n/g, '. ');
  t = t.replace(/\s\s+/g, ' ');
  t = t.replace(/\.+($|\s)/, '.$1');
  if (!t.endsWith('.')) t += '.';
  return t;
}
