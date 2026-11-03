-- T5.2 warm-up ramp: per-sender switch + start date (existing senders count
-- from when they were added).
ALTER TABLE "sender_accounts" ADD COLUMN "warmup_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sender_accounts" ADD COLUMN "warmup_started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "sender_accounts" SET "warmup_started_at" = "created_at";
