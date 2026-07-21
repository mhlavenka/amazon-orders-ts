import { parseHtml } from '../html';

// A product detail page's category breadcrumb ("Industrial & Scientific › Test, Measure &
// Inspect › Pressure & Vacuum › Pressure & Vacuum Gauges › Pressure Switches") is the closest
// thing Amazon exposes to a real item category — neither the order-history list nor an order's
// details page carries one (only title/price/quantity — see parsing/orders.ts), so getting this
// means an extra fetch of the item's own product page. Best-effort: returns null rather than
// throwing on anything unexpected, since callers treat this as an enrichment, never a hard
// requirement (mirrors the "never block the import" posture of the matching module).
//
// NOTE: verified against the reference test fixtures' page chrome only — Amazon's real product
// page markup should be spot-checked against a live account before relying on this in production.
const BREADCRUMB_CONTAINER_SELECTORS = [
  '#wayfinding-breadcrumbs_feature_div',
  '#wayfinding-breadcrumbs_container',
];

/** Parses a product detail page's category breadcrumb, root-first. Null if none was found. */
export function parseProductCategoryPage(html: string): string[] | null {
  const $ = parseHtml(html);

  for (const containerSel of BREADCRUMB_CONTAINER_SELECTORS) {
    const container = $(containerSel);
    if (!container.length) continue;

    const crumbs = container
      .find('li, .a-list-item')
      .toArray()
      .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
      .filter((t) => t && t !== '›' && t !== '>');

    if (crumbs.length) return crumbs;
  }

  return null;
}
