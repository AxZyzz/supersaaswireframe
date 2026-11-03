-- Password reset (T1.3). Global like users/refresh_tokens: the request comes
-- in before anyone is signed in, so there's no workspace context. Only the
-- SHA-256 of the emailed token is stored; tokens are single-use and expire.
CREATE TABLE "password_resets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_token_idx" ON "password_resets" ("token_hash");--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" ("user_id", "created_at");
