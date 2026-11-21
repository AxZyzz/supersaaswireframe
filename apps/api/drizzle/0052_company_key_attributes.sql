-- Learning Loop T01: every lead knows which company it belongs to, and every
-- Discover prospect stores the factors we will learn from (location, industry,
-- size, buying triggers with quotes, timezone, mail provider). Additive only;
-- both tables already have tenant RLS. prospects.industry already exists from
-- 0050 (free text): new runs write fixed-list keys, old rows keep their text.
ALTER TABLE "leads" ADD COLUMN "company_key" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "mail_provider" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "country" text;--> statement-breakpoint
CREATE INDEX "leads_org_company_key_idx" ON "leads" ("org_id", "company_key");--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "size_band" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "triggers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "mail_provider" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "company_key" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "attr_model" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "attr_prompt_version" text;--> statement-breakpoint
-- Idempotent backfill of company_key for existing prospects and leads
UPDATE "prospects"
SET "company_key" = lower(regexp_replace(trim("domain"), '^www\.', ''))
WHERE "company_key" IS NULL AND "domain" IS NOT NULL AND trim("domain") <> '';--> statement-breakpoint
UPDATE "leads"
SET "company_key" = CASE
  WHEN "email" IS NOT NULL AND lower(split_part(trim("email"), '@', 2)) ~ '^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|proton|protonmail|zoho|rediffmail|aol|gmx|yandex|mail|qq|pm)\.[a-z.]+$'
    THEN 'email:' || lower(trim("email"))
  WHEN "email" IS NOT NULL AND split_part(trim("email"), '@', 2) ~ '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'
    THEN lower(regexp_replace(split_part(trim("email"), '@', 2), '^(www|mail|email|webmail|smtp|app|m)\.', ''))
  ELSE NULL
END
WHERE "company_key" IS NULL AND "email" IS NOT NULL;
