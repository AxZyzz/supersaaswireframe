-- Learning Loop T17: send windows + the send-time test. Additive only.
--
-- campaigns.send_window: when a campaign may send, as
--   {"days":[1..7],"startHour":0..23,"endHour":1..24,"tzBasis":"recipient"|"workspace"}
-- days are ISO weekdays (1 = Monday ... 7 = Sunday), hours are whole hours in
-- the recipient's timezone (or the workspace's), endHour is exclusive.
-- NULL = no window: the campaign sends whenever it is due, exactly as before.
--
-- experiment_variants.send_window: the same shape, one per arm of a send-time
-- test (experiments.kind = 'send_time'). NULL for subject tests. The subject of
-- a send-time arm is the step's own subject, identical in both arms.
--
-- No new table, so no new RLS block: both tables already carry org_id + tenant
-- isolation from 0052.

ALTER TABLE "campaigns" ADD COLUMN "send_window" jsonb;--> statement-breakpoint
ALTER TABLE "experiment_variants" ADD COLUMN "send_window" jsonb;
