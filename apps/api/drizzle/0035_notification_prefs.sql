-- Per-member notification preferences (rest of T9.2): types this member has
-- muted in this workspace. Muted types are never inserted for them.
ALTER TABLE "memberships" ADD COLUMN "muted_notifications" text[] DEFAULT '{}' NOT NULL;
