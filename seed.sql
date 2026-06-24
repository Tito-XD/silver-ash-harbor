-- Seed data: sample brands (replace with your actual brands)
-- Add your own brands here after running `wrangler d1 execute price-db --file=schema.sql`

INSERT OR IGNORE INTO brands (name, website) VALUES
    ('Moza Racing', 'https://mozaracing.com'),
    ('Fanatec', 'https://fanatec.com'),
    ('Simucube', 'https://simucube.com');
