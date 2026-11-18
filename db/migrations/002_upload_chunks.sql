-- Staging for chunked uploads (Vercel limits request bodies to ~4.5 MB).
create table upload_sessions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  filename text not null,
  mime text not null,
  total_bytes integer not null check (total_bytes > 0),
  chunk_count integer not null check (chunk_count > 0),
  created_at timestamptz not null default now()
);

create table upload_chunks (
  upload_id uuid not null references upload_sessions(id) on delete cascade,
  idx integer not null check (idx >= 0),
  data bytea not null,
  primary key (upload_id, idx)
);
