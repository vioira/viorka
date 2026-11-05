ALTER TABLE nodes ADD COLUMN geo_country_code TEXT NOT NULL DEFAULT '' CHECK(geo_country_code='' OR (length(geo_country_code)=2 AND geo_country_code GLOB '[A-Z][A-Z]'));
ALTER TABLE nodes ADD COLUMN geo_subdivision TEXT NOT NULL DEFAULT '' CHECK(length(geo_subdivision)<=256);
ALTER TABLE nodes ADD COLUMN geo_city TEXT NOT NULL DEFAULT '' CHECK(length(geo_city)<=256);
