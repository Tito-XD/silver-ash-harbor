// ============================================================
// Silver Ash Harbor — Web Scraper Module
// Configurable scraper for extracting product names and prices
// from brand websites using CSS selectors or regex patterns.
// ============================================================

import { BrandConfig, ScrapedProduct, ScrapeResult } from './types';

/**
 * Default brand configurations.
 * Users should customize productSelector, nameSelector, priceSelector
 * for each brand's website structure.
 *
 * These are EXAMPLE patterns — update based on actual site HTML.
 */
const DEFAULT_BRAND_CONFIGS: Record<string, Omit<BrandConfig, 'id' | 'name' | 'website'>> = {
  // Generic Shopify product grid pattern
  shopify: {
    productSelector: '.product-item, .grid__item, [data-product-id]',
    nameSelector: '.product-title, .product__title, h3, .card__heading',
    priceSelector: '.price, .product__price, .price-item, [data-price]',
    urlSelector: 'a[href*="/products/"]',
  },
  // Generic WooCommerce pattern
  woocommerce: {
    productSelector: '.product, li.product, .products .type-product',
    nameSelector: '.woocommerce-loop-product__title, .product-title, h2',
    priceSelector: '.price .amount, .woocommerce-Price-amount, .product-price',
    urlSelector: 'a.woocommerce-LoopProduct-link, a[href*="/product/"]',
  },
};

/**
 * Extract text content from HTML using a CSS selector.
 * Uses simple regex-based extraction since we can't use DOM APIs in Workers.
 */
function extractBySelector(html: string, selector: string): string[] {
  const results: string[] = [];

  // Simple CSS selector parsing — handles basic patterns:
  // .classname, #id, tag, [attr=val], [attr*=val]
  const parts = selector.trim().split(/\s*,\s*/);

  for (const part of parts) {
    let pattern: RegExp;

    if (part.startsWith('[data-') || part.startsWith('[href')) {
      // Attribute selectors: [data-product-id], [href*="/products/"]
      const attrMatch = part.match(/\[([a-z-]+)([*^$]?=)?["']?([^"'\]]*?)["']?\]/);
      if (!attrMatch) continue;
      const [, attr, op, val] = attrMatch;
      if (op === '*=' && val) {
        pattern = new RegExp(`<[^>]*${attr}="[^"]*${escapeRegex(val)}[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');
      } else if (val) {
        pattern = new RegExp(`<[^>]*${attr}="${escapeRegex(val)}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');
      } else {
        pattern = new RegExp(`<[^>]*${attr}[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');
      }
    } else if (part.startsWith('.')) {
      // Class selector
      const cls = part.slice(1);
      pattern = new RegExp(`<[^>]*class="[^"]*\\b${escapeRegex(cls)}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');
    } else if (part.startsWith('#')) {
      // ID selector
      const id = part.slice(1);
      pattern = new RegExp(`<[^>]*id="${escapeRegex(id)}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');
    } else {
      // Tag selector (e.g., h2, h3, a)
      pattern = new RegExp(`<${part}\\b[^>]*>([\\s\\S]*?)<\\/${part}>`, 'gi');
    }

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const text = stripHtml(match[1] || match[0]);
      if (text.trim()) results.push(text.trim());
    }
  }

  return results;
}

/**
 * Extract href attribute using a CSS selector.
 */
function extractHref(html: string, selector: string): string[] {
  const results: string[] = [];

  const parts = selector.trim().split(/\s*,\s*/);
  for (const part of parts) {
    let pattern: RegExp;

    if (part.includes('[href')) {
      const hrefMatch = part.match(/\[href[*^$]?=["']?([^"'\]]*?)["']?\]/);
      if (!hrefMatch) continue;
      pattern = /<a[^>]*href="([^"]+)"[^>]*>/gi;
    } else {
      pattern = /<a[^>]*href="([^"]+)"[^>]*>/gi;
    }

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      results.push(match[1]);
    }
  }

  return results;
}

/**
 * Extract price from text using regex or common patterns.
 */
function extractPrice(text: string, currencyRegex?: string): { price: number; currency: string } | null {
  // Try custom regex first
  if (currencyRegex) {
    const re = new RegExp(currencyRegex, 'i');
    const m = text.match(re);
    if (m && m[1]) {
      return { price: parseFloat(m[1]), currency: 'USD' };
    }
  }

  // Common price patterns
  const patterns = [
    /\$[\s]*([\d,]+\.?\d*)/,          // $123.45
    /([\d,]+\.?\d*)[\s]*(?:USD|usd)/i, // 123.45 USD
    /€[\s]*([\d,]+\.?\d*)/,            // €123.45
    /([\d,]+\.?\d*)[\s]*(?:EUR|eur)/i, // 123.45 EUR
    /£[\s]*([\d,]+\.?\d*)/,            // £123.45
    /¥[\s]*([\d,]+\.?\d*)/,            // ¥12,345
    /([\d,]+\.?\d*)[\s]*(?:JPY|jpy)/i, // 12345 JPY
    /([\d,]+\.?\d*)/,                  // bare number (last resort)
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      const price = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(price) && price > 0) {
        let currency = 'USD';
        if (pattern.source.includes('€')) currency = 'EUR';
        else if (pattern.source.includes('£')) currency = 'GBP';
        else if (pattern.source.includes('¥') || pattern.source.includes('JPY')) currency = 'JPY';
        return { price, currency };
      }
    }
  }

  return null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, '').replace(/\s+/g, ' ').trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split HTML into product blocks based on the productSelector.
 */
function splitProducts(html: string, selector: string): string[] {
  const parts = selector.trim().split(/\s*,\s*/);
  const blocks: string[] = [];

  for (const part of parts) {
    if (part.startsWith('.')) {
      const cls = part.slice(1);
      // Match opening tags with this class through to next sibling or closing tag
      const pattern = new RegExp(
        `<[^>]*class="[^"]*\\b${escapeRegex(cls)}\\b[^"]*"[^>]*>[\\s\\S]*?(?=<[^>]*class="[^"]*\\b${escapeRegex(cls)}\\b|<\\/[a-z]+>\\s*$|$)`,
        'gi'
      );
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(html)) !== null) {
        const block = match[0];
        // Try to get the full block (up to the closing tag)
        const tagMatch = block.match(/<(\w+)[^>]*class="[^"]*\\b${escapeRegex(cls)}\\b[^"]*"[^>]*>/);
        if (tagMatch) {
          const tag = tagMatch[1];
          const startIdx = match.index;
          let depth = 1;
          let idx = startIdx + block.length;
          const tagPattern = new RegExp(`<\\/?${tag}\\b`, 'g');
          tagPattern.lastIndex = idx;
          while (depth > 0) {
            const tm = tagPattern.exec(html);
            if (!tm) break;
            if (tm[0].startsWith('</')) depth--;
            else depth++;
            idx = tm.index + tm[0].length;
          }
          blocks.push(html.substring(startIdx, idx));
        } else {
          blocks.push(block);
        }
      }
    }
  }

  // If no blocks found, return whole HTML as one block
  return blocks.length > 0 ? blocks : [html];
}

/**
 * Discover products from a brand's website homepage or collection page.
 * Tries multiple common patterns to find product listings.
 */
function discoverProducts(html: string, config: BrandConfig): ScrapedProduct[] {
  const products: ScrapedProduct[] = [];
  const seen = new Set<string>();

  // Strategy 1: Use configured selectors
  const blocks = splitProducts(html, config.productSelector);

  for (const block of blocks) {
    const names = config.nameRegex
      ? extractByRegex(block, config.nameRegex)
      : extractBySelector(block, config.nameSelector);

    const prices = config.priceRegex
      ? extractByRegex(block, config.priceRegex)
      : extractBySelector(block, config.priceSelector);

    const urls = config.urlSelector ? extractHref(block, config.urlSelector) : [];

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (seen.has(name)) continue;

      const textToCheck = prices[i] || block;
      const priceInfo = extractPrice(textToCheck);

      if (priceInfo) {
        seen.add(name);
        const product: ScrapedProduct = {
          name,
          price: priceInfo.price,
          currency: priceInfo.currency,
        };
        if (urls[i]) {
          product.url = urls[i].startsWith('http') ? urls[i] : new URL(urls[i], config.website).href;
        }
        products.push(product);
      }
    }
  }

  // Strategy 2: If no products found via selectors, try broad pattern matching
  if (products.length === 0) {
    products.push(...broadDiscovery(html, config.website));
  }

  return products;
}

/**
 * Broad discovery — scan entire page for product-like patterns.
 */
function broadDiscovery(html: string, baseUrl: string): ScrapedProduct[] {
  const products: ScrapedProduct[] = [];
  const seen = new Set<string>();

  // Find all price-like patterns
  const pricePattern = /\$[\s]*([\d,]+\.?\d{2})/g;
  const prices: { value: number; index: number }[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = pricePattern.exec(html)) !== null) {
    prices.push({ value: parseFloat(pm[1].replace(/,/g, '')), index: pm.index });
  }

  // For each price, look nearby for a product name (in surrounding HTML)
  for (const p of prices) {
    const context = html.substring(Math.max(0, p.index - 500), p.index + 50);
    // Try to find a product name in headings or product-title-like elements
    const nameMatch = context.match(/(?:class="[^"]*(?:title|name|heading)[^"]*"[^>]*>|>)\s*([^<]{3,80})/i);
    if (nameMatch) {
      const name = stripHtml(nameMatch[1]).trim();
      if (!seen.has(name) && name.length > 3) {
        seen.add(name);
        products.push({ name, price: p.value, currency: 'USD' });
      }
    }
  }

  return products;
}

function extractByRegex(html: string, regex: string): string[] {
  const results: string[] = [];
  try {
    const re = new RegExp(regex, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const val = m[1] || m[0];
      const text = stripHtml(val).trim();
      if (text) results.push(text);
    }
  } catch {
    // Invalid regex, skip
  }
  return results;
}

/**
 * Auto-detect the site type and pick the best config.
 */
function autoDetectConfig(html: string, brand: { id: number; name: string; website: string }): BrandConfig {
  const base: BrandConfig = {
    id: brand.id,
    name: brand.name,
    website: brand.website,
    productSelector: '',
    nameSelector: '',
    priceSelector: '',
  };

  if (html.includes('shopify') || html.includes('myshopify') || html.includes('Shopify')) {
    return { ...base, ...DEFAULT_BRAND_CONFIGS.shopify };
  }
  if (html.includes('woocommerce') || html.includes('WooCommerce') || html.includes('wp-content')) {
    return { ...base, ...DEFAULT_BRAND_CONFIGS.woocommerce };
  }

  // Fallback: generic detection
  return {
    ...base,
    productSelector: '.product, .product-item, [class*="product"]',
    nameSelector: 'h2, h3, [class*="title"], [class*="name"]',
    priceSelector: '[class*="price"], .amount, [data-price]',
  };
}

/**
 * Main entry: crawl a single brand website.
 */
export async function scrapeBrand(
  brand: { id: number; name: string; website: string }
): Promise<ScrapeResult> {
  console.log(`[Scraper] Crawling ${brand.name} (${brand.website})...`);

  try {
    const response = await fetch(brand.website, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PriceTracker/1.0; +https://silver-ash-harbor.workers.dev)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return { brand_id: brand.id, products: [], error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const config = autoDetectConfig(html, brand);
    const products = discoverProducts(html, config);

    console.log(`[Scraper] ${brand.name}: found ${products.length} products`);
    return { brand_id: brand.id, products };
  } catch (err: any) {
    console.error(`[Scraper] ${brand.name} error:`, err.message);
    return { brand_id: brand.id, products: [], error: err.message };
  }
}

/**
 * Crawl all active brands.
 */
export async function scrapeAllBrands(
  brands: Array<{ id: number; name: string; website: string }>
): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];
  // Crawl sequentially to avoid overwhelming servers
  for (const brand of brands) {
    const result = await scrapeBrand(brand);
    results.push(result);
  }
  return results;
}
