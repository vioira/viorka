DROP TABLE notifications;
DROP TABLE user_invitations;
ALTER TABLE users DROP COLUMN disabled;
ALTER TABLE users DROP COLUMN email;
DROP TABLE system_settings;
