-- A/B winner without rewriting the variant list. Applying a winner used to
-- overwrite subject_variants with [winner], which renumbered it to index 0:
-- later winner sends were credited to the losing version A and the per-version
-- stats were corrupted. Now the list stays as it is and the chosen version's
-- original index is stored; the send loop uses it for every remaining lead
-- (the losers are effectively paused). Editing the versions clears it.
ALTER TABLE "campaign_steps" ADD COLUMN "winner_index" integer;
