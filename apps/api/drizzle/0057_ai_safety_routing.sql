-- Learning Loop T08: Model Armor safety flag on inbound messages, and the
-- operator console's cross-tenant AI usage aggregate (AI routing card).
-- Additive only.

ALTER TABLE "conversation_messages" ADD COLUMN "safety_flag" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Aggregates only (feature, model, calls, tokens): no org ids, no content.
CREATE OR REPLACE FUNCTION operator_ai_usage(p_hours int)
RETURNS TABLE (feature text, provider text, model text, calls int, input_tokens bigint, output_tokens bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT u.feature, u.provider, u.model, count(*)::int,
         COALESCE(sum(u.input_tokens), 0)::bigint,
         COALESCE(sum(u.output_tokens), 0)::bigint
  FROM ai_usage u
  WHERE u.created_at > now() - make_interval(hours => p_hours)
  GROUP BY u.feature, u.provider, u.model
  ORDER BY count(*) DESC;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION operator_ai_usage(int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION operator_ai_usage(int) TO supersaas_app;
