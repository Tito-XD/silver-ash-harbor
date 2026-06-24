# Silver Ash Harbor

Multi-brand price tracking and monitoring tool. Crawls brand websites, tracks product prices over time, and surfaces changes via a clean dashboard.

## Architecture

```
silver-ash-harbor/
├── worker/              # Cloudflare Worker (API + cron scraper)
│   ├── src/
│   │   ├── index.ts     # Entry point: routing, API, cron handler
│   │   ├── scraper.ts   # Configurable web scraper
│   │   ├── db.ts        # D1 database operations
│   │   └── types.ts     # Type definitions
│   ├── wrangler.toml    # Worker + D1 + cron config
│   ├── package.json
│   └── tsconfig.json
├── dashboard/           # Static frontend
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── schema.sql           # D1 database schema
├── seed.sql             # Sample brand data
└── README.md
```

## Quick Start

### 1. Install dependencies

```bash
cd worker
npm install
```

### 2. Create the D1 database

```bash
npx wrangler d1 create price-db
```

Copy the output `database_id` into `worker/wrangler.toml` under `[[d1_databases]].database_id`.

### 3. Initialize the database

```bash
npx wrangler d1 execute price-db --file=../schema.sql
npx wrangler d1 execute price-db --file=../seed.sql
```

### 4. Add your brands

Edit `seed.sql` to add your own brand websites, or use the API:

```bash
curl -X POST https://your-worker.workers.dev/api/brands \
  -H "Content-Type: application/json" \
  -d '{"name":"My Brand","website":"https://example.com"}'
```

### 5. Deploy

```bash
npx wrangler deploy
```

### 6. Trigger a crawl

```bash
curl -X POST https://your-worker.workers.dev/api/crawl
```

Or visit the dashboard and click **Crawl Now**.

## Cron Schedule

The Worker automatically crawls all brands every 6 hours. Adjust the cron expression in `worker/wrangler.toml`:

```toml
[triggers]
crons = ["0 */6 * * *"]
```

## Dashboard

The dashboard shows:
- **Summary cards**: total brands, products tracked, price changes (24h), last crawl time
- **Brand tabs**: switch between All / per-brand filtered views
- **Product table**: price, previous price, change direction & percentage
- **Crawl history**: status, results, timestamps of past crawls

## Customizing the Scraper

The scraper auto-detects Shopify and WooCommerce sites. For other sites, configure CSS selectors in `worker/src/scraper.ts`:

```ts
const config = {
  productSelector: '.product-item',
  nameSelector: '.product-title',
  priceSelector: '.price',
};
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard` | Dashboard summary |
| GET | `/api/brands` | List all brands |
| POST | `/api/brands` | Add a brand |
| DELETE | `/api/brands/:id` | Delete a brand |
| GET | `/api/brands/:id/products` | Products for a brand |
| GET | `/api/products` | All products with price changes |
| POST | `/api/crawl` | Trigger full crawl |
| POST | `/api/crawl/:id` | Crawl single brand |
| GET | `/api/logs` | Recent crawl logs |
