ALTER TABLE nodes ADD COLUMN origin_capable INTEGER NOT NULL DEFAULT -1 CHECK(origin_capable IN (-1,0,1));
ALTER TABLE nodes ADD COLUMN origin_migration TEXT NOT NULL DEFAULT '' CHECK(origin_migration IN ('','pending','confirmed','upgrade_required'));
ALTER TABLE agent_sessions ADD COLUMN signed_origin TEXT NOT NULL DEFAULT '';
