ALTER TABLE "campaign_leads" ADD COLUMN "unsub_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE TABLE "sent_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"campaign_id" uuid,
	"campaign_lead_id" uuid,
	"lead_id" uuid,
	"step_id" uuid,
	"sender_id" uuid,
	"to_email" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"message_id" text,
	"provider" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"variant_index" integer DEFAULT 0 NOT NULL,
	"tracking_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sent_email_id" uuid,
	"campaign_id" uuid,
	"lead_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"reason" text DEFAULT 'unsubscribed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_campaign_lead_id_campaign_leads_id_fk" FOREIGN KEY ("campaign_lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_step_id_campaign_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_sender_id_sender_accounts_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."sender_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_sent_email_id_sent_emails_id_fk" FOREIGN KEY ("sent_email_id") REFERENCES "public"."sent_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sent_emails_org_idx" ON "sent_emails" USING btree ("org_id","sent_at");--> statement-breakpoint
CREATE INDEX "sent_emails_campaign_idx" ON "sent_emails" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "sent_emails_lead_idx" ON "sent_emails" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sent_emails_tracking_idx" ON "sent_emails" USING btree ("tracking_id");--> statement-breakpoint
CREATE INDEX "sent_emails_sender_day_idx" ON "sent_emails" USING btree ("sender_id","sent_at");--> statement-breakpoint
CREATE INDEX "email_events_org_idx" ON "email_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "email_events_sent_idx" ON "email_events" USING btree ("sent_email_id");--> statement-breakpoint
CREATE INDEX "email_events_campaign_idx" ON "email_events" USING btree ("campaign_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_org_email_idx" ON "suppression_list" USING btree ("org_id",lower("email"));
