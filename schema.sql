-- Silver Ash Harbor - Price Tracking Database Schema
-- Cloudflare D1 (SQLite-compatible)

CREATE TABLE IF NOT EXISTS brands (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    website     TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id        INTEGER NOT NULL,
    name            TEXT NOT NULL,
    url             TEXT,
    sku             TEXT,
    currency        TEXT NOT NULL DEFAULT 'USD',
    current_price   REAL,
    original_price  REAL,
    last_crawled_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    UNIQUE(brand_id, name)
);

CREATE TABLE IF NOT EXISTS price_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER NOT NULL,
    price       REAL NOT NULL,
    crawled_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crawl_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id    INTEGER,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending, running, success, failed
    products_found INTEGER DEFAULT 0,
    products_updated INTEGER DEFAULT 0,
    price_changes INTEGER DEFAULT 0,
    error_msg   TEXT,
    started_at  TEXT,
    finished_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_crawled ON price_history(crawled_at);
CREATE INDEX IF NOT EXISTS idx_crawl_log_brand ON crawl_log(brand_id);
CREATE INDEX IF NOT EXISTS idx_crawl_log_created ON crawl_log(created_at);
