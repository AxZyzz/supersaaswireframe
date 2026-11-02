-- E9: workspace profile, branding (white-label readiness) and onboarding state.
ALTER TABLE "orgs" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "team_size" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "brand_color" text;--> statement-breakpoint
-- Small data: URL (client downscales to <=256px). Moves to S3 once uploads land.
ALTER TABLE "orgs" ADD COLUMN "logo_data" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
-- Workspaces that predate onboarding are already set up; don't push them into the wizard.
UPDATE "orgs" SET "onboarded_at" = "created_at" WHERE "onboarded_at" IS NULL;
