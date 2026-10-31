ALTER TABLE nodes ADD COLUMN inventory_json TEXT CHECK (inventory_json IS NULL OR json_valid(inventory_json));
