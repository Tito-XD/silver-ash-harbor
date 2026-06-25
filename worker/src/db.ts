// ============================================================
// Silver Ash Harbor — Database Operations
// D1 (SQLite) queries for brands, products, price history.
// ============================================================

import {
  Brand,
  Product,
  PriceHistory,
  CrawlLog,
  DashboardSummary,
  BrandSummary,
  ProductWithChange,
  ScrapeResult,
} from './types';

export class PriceDB {
  constructor(private db: D1Database) {}

  // ── Brands ───────────────────────────────────────────────

  async getBrands(): Promise<Brand[]> {
    const { results } = await this.db.prepare(
      'SELECT * FROM brands WHERE active = 1 ORDER BY CASE name WHEN \'Fanatec\' THEN 1 WHEN \'Simagic\' THEN 2 WHEN \'Logitech\' THEN 3 WHEN \'Simucube\' THEN 4 WHEN \'Asetek\' THEN 5 ELSE 6 END, name'
    ).all<Brand>();
    return results;
  }

  async getBrand(id: number): Promise<Brand | null> {
    return this.db.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first<Brand>();
  }

  async addBrand(name: string, website: string): Promise<Brand> {
    const { meta } = await this.db.prepare(
      'INSERT INTO brands (name, website) VALUES (?, ?)'
    ).bind(name, website).run();
    return (await this.getBrand(meta.last_row_id as number))!;
  }

  async deleteBrand(id: number): Promise<void> {
    await this.db.prepare('DELETE FROM brands WHERE id = ?').bind(id).run();
  }

  // ── Products ─────────────────────────────────────────────

  async getProductsByBrand(brandId: number): Promise<ProductWithChange[]> {
    // Get current products with their previous price from price_history
    const { results } = await this.db.prepare(`
      SELECT
        p.*,
        ph.price AS previous_price,
        CASE
          WHEN p.current_price > ph.price THEN 'up'
          WHEN p.current_price < ph.price THEN 'down'
          WHEN p.current_price = ph.price THEN 'unchanged'
          ELSE 'new'
        END AS change_direction,
        p.current_price - ph.price AS price_change,
        CASE
          WHEN ph.price > 0 THEN ROUND((p.current_price - ph.price) / ph.price * 100, 1)
          ELSE NULL
        END AS price_change_pct
      FROM products p
      LEFT JOIN (
        SELECT product_id, price,
          ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY crawled_at DESC) AS rn
        FROM price_history
      ) ph ON p.id = ph.product_id AND ph.rn = 1
      WHERE p.brand_id = ?
      ORDER BY p.name
    `).bind(brandId).all<ProductWithChange>();

    // For products with only one price entry, previous_price is from the
    // second-most-recent history entry
    const enriched = await Promise.all(
      results.map(async (p) => {
        if (p.previous_price === null && p.change_direction === 'new') {
          // Check if there are 2+ entries
          const { results: history } = await this.db.prepare(
            'SELECT price FROM price_history WHERE product_id = ? ORDER BY crawled_at DESC LIMIT 2'
          ).bind(p.id).all<PriceHistory>();

          if (history.length >= 2) {
            p.previous_price = history[1].price;
            p.price_change = p.current_price! - history[1].price;
            p.price_change_pct = history[1].price > 0
              ? Math.round((p.current_price! - history[1].price) / history[1].price * 1000) / 10
              : null;
            p.change_direction = p.current_price! > history[1].price ? 'up'
              : p.current_price! < history[1].price ? 'down' : 'unchanged';
          }
        }
        return p;
      })
    );

    return enriched;
  }

  async getAllProducts(): Promise<ProductWithChange[]> {
    const { results } = await this.db.prepare(`
      SELECT
        p.*,
        ph.price AS previous_price,
        CASE
          WHEN p.current_price > ph.price THEN 'up'
          WHEN p.current_price < ph.price THEN 'down'
          WHEN p.current_price = ph.price THEN 'unchanged'
          ELSE 'new'
        END AS change_direction,
        p.current_price - ph.price AS price_change,
        CASE
          WHEN ph.price > 0 THEN ROUND((p.current_price - ph.price) / ph.price * 100, 1)
          ELSE NULL
        END AS price_change_pct
      FROM products p
      LEFT JOIN (
        SELECT product_id, price,
          ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY crawled_at DESC) AS rn
        FROM price_history
      ) ph ON p.id = ph.product_id AND ph.rn = 1
      WHERE p.current_price IS NOT NULL
      ORDER BY CASE (SELECT name FROM brands WHERE id = p.brand_id) WHEN 'Fanatec' THEN 1 WHEN 'Simagic' THEN 2 WHEN 'Logitech' THEN 3 WHEN 'Simucube' THEN 4 WHEN 'Asetek' THEN 5 ELSE 6 END, p.name
    `).all<ProductWithChange>();

    return results;
  }

  async upsertProduct(
    brandId: number,
    name: string,
    price: number,
    currency: string,
    url?: string,
    originalPrice?: number,
  ): Promise<{ productId: number; isNew: boolean; oldPrice: number | null }> {
    // Check if product exists
    const existing = await this.db.prepare(
      'SELECT id, current_price FROM products WHERE brand_id = ? AND name = ?'
    ).bind(brandId, name).first<{ id: number; current_price: number | null }>();

    const now = new Date().toISOString();

    if (existing) {
      const oldPrice = existing.current_price;
      await this.db.prepare(
        'UPDATE products SET url = COALESCE(?, url), current_price = ?, original_price = ?, currency = ?, last_crawled_at = ?, updated_at = ? WHERE id = ?'
      ).bind(url || null, price, originalPrice ?? null, currency, now, now, existing.id).run();

      return { productId: existing.id, isNew: false, oldPrice };
    } else {
      const { meta } = await this.db.prepare(
        'INSERT INTO products (brand_id, name, url, currency, current_price, original_price, last_crawled_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(brandId, name, url || null, currency, price, originalPrice ?? null, now).run();

      return { productId: meta.last_row_id as number, isNew: true, oldPrice: null };
    }
  }

  async addPriceHistory(productId: number, price: number): Promise<void> {
    await this.db.prepare(
      'INSERT INTO price_history (product_id, price) VALUES (?, ?)'
    ).bind(productId, price).run();
  }

  // ── Crawl Log ────────────────────────────────────────────

  async startCrawlLog(brandId: number): Promise<number> {
    const { meta } = await this.db.prepare(
      "INSERT INTO crawl_log (brand_id, status, started_at) VALUES (?, 'running', ?)"
    ).bind(brandId, new Date().toISOString()).run();
    return meta.last_row_id as number;
  }

  async finishCrawlLog(
    logId: number,
    found: number,
    updated: number,
    changes: number,
    error?: string,
  ): Promise<void> {
    await this.db.prepare(
      `UPDATE crawl_log
       SET status = ?, products_found = ?, products_updated = ?,
           price_changes = ?, error_msg = ?, finished_at = ?
       WHERE id = ?`
    ).bind(error ? 'failed' : 'success', found, updated, changes, error || null, new Date().toISOString(), logId).run();
  }

  // ── Dashboard ────────────────────────────────────────────

  async getDashboardSummary(): Promise<DashboardSummary> {
    // Total brands
    const { total: totalBrands } = await this.db.prepare(
      'SELECT COUNT(*) as total FROM brands WHERE active = 1'
    ).first<{ total: number }>() || { total: 0 };

    // Total products
    const { total: totalProducts } = await this.db.prepare(
      'SELECT COUNT(*) as total FROM products WHERE current_price IS NOT NULL'
    ).first<{ total: number }>() || { total: 0 };

    // Last crawl
    const lastCrawl = await this.db.prepare(
      "SELECT finished_at FROM crawl_log WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1"
    ).first<{ finished_at: string }>();

    // Price changes in last 24h
    const { total: recentChanges } = await this.db.prepare(
      "SELECT COUNT(*) as total FROM crawl_log WHERE price_changes > 0 AND finished_at > datetime('now', '-1 day')"
    ).first<{ total: number }>() || { total: 0 };

    // Brand summaries
    const { results: brands } = await this.db.prepare(`
      SELECT
        b.id,
        b.name,
        COUNT(p.id) AS product_count,
        COALESCE(MAX(p.last_crawled_at), MAX(cl.finished_at)) AS last_crawled_at,
        COALESCE(SUM(CASE WHEN cl.finished_at > datetime('now', '-1 day') THEN cl.price_changes ELSE 0 END), 0) AS price_changes
      FROM brands b
      LEFT JOIN products p ON b.id = p.brand_id
      LEFT JOIN crawl_log cl ON b.id = cl.brand_id
      WHERE b.active = 1
      GROUP BY b.id, b.name
      ORDER BY CASE b.name WHEN 'Fanatec' THEN 1 WHEN 'Simagic' THEN 2 WHEN 'Logitech' THEN 3 WHEN 'Simucube' THEN 4 WHEN 'Asetek' THEN 5 ELSE 6 END, b.name
    `).all<BrandSummary>();

    return {
      total_brands: totalBrands,
      total_products: totalProducts,
      total_price_changes: recentChanges,
      last_crawl_time: lastCrawl?.finished_at || null,
      brands,
    };
  }

  // ── Save scrape results ──────────────────────────────────

  async saveScrapeResults(result: ScrapeResult): Promise<{
    found: number;
    updated: number;
    changes: number;
  }> {
    let found = 0;
    let updated = 0;
    let changes = 0;

    for (const sp of result.products) {
      found++;
      const { productId, isNew, oldPrice } = await this.upsertProduct(
        result.brand_id,
        sp.name,
        sp.price,
        sp.currency,
        sp.url,
        sp.original_price,
      );
      updated++;

      // Record price history
      await this.addPriceHistory(productId, sp.price);

      // Check if price changed
      if (!isNew && oldPrice !== null && oldPrice !== sp.price) {
        changes++;
      }
    }

    return { found, updated, changes };
  }
}
