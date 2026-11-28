ALTER TABLE nodes ADD COLUMN domain TEXT NOT NULL DEFAULT '' CHECK (length(domain) <= 253);
