-- Gmail reply reading (T5.7, google-stack Phase 2). Each Gmail sender with the
-- gmail.readonly scope is polled for replies and bounces.
ALTER TABLE "sender_accounts" ADD COLUMN "reply_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sender_accounts" ADD COLUMN "reply_sync_error" text;--> statement-breakpoint

-- Gmail message ids already looked at, so overlapping sync windows never
-- process a message twice. Only the id is kept: messages that aren't replies
-- or bounces (personal mail) are never stored.
CREATE TABLE "gmail_seen_messages" (
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE cascade,
  "sender_id" uuid NOT NULL REFERENCES "sender_accounts"("id") ON DELETE cascade,
  "gmail_message_id" text NOT NULL,
  "kind" text NOT NULL,
  "seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("sender_id", "gmail_message_id")
);--> statement-breakpoint
CREATE INDEX "gmail_seen_messages_org_idx" ON "gmail_seen_messages" ("org_id", "seen_at");--> statement-breakpoint
ALTER TABLE "gmail_seen_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gmail_seen_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gmail_seen_messages_tenant" ON "gmail_seen_messages"
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "gmail_seen_messages" TO supersaas_app;--> statement-breakpoint

-- Cross-tenant scan for the scheduler: verified Gmail senders that granted
-- read access and haven't been synced within p_every.
CREATE OR REPLACE FUNCTION due_gmail_reply_syncs(p_every interval)
RETURNS TABLE (id uuid, org_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT s.id, s.org_id FROM sender_accounts s
  WHERE s.provider = 'gmail'
    AND s.status = 'verified'
    AND s.config -> 'gmail' ->> 'scope' LIKE '%gmail.readonly%'
    AND (s.reply_sync_at IS NULL OR s.reply_sync_at <= now() - p_every)
  ORDER BY s.reply_sync_at NULLS FIRST
  LIMIT 200;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION due_gmail_reply_syncs(interval) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION due_gmail_reply_syncs(interval) TO supersaas_app;
