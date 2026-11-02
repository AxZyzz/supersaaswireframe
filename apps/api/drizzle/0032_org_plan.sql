-- Usage limits: each org is on a plan whose limits live in code
-- (src/usage/plan-limits.ts). 'internal' = unlimited (our own workspaces).
ALTER TABLE "orgs" ADD COLUMN "plan" text DEFAULT 'beta' NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_plan_check" CHECK ("plan" IN ('beta', 'internal'));
