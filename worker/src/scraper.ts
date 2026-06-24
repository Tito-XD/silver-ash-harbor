// ============================================================
// Silver Ash Harbor — Web Scraper Module
// Configurable scraper for extracting product names and prices
// from sim racing brand websites.
// ============================================================

import { BrandConfig, ScrapedProduct, ScrapeResult } from './types';

/**
 * Per-brand scraping strategies.
 * Keyed by lowercase brand name for exact-match lookups.
 * Shopify / WooCommerce sites are auto-detected and don't need entries here.
 */
const BRAND_STRATEGIES: Record<string, (html: string, brand: { id: number; name: string; website: string }) => ScrapedProduct[]> = {
  /**
   * Fanatec — custom headless CMS (Next.js / SSR).
   * Product blocks have:
   *   <div class="...collapse-product-block__item-title...">Product Name</div>
   *   <span class="sr-only">Current price: $XX.XX</span>
   *   <a href="https://www.fanatec.com/us/en/p/...">...</a>
   */
  fanatec: (html: string, brand) => {
    const products: ScrapedProduct[] = [];
    const seen = new Set<string>();

    // Find product names from title divs
    const nameRe = /<div[^>]*class="[^"]*collapse-product-block__item-title[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const names: { name: string; idx: number }[] = [];
    let nm: RegExpExecArray | null;
    while ((nm = nameRe.exec(html)) !== null) {
      const name = stripHtml(nm[1]).trim();
      if (name.length >= 4 && !seen.has(name)) names.push({ name, idx: nm.index });
    }

    // Find product links (href contains /p/)
    const linkRe = /<a[^>]*href="((?:https?:)?\/\/[^"]*\/p\/[^"]+)"[^>]*>/gi;
    const links: { url: string; idx: number }[] = [];
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(html)) !== null) links.push({ url: lm[1], idx: lm.index });

    // Find "Current price:" in sr-only spans
    const priceRe = /Current price:\s*([$€£])\s*([\d,]+\.?\d{2})/gi;
    const prices: { sym: string; val: number; idx: number }[] = [];
    let pm: RegExpExecArray | null;
    while ((pm = priceRe.exec(html)) !== null) {
      prices.push({ sym: pm[1], val: parseFloat(pm[2].replace(/,/g, '')), idx: pm.index });
    }

    // Match prices to closest preceding name
    for (const p of prices) {
      let bestName: typeof names[0] | null = null;
      for (const n of names) {
        if (n.idx < p.idx && (!bestName || n.idx > bestName.idx)) bestName = n;
      }
      if (!bestName || seen.has(bestName.name)) continue;

      // Find closest link before this price
      let bestLink: typeof links[0] | null = null;
      for (const l of links) {
        if (l.idx < p.idx && (!bestLink || l.idx > bestLink.idx)) bestLink = l;
      }

      seen.add(bestName.name);
      const cur = p.sym === '€' ? 'EUR' : p.sym === '£' ? 'GBP' : 'USD';
      const prod: ScrapedProduct = { name: bestName.name, price: p.val, currency: cur };
      if (bestLink) {
        prod.url = bestLink.url.startsWith('http') ? bestLink.url : `https://www.fanatec.com${bestLink.url}`;
      }
      products.push(prod);
    }
    return products;
  },

  /**
   * Simucube — WooCommerce.
   */
  simucube: (html: string, brand) => {
    const products: ScrapedProduct[] = [];
    const seen = new Set<string>();

    const linkRe = /<a[^>]*href="(\/simucube-[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const links: { url: string; name: string; idx: number }[] = [];
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(html)) !== null) {
      const name = stripHtml(lm[2]).trim();
      if (name.length >= 4 && !seen.has(name)) links.push({ url: lm[1], name, idx: lm.index });
    }

    const priceRe = /€\s*([\d,]+\.?\d{0,2})/g;
    const prices: { val: number; idx: number }[] = [];
    let pm: RegExpExecArray | null;
    while ((pm = priceRe.exec(html)) !== null) {
      const val = parseFloat(pm[1].replace(/,/g, ''));
      if (val > 0) prices.push({ val, idx: pm.index });
    }

    for (const p of prices) {
      let best: typeof links[0] | null = null;
      for (const l of links) {
        if (l.idx < p.idx && (!best || l.idx > best.idx)) best = l;
      }
      if (best && !seen.has(best.name)) {
        seen.add(best.name);
        products.push({
          name: best.name,
          price: p.val,
          currency: 'EUR',
          url: best.url.startsWith('http') ? best.url : `https://simucube.com${best.url}`,
        });
      }
    }
    return products;
  },

  /**
   * Asetek SimSports — WordPress/WooCommerce.
   */
  asetek: (html: string, brand) => {
    const products: ScrapedProduct[] = [];
    const seen = new Set<string>();

    const priceRe = /€\s*([\d,]+\.?\d{0,2})/g;
    const prices: { val: number; idx: number }[] = [];
    let pm: RegExpExecArray | null;
    while ((pm = priceRe.exec(html)) !== null) {
      const val = parseFloat(pm[1].replace(/,/g, ''));
      if (val > 0) prices.push({ val, idx: pm.index });
    }

    for (const p of prices) {
      const before = html.substring(Math.max(0, p.idx - 600), p.idx);
      const hRe = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/ig;
      let nameMatch: RegExpExecArray | null = null, tmp: RegExpExecArray | null;
      while ((tmp = hRe.exec(before)) !== null) nameMatch = tmp;
      if (!nameMatch) continue;
      const name = stripHtml(nameMatch[1]).trim();
      if (name.length < 4 || name.length > 120 || seen.has(name)) continue;
      if (/add to cart|buy now|learn more/i.test(name)) continue;
      seen.add(name);
      products.push({ name, price: p.val, currency: 'EUR' });
    }
    return products;
  },

  /**
   * Logitech G — Adobe Experience Manager / custom site.
   * Product cards with:
   *   data-* attributes or JSON-LD structured data
   *   Price in $XXX.XX format
   *   Product name in heading or link
   */
  logitech: (html: string, brand) => {
    const products: ScrapedProduct[] = [];
    const seen = new Set<string>();

    // Strategy 1: JSON-LD structured data (most reliable)
    products.push(...extractJsonLdProducts(html, brand));

    // Strategy 2: Extract from product cards with price patterns
    if (products.length === 0) {
      // Find price occurrences with nearby product names
      const pricePattern = /\$([\d,]+\.?\d{2})/g;
      const priceMatches: { value: number; index: number }[] = [];
      let pMatch: RegExpExecArray | null;
      while ((pMatch = pricePattern.exec(html)) !== null) {
        priceMatches.push({ value: parseFloat(pMatch[1].replace(/,/g, '')), index: pMatch.index });
      }

      // For each price, look backwards for product name in a heading or link
      for (const pm of priceMatches) {
        const before = html.substring(Math.max(0, pm.index - 800), pm.index);
        // Find the closest heading or product link before this price
        const nameMatches = [
          ...before.matchAll(/<(?:h[2-4]|a)[^>]*class="[^"]*(?:title|name|heading|product)[^"]*"[^>]*>([\s\S]*?)<\/(?:h[2-4]|a)>/gi),
          ...before.matchAll(/<(?:h[2-4])[^>]*>([\s\S]*?)<\/(?:h[2-4])>/gi),
        ];

        if (nameMatches.length > 0) {
          const lastName = nameMatches[nameMatches.length - 1];
          const name = stripHtml(lastName[1]).trim();
          if (name.length > 4 && name.length < 120 && !seen.has(name) && !/add to cart|buy now|learn more/i.test(name)) {
            seen.add(name);
            products.push({ name, price: pm.value, currency: 'USD' });
          }
        }
      }
    }

    return products;
  },
};

/**
 * Extract products from JSON-LD structured data (<script type="application/ld+json">).
 * Many modern e-commerce sites include Product or ItemList schema.
 */
function extractJsonLdProducts(html: string, _brand: { id: number; name: string; website: string }): ScrapedProduct[] {
  const products: ScrapedProduct[] = [];
  const seen = new Set<string>();

  const ldPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = ldPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = extractItems(data);
      for (const item of items) {
        const name = (item.name || '').trim();
        if (!name || seen.has(name) || name.length < 3) continue;

        let price: number | null = null;
        let currency = 'USD';

        // Handle offers
        if (item.offers) {
          const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          if (offer.price && !isNaN(parseFloat(offer.price))) {
            price = parseFloat(offer.price);
            if (offer.priceCurrency) currency = offer.priceCurrency;
          }
        }

        if (price && price > 0) {
          seen.add(name);
          products.push({
            name,
            price,
            currency,
            url: item.url || undefined,
          });
        }
      }
    } catch {
      // Skip malformed JSON-LD
    }
  }

  return products;
}

function extractItems(data: any): any[] {
  if (!data) return [];
  // @graph array
  if (data['@graph'] && Array.isArray(data['@graph'])) {
    return data['@graph'].filter((i: any) =>
      i['@type'] === 'Product' || (i.itemListElement && Array.isArray(i.itemListElement))
    ).flatMap((i: any) => {
      if (i.itemListElement) return i.itemListElement.map((e: any) => e.item || e).filter(Boolean);
      return [i];
    });
  }
  // ItemList
  if (data.itemListElement && Array.isArray(data.itemListElement)) {
    return data.itemListElement.map((e: any) => e.item || e).filter(Boolean);
  }
  // Single product
  if (data['@type'] === 'Product') return [data];
  return [];
}

/**
 * Generic Shopify product grid selectors.
 */
const SHOPIFY_CONFIG: Omit<BrandConfig, 'id' | 'name' | 'website'> = {
  productSelector: '.product-item, .grid__item, [data-product-id], .grid-product__content',
  nameSelector: '.product-title, .product__title, .grid-product__title, h3, .card__heading',
  priceSelector: '.price, .product__price, .price-item, [data-price], .grid-product__price',
  urlSelector: 'a[href*="/products/"]',
};

/**
 * Generic WooCommerce product grid selectors.
 */
const WOO_CONFIG: Omit<BrandConfig, 'id' | 'name' | 'website'> = {
  productSelector: '.product, li.product, .products .type-product, .product-grid-item',
  nameSelector: '.woocommerce-loop-product__title, .product-title, .product-name, h2, h3',
  priceSelector: '.price .amount, .woocommerce-Price-amount, .product-price, .price',
  urlSelector: 'a.woocommerce-LoopProduct-link, a[href*="/product/"]',
};

// ── CSS Selector Extraction ────────────────────────────────

function extractBySelector(html: string, selector: string): string[] {
  const results: string[] = [];
  const parts = selector.trim().split(/\s*,\s*/);

  for (const part of parts) {
    let pattern: RegExp;

    if (part.startsWith('[')) {
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
      const cls = part.slice(1);
      pattern = new RegExp(`<[^>]*class="[^"]*\\b${escapeRegex(cls)}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');
    } else if (part.startsWith('#')) {
      const id = part.slice(1);
      pattern = new RegExp(`<[^>]*id="${escapeRegex(id)}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'gi');
    } else {
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

function extractHref(html: string, selector: string): string[] {
  const results: string[] = [];
  const parts = selector.trim().split(/\s*,\s*/);
  for (const part of parts) {
    const pattern = /<a[^>]*href="([^"]+)"[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      results.push(match[1]);
    }
  }
  return results;
}

// ── Price Extraction ───────────────────────────────────────

function extractPrice(text: string): { price: number; currency: string } | null {
  // Currency-symbol-prefixed prices
  const symbolPatterns: [RegExp, string][] = [
    [/\$\s*([\d,]+\.?\d{0,2})/, 'USD'],
    [/€\s*([\d,]+\.?\d{0,2})/, 'EUR'],
    [/£\s*([\d,]+\.?\d{0,2})/, 'GBP'],
    [/¥\s*([\d,]+\.?\d{0,2})/, 'JPY'],
  ];

  for (const [pattern, currency] of symbolPatterns) {
    const m = text.match(pattern);
    if (m) {
      const price = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(price) && price > 0) {
        return { price, currency };
      }
    }
  }

  // Currency-suffixed prices (e.g., "123.45 USD")
  const suffixPatterns: [RegExp, string][] = [
    [/([\d,]+\.?\d{0,2})\s*(?:USD|usd)/i, 'USD'],
    [/([\d,]+\.?\d{0,2})\s*(?:EUR|eur)/i, 'EUR'],
    [/([\d,]+\.?\d{0,2})\s*(?:GBP|gbp)/i, 'GBP'],
    [/([\d,]+\.?\d{0,2})\s*(?:JPY|jpy)/i, 'JPY'],
  ];

  for (const [pattern, currency] of suffixPatterns) {
    const m = text.match(pattern);
    if (m) {
      const price = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(price) && price > 0) return { price, currency };
    }
  }

  return null;
}

// ── Helpers ────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, '').replace(/\s+/g, ' ').trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Product Block Splitting ────────────────────────────────

function splitProducts(html: string, selector: string): string[] {
  const parts = selector.trim().split(/\s*,\s*/);
  const blocks: string[] = [];
  const MAX_BLOCKS = 120; // CPU guard

  for (const part of parts) {
    if (!part.startsWith('.')) continue;
    const cls = part.slice(1);
    const pattern = new RegExp(
      `<[^>]*class="[^"]*\\b${escapeRegex(cls)}\\b[^"]*"[^>]*>[\\s\\S]*?(?=<[^>]*class="[^"]*\\b${escapeRegex(cls)}\\b|<\\/[a-z]+>\\s*$|$)`,
      'gi'
    );
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null && blocks.length < MAX_BLOCKS) {
      const block = match[0];
      blocks.push(block);
    }
  }

  return blocks.length > 0 ? blocks : [html];
}

// ── Product Discovery ──────────────────────────────────────

function discoverProducts(html: string, config: BrandConfig): ScrapedProduct[] {
  const products: ScrapedProduct[] = [];
  const seen = new Set<string>();

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
        const product: ScrapedProduct = { name, price: priceInfo.price, currency: priceInfo.currency };
        if (urls[i]) {
          product.url = urls[i].startsWith('http') ? urls[i] : new URL(urls[i], config.website).href;
        }
        products.push(product);
      }
    }
  }

  if (products.length === 0) {
    products.push(...broadDiscovery(html, config.website));
  }

  return products;
}

/**
 * Broad discovery — scan for price patterns with nearby product names.
 */
function broadDiscovery(html: string, baseUrl: string): ScrapedProduct[] {
  const products: ScrapedProduct[] = [];
  const seen = new Set<string>();

  // Match all currency-prefixed prices: $, €, £, ¥
  const pricePattern = /([$€£¥])\s*([\d,]+\.?\d{0,2})/g;
  const prices: { symbol: string; value: number; index: number }[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = pricePattern.exec(html)) !== null) {
    const value = parseFloat(pm[2].replace(/,/g, ''));
    if (value > 0) prices.push({ symbol: pm[1], value, index: pm.index });
  }

  for (const p of prices) {
    if (products.length >= 50) break; // CPU guard
    const context = html.substring(Math.max(0, p.index - 400), p.index); // smaller window for CPU safety
    // Find product name: heading, link text, or structured data nearby
    const patterns = [
      /<(?:h[2-4])[^>]*>([\s\S]*?)<\/(?:h[2-4])>/i,
      /<a[^>]*class="[^"]*(?:title|name|link|heading)[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      /<span[^>]*class="[^"]*(?:title|name)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ];

    for (const namePat of patterns) {
      const matches = [...context.matchAll(new RegExp(namePat.source, 'gi'))];
      if (matches.length > 0) {
        const lastName = matches[matches.length - 1];
        const name = stripHtml(lastName[1]).trim();
        if (name.length > 3 && name.length < 150 && !seen.has(name) && !/add to cart|buy now|shop now|learn more/i.test(name)) {
          seen.add(name);
          const symbolMap: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
          products.push({ name, price: p.value, currency: symbolMap[p.symbol] || 'USD' });
          break;
        }
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
  } catch { /* invalid regex */ }
  return results;
}

// ── Site Detection & Config Selection ──────────────────────

function getConfig(html: string, brand: { id: number; name: string; website: string }): BrandConfig {
  const base: BrandConfig = {
    id: brand.id,
    name: brand.name,
    website: brand.website,
    productSelector: '',
    nameSelector: '',
    priceSelector: '',
  };

  // Check for brand-specific strategy (handled separately in scrapeBrand)
  const key = brand.name.toLowerCase();
  if (BRAND_STRATEGIES[key]) {
    return base; // Will be handled by custom strategy
  }

  // Auto-detect Shopify
  if (html.includes('shopify') || html.includes('myshopify') || html.includes('cdn/shop')) {
    return { ...base, ...SHOPIFY_CONFIG };
  }

  // Auto-detect WooCommerce / WordPress
  if (html.includes('woocommerce') || html.includes('wp-content') || html.includes('WooCommerce')) {
    return { ...base, ...WOO_CONFIG };
  }

  // Generic fallback
  return {
    ...base,
    productSelector: '.product, .product-item, [class*="product"]',
    nameSelector: 'h2, h3, [class*="title"], [class*="name"]',
    priceSelector: '[class*="price"], .amount, [data-price]',
  };
}

// ── Main Scrape Entry ──────────────────────────────────────

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
      return { brand_id: brand.id, products: [], error: `HTTP ${response.status} ${response.statusText}` };
    }

    const fullHtml = await response.text();
    const html = fullHtml.substring(0, 500_000);
    const debugInfo = `url=${response.url} status=${response.status} len=${fullHtml.length}`;
    console.log(`[Scraper] ${brand.name}: ${debugInfo}`);

    // 1. Always try JSON-LD first (fast and reliable)
    let products = extractJsonLdProducts(html, brand);
    if (products.length > 0) {
      console.log(`[Scraper] ${brand.name} (JSON-LD): found ${products.length} products`);
      return { brand_id: brand.id, products };
    }

    // 2. Try brand-specific strategy
    const key = brand.name.toLowerCase();
    if (BRAND_STRATEGIES[key]) {
      const products = BRAND_STRATEGIES[key](html, brand);
      console.log(`[Scraper] ${brand.name} (custom): found ${products.length} products`);
      return { brand_id: brand.id, products };
    }

    // 3. Auto-detect and use CSS selector config
    const config = getConfig(html, brand);
    products = discoverProducts(html, config);

    console.log(`[Scraper] ${brand.name}: found ${products.length} products`);
    return { brand_id: brand.id, products };
  } catch (err: any) {
    console.error(`[Scraper] ${brand.name} error:`, err.message);
    return { brand_id: brand.id, products: [], error: err.message };
  }
}

export async function scrapeAllBrands(
  brands: Array<{ id: number; name: string; website: string }>
): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = [];
  for (const brand of brands) {
    const result = await scrapeBrand(brand);
    results.push(result);
  }
  return results;
}
