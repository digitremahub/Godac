-- Per-vehicle TICPE export lines, so exploitation/comptable can tick
-- off each one as correct or type a correction, instead of only ever
-- seeing the aggregated spreadsheet after the fact. The export route
-- keeps writing the aggregate onto ticpe_exports as before; this adds
-- the row-level detail underneath it.
create table ticpe_export_lines (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references ticpe_exports(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete restrict,
  registration text not null,
  vehicle_type text not null,
  entry_count integer not null,
  computed_total_liters numeric(12, 2) not null,
  computed_total_amount numeric(12, 2) not null,
  corrected_total_liters numeric(12, 2),
  corrected_total_amount numeric(12, 2),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'corrected')),
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index ticpe_export_lines_export_idx on ticpe_export_lines (export_id);
create index ticpe_export_lines_organization_id_idx on ticpe_export_lines (organization_id);

alter table ticpe_export_lines enable row level security;

create policy "ticpe_export_lines: read within org"
  on ticpe_export_lines for select
  using (organization_id = public.current_organization_id());

create policy "ticpe_export_lines: comptable/direction review"
  on ticpe_export_lines for update
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role() = 'comptable')
  )
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role() = 'comptable')
  );

-- A second file alongside the existing xlsx file_path — regenerated
-- in place whenever a line gets corrected, so the download always
-- reflects the latest reviewed figures.
alter table ticpe_exports add column pdf_file_path text;
