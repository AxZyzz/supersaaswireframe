-- T2.7: engagement segment rules probe email_events by lead + type.
CREATE INDEX IF NOT EXISTS email_events_lead_type_idx ON email_events (lead_id, type);
