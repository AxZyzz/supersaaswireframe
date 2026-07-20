-- users_email_lower_idx was a plain unique btree on raw email (name lied).
-- Redefine on lower(email): case-insensitive uniqueness at the DB level.
-- App layer already normalizes to lowercase; this closes the gap for any
-- future write path that forgets.

DROP INDEX "users_email_lower_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (lower("email"));
