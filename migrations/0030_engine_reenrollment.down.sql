-- Pending verification remains available through the manual recovery flow.
ALTER TABLE subscription_restore_engines DROP COLUMN reason;
ALTER TABLE engines DROP COLUMN last_absent_revision;
