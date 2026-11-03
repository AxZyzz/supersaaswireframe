-- T6.7: record which prompt revision produced each AI call.
ALTER TABLE "ai_usage" ADD COLUMN "prompt_version" text;
