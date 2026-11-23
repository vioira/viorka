ALTER TABLE nodes ADD COLUMN uptime_seconds REAL CHECK (uptime_seconds IS NULL OR (typeof(uptime_seconds)='real' AND uptime_seconds BETWEEN 0 AND 1e20));
ALTER TABLE nodes ADD COLUMN uptime_sampled_at TEXT CHECK ((uptime_seconds IS NULL) = (uptime_sampled_at IS NULL));
ALTER TABLE nodes ADD COLUMN price_minor INTEGER CHECK (price_minor IS NULL OR (typeof(price_minor)='integer' AND price_minor >= 0));
ALTER TABLE nodes ADD COLUMN currency TEXT CHECK (currency IN ('CNY','USD','EUR','JPY') AND (price_minor IS NULL) = (currency IS NULL));
ALTER TABLE nodes ADD COLUMN period_months INTEGER CHECK (period_months IN (1,3,6,24,36,48,60) AND (price_minor IS NULL) = (period_months IS NULL));
ALTER TABLE nodes ADD COLUMN rental_expires_at TEXT;
ALTER TABLE nodes ADD COLUMN billing_revision INTEGER NOT NULL DEFAULT 1 CHECK (billing_revision >= 1);
