CREATE TABLE "segment_members" (
	"org_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	CONSTRAINT "segment_members_segment_id_lead_id_pk" PRIMARY KEY("segment_id","lead_id")
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'smart' NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segment_members_lead_idx" ON "segment_members" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "segment_members_org_idx" ON "segment_members" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_org_name_idx" ON "segments" USING btree ("org_id",lower("name"));