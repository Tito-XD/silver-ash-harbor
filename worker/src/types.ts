// ============================================================
// Silver Ash Harbor — Type Definitions
// ============================================================

export interface Brand {
  id: number;
  name: string;
  website: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: number;
  brand_id: number;
  name: string;
  url: string | null;
  sku: string | null;
  currency: string;
  current_price: number | null;
  last_crawled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceHistory {
  id: number;
  product_id: number;
  price: number;
  crawled_at: string;
}

export interface CrawlLog {
  id: number;
  brand_id: number | null;
  status: string;
  products_found: number;
  products_updated: number;
  price_changes: number;
  error_msg: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

// Brand configuration for the scraper
export interface BrandConfig {
  id: number;
  name: string;
  website: string;
  // CSS selector or regex pattern to find product containers
  productSelector: string;
  // Patterns within each product container
  nameSelector: string;    // CSS selector for product name
  priceSelector: string;   // CSS selector for price
  urlSelector?: string;    // CSS selector for product URL (optional)
  // Alternative: regex patterns
  nameRegex?: string;
  priceRegex?: string;
}

// Dashboard summary
export interface DashboardSummary {
  total_brands: number;
  total_products: number;
  total_price_changes: number;
  last_crawl_time: string | null;
  brands: BrandSummary[];
}

export interface BrandSummary {
  id: number;
  name: string;
  product_count: number;
  price_changes: number;
  last_crawled_at: string | null;
}

// Product with change info for display
export interface ProductWithChange extends Product {
  previous_price: number | null;
  price_change: number | null;      // absolute change
  price_change_pct: number | null;  // percentage change
  change_direction: 'up' | 'down' | 'unchanged' | 'new';
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Scraping result from a single brand crawl
export interface ScrapeResult {
  brand_id: number;
  products: ScrapedProduct[];
  error?: string;
}

export interface ScrapedProduct {
  name: string;
  price: number;
  currency: string;
  url?: string;
  sku?: string;
}
