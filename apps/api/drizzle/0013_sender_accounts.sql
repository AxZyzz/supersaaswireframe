CREATE TYPE "public"."sender_provider" AS ENUM('ses', 'gmail', 'smtp');--> statement-breakpoint
CREATE TABLE "sender_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" "sender_provider" NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"signature" text,
	"daily_limit" integer DEFAULT 50 NOT NULL,
	"send_window_start" integer,
	"send_window_end" integer,
	"status" text DEFAULT 'unverified' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sender_accounts" ADD CONSTRAINT "sender_accounts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sender_accounts_org_idx" ON "sender_accounts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_accounts_org_email_idx" ON "sender_accounts" USING btree ("org_id",lower("from_email"));