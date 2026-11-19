-- Reusable agreement templates. A template is a workspace-scoped `cases` row with kind = 'template':
-- its PDF is a normal `documents` row and its field layout lives on a draft request that is never sent.
-- Creating a case from a template COPIES the PDF and fields into new rows, so later template edits or
-- deletion never touch existing cases. Additive and backward compatible: existing rows default to 'client'.
alter table cases add column if not exists kind text not null default 'client';
alter table cases drop constraint if exists cases_kind_check;
alter table cases add constraint cases_kind_check check (kind in ('client', 'template'));
alter table cases add column if not exists template_id uuid references cases(id) on delete set null;
create index if not exists cases_workspace_kind_idx on cases(workspace_id, kind, created_at desc);
