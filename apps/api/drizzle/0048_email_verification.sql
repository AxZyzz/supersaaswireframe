-- Email confirmation at sign-up. A new account can't sign in until its owner
-- clicks the emailed link (proves the address is real and theirs).
-- Everyone who already has an account is treated as confirmed so nobody is
-- locked out by this change. Invite registrations are confirmed by the invite
-- link itself. Global like users/password_resets (no workspace context yet).
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "users" SET "email_verified_at" = COALESCE("created_at", now()) WHERE "email_verified_at" IS NULL;--> statement-breakpoint
CREATE TABLE "email_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "email_verifications_token_idx" ON "email_verifications" ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verifications_user_idx" ON "email_verifications" ("user_id", "created_at");
