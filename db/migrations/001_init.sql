-- FileSign initial schema. PDFs are stored privately in Postgres (bytea) so that
-- artifact + status + audit event commit in one transaction.
create extension if not exists pgcrypto;

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  session_hash text not null unique,
  created_at timestamptz not null default now()
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  client_name text not null,
  client_email text not null,
  created_at timestamptz not null default now()
);
create index cases_workspace_idx on cases(workspace_id, created_at desc);

create table documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  kind text not null check (kind in ('original', 'signed')),
  filename text not null,
  mime text not null default 'application/pdf',
  size_bytes integer not null,
  page_count integer not null,
  sha256 text not null,
  content bytea not null,
  created_at timestamptz not null default now()
);
create index documents_case_idx on documents(case_id, created_at desc);

create table signing_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'pending', 'completed', 'revoked')),
  token_hash text unique,
  token_ciphertext text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  signer_name text,
  signed_document_id uuid references documents(id),
  constraint completed_has_artifact check (status <> 'completed' or (signed_document_id is not null and completed_at is not null)),
  constraint pending_has_token check (status = 'draft' or token_hash is not null)
);
create index signing_requests_case_idx on signing_requests(case_id, created_at desc);

create table signature_fields (
  id uuid primary key default gen_random_uuid(),
  signing_request_id uuid not null references signing_requests(id) on delete cascade,
  kind text not null check (kind in ('signature', 'name', 'date')),
  page_index integer not null check (page_index >= 0),
  -- Normalised [0,1] rectangle in the page's *displayed* (rotation-applied) space, top-left origin.
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),
  width double precision not null check (width > 0 and width <= 1),
  height double precision not null check (height > 0 and height <= 1),
  created_at timestamptz not null default now()
);
create index signature_fields_request_idx on signature_fields(signing_request_id);

create table signing_events (
  id bigserial primary key,
  case_id uuid not null references cases(id) on delete cascade,
  signing_request_id uuid references signing_requests(id) on delete cascade,
  event_type text not null,
  actor text not null check (actor in ('admin', 'signer', 'system')),
  occurred_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb
);
create index signing_events_case_idx on signing_events(case_id, occurred_at);
