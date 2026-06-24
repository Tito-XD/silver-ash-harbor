-- Seed data: Sim Racing brands for price tracking
-- Run after schema.sql: wrangler d1 execute price-db --file=seed.sql

INSERT OR IGNORE INTO brands (name, website) VALUES
    ('Fanatec',   'https://www.fanatec.com/us/en'),
    ('Simagic',   'https://simagic.com/collections/all'),
    ('Simucube',  'https://simucube.com/store'),
    ('Asetek',    'https://www.asetek.com/simsports'),
    ('Logitech',  'https://www.logitechg.com/en-us/shop/c/racing-wheels-pedals');
