-- T2.3: per-workspace lead status list ({name,color}[]); NULL = defaults.
ALTER TABLE orgs ADD COLUMN lead_statuses jsonb;
