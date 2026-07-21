import type { AmazonSession } from './auth/session';
import { parseProductCategoryPage } from './parsing/productCategory';

/**
 * Fetches an item's own product page and returns its category breadcrumb, root-first
 * (e.g. ["Industrial & Scientific", "Test, Measure & Inspect", "Pressure & Vacuum",
 * "Pressure & Vacuum Gauges", "Pressure Switches"]). One extra request per call — callers should
 * cache by ASIN, since a product's category never changes. Best-effort: resolves to null (never
 * throws) if the page can't be fetched or no breadcrumb is found, matching this library's general
 * posture of enrichment that must never block a caller's primary flow.
 */
export async function getItemCategory(session: AmazonSession, link: string): Promise<string[] | null> {
  if (!session.isAuthenticated) return null;
  try {
    const page = await session.get(link);
    if (page.status < 200 || page.status >= 300) return null;
    return parseProductCategoryPage(page.html);
  } catch {
    return null;
  }
}
