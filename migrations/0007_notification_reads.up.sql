CREATE TABLE notification_reads (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
 PRIMARY KEY (user_id, notification_id)
);
CREATE INDEX notification_reads_notification ON notification_reads(notification_id);
