// ============================================================
// Silver Ash Harbor — Cloudflare Worker Entry Point
// Handles: API routes, static assets, cron-triggered crawling
// ============================================================

import { PriceDB } from './db';
import { scrapeAllBrands } from './scraper';
import { ApiResponse, DashboardSummary, ProductWithChange, Brand, CrawlLog } from './types';

export interface Env {
  DB: D1Database;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

// ── CORS Headers ───────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// ── Router ─────────────────────────────────────────────────

async function handleRequest(req: Request, env: Env): Promise<Response> {
  try {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const db = new PriceDB(env.DB);

  // ── API Routes ───────────────────────────────────────

  // GET /api/dashboard — dashboard summary
  if (path === '/api/dashboard' && req.method === 'GET') {
    const summary = await db.getDashboardSummary();
    return json<DashboardSummary>({ success: true, data: summary });
  }

  // GET /api/brands — list brands
  if (path === '/api/brands' && req.method === 'GET') {
    const brands = await db.getBrands();
    return json<Brand[]>({ success: true, data: brands });
  }

  // POST /api/brands — add a brand
  if (path === '/api/brands' && req.method === 'POST') {
    try {
      const body: any = await req.json();
      if (!body.name || !body.website) {
        return json<null>({ success: false, error: 'name and website are required' }, 400);
      }
      const brand = await db.addBrand(body.name, body.website);
      return json<Brand>({ success: true, data: brand }, 201);
    } catch (err: any) {
      return json<null>({ success: false, error: err.message }, 400);
    }
  }

  // DELETE /api/brands/:id — delete a brand
  if (path.startsWith('/api/brands/') && req.method === 'DELETE') {
    const id = parseInt(path.split('/')[3]);
    await db.deleteBrand(id);
    return json<null>({ success: true });
  }

  // GET /api/brands/:id/products — products for a brand
  if (path.match(/^\/api\/brands\/\d+\/products$/) && req.method === 'GET') {
    const brandId = parseInt(path.split('/')[3]);
    const products = await db.getProductsByBrand(brandId);
    return json<ProductWithChange[]>({ success: true, data: products });
  }

  // GET /api/products — all products (with changes)
  if (path === '/api/products' && req.method === 'GET') {
    const products = await db.getAllProducts();
    return json<ProductWithChange[]>({ success: true, data: products });
  }

  // GET /api/favicon?domain=X — proxy favicon (no CORS issues)
  if (path === '/api/favicon' && req.method === 'GET') {
    const domain = url.searchParams.get('domain');
    if (!domain) return json(null, { success: false, error: 'domain required' }, 400);
    try {
      const faviconResp = await fetch(`https://${domain}/favicon.ico`, {
        headers: { 'User-Agent': 'PriceTracker/1.0' },
      });
      if (!faviconResp.ok) throw new Error(`HTTP ${faviconResp.status}`);
      const data = await faviconResp.arrayBuffer();
      return new Response(data, {
        headers: {
          'Content-Type': faviconResp.headers.get('Content-Type') || 'image/x-icon',
          'Cache-Control': 'public, max-age=86400',
          ...corsHeaders,
        },
      });
    } catch {
      return new Response(null, { status: 404, headers: corsHeaders });
    }
  }

  // GET /api/debug — health check with external fetch test
  if (path === '/api/debug' && req.method === 'GET') {
    try {
      const test = await fetch('https://httpbin.org/ip', {
        headers: { 'User-Agent': 'PriceTracker/1.0' },
      });
      return json({ success: true, data: { status: test.status, ok: test.ok } });
    } catch (err: any) {
      return json({ success: false, error: `Fetch test failed: ${err.message}` }, 500);
    }
  }

  // POST /api/crawl — trigger manual crawl (all brands)
  if (path === '/api/crawl' && req.method === 'POST') {
    return handleCrawl(env, db);
  }

  // POST /api/crawl/:brandId — trigger crawl for a specific brand
  if (path.match(/^\/api\/crawl\/\d+$/) && req.method === 'POST') {
    const brandId = parseInt(path.split('/')[3]);
    return handleCrawl(env, db, brandId);
  }

  // GET /api/logs — recent crawl logs
  if (path === '/api/logs' && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM crawl_log ORDER BY created_at DESC LIMIT 50'
    ).all<CrawlLog>();
    return json<CrawlLog[]>({ success: true, data: results });
  }

  // ── Static Assets (Dashboard) ─────────────────────────

  // Serve the dashboard SPA
  return env.ASSETS.fetch(req);
  } catch (err: any) {
    console.error('[Worker] Unhandled error:', err.message, err.stack);
    return json<null>({ success: false, error: `Internal error: ${err.message}` }, 500);
  }
}

// ── Crawl Handler ──────────────────────────────────────────

async function handleCrawl(env: Env, db: PriceDB, brandId?: number): Promise<Response> {
  try {
    const brands = brandId
      ? [await db.getBrand(brandId)].filter(Boolean) as Array<{ id: number; name: string; website: string }>
      : await db.getBrands();

    if (brands.length === 0) {
      return json<null>({ success: false, error: 'No active brands found' }, 404);
    }

    const results = await scrapeAllBrands(brands);

    let totalFound = 0;
    let totalUpdated = 0;
    let totalChanges = 0;
    const details: any[] = [];

    for (const result of results) {
      const logId = await db.startCrawlLog(result.brand_id);

      if (result.error) {
        await db.finishCrawlLog(logId, 0, 0, 0, result.error);
        details.push({ brand_id: result.brand_id, error: result.error });
        continue;
      }

      const stats = await db.saveScrapeResults(result);
      await db.finishCrawlLog(logId, stats.found, stats.updated, stats.changes);

      totalFound += stats.found;
      totalUpdated += stats.updated;
      totalChanges += stats.changes;
      details.push({ brand_id: result.brand_id, products: result.products.length, ...stats });
    }

    return json({
      success: true,
      data: {
        brands_crawled: results.filter(r => !r.error).length,
        brands_failed: results.filter(r => r.error).length,
        products_found: totalFound,
        products_updated: totalUpdated,
        price_changes: totalChanges,
        details,
      },
    });
  } catch (err: any) {
    return json<null>({ success: false, error: err.message }, 500);
  }
}

// ── Cron Trigger Handler ───────────────────────────────────

async function handleScheduled(env: Env): Promise<void> {
  const db = new PriceDB(env.DB);

  console.log('[Cron] Starting scheduled crawl...');
  const brands = await db.getBrands();

  if (brands.length === 0) {
    console.log('[Cron] No brands configured. Skipping.');
    return;
  }

  const results = await scrapeAllBrands(brands);

  for (const result of results) {
    const logId = await db.startCrawlLog(result.brand_id);

    if (result.error) {
      console.error(`[Cron] ${result.brand_id} failed:`, result.error);
      await db.finishCrawlLog(logId, 0, 0, 0, result.error);
      continue;
    }

    const stats = await db.saveScrapeResults(result);
    await db.finishCrawlLog(logId, stats.found, stats.updated, stats.changes);
    console.log(`[Cron] Brand ${result.brand_id}: ${stats.found} found, ${stats.changes} changes`);
  }

  console.log('[Cron] Scheduled crawl complete.');
}

// ── Export Handlers ────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, env);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(env);
  },
};
