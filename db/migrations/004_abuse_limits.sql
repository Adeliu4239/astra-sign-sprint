-- Abuse and resource protection (additive; independent of 003_templates).
-- Fixed-window counters: one row per (bucket, window). Incremented atomically with
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING, so concurrent serverless instances share them.
create table if not exists rate_limit_counters (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
create index if not exists rate_limit_counters_window_idx on rate_limit_counters(window_start);
create index if not exists upload_sessions_case_idx on upload_sessions(case_id, created_at);
