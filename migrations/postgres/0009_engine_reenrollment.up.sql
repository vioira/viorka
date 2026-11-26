-- The Panel revision of the last confirmed absence fences historical apply
-- records even after another identity change or successful reinstallation.
ALTER TABLE engines ADD COLUMN last_absent_revision BIGINT NOT NULL DEFAULT 0 CHECK(last_absent_revision>=0);

ALTER TABLE subscription_restore_engines ADD COLUMN reason TEXT NOT NULL DEFAULT 'restore'
 CHECK(reason IN ('restore','reenrollment','restore_reenrollment'));

-- Repair observations that still predate the last identity reset. Preserve any
-- additional review required by a database restore.
WITH resets AS (
 SELECT resource_id,created_at,actor_id,
 row_number() OVER (PARTITION BY resource_id ORDER BY created_at DESC,id DESC) AS position
 FROM audit_logs WHERE action='node.enrollment.reset' AND resource_type='node'
)
INSERT INTO subscription_restore_engines(engine_id,restored_at,state,requested_by,reason)
 SELECT e.id,r.created_at,'pending',coalesce(r.actor_id,''),'reenrollment'
 FROM engines e JOIN resets r ON r.resource_id=e.node_id AND r.position=1
 WHERE e.ownership='managed' AND e.observed_at<=r.created_at
 ON CONFLICT(engine_id) DO UPDATE SET state='pending',task_id='',observed_encrypted='',observed_revision=0,
 restored_at=excluded.restored_at,requested_by=excluded.requested_by,reason='restore_reenrollment'
 WHERE subscription_restore_engines.restored_at<=excluded.restored_at;

-- A legacy command with unknown side effects must not be replayed on the new host.
UPDATE tasks SET state='failed',last_error='engine_result_unknown'
 WHERE state IN ('queued','accepted','running','dispatched') AND id IN (
 SELECT o.task_id FROM engine_operations o JOIN subscription_restore_engines r ON r.engine_id=o.engine_id
 WHERE r.reason!='restore' AND o.active=1);
UPDATE engine_operations SET active=0 WHERE engine_id IN (SELECT engine_id FROM subscription_restore_engines WHERE reason!='restore');
UPDATE engines SET status='unknown',version=NULL,observed_revision=0,observed_at=''
 WHERE id IN (SELECT engine_id FROM subscription_restore_engines WHERE reason!='restore');
