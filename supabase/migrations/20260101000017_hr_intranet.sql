-- GODAC V2 — V1-wave HR & Intranet schema (modules `employee_files`,
-- `payslips`, `hr_status`, `intranet` in the catalog — see
-- 20260101000015_module_catalog.sql). Schema + RLS land now so the
-- data model is stable; UI ships module by module afterwards, same
-- pattern as 20260101000005_planning_rh.sql before it.

create type contract_type as enum ('cdi', 'cdd', 'interim', 'apprentissage');

-- Manually-set states cover what no other module can infer
-- (suspended/terminated); 'active' and 'on_leave' are otherwise
-- derived at read time by compute_hr_status() below, which folds in
-- today's approved leave_requests — this is the "statut employé
-- déduit automatiquement des autres modules" module, not a column a
-- background job has to keep in sync.
create type hr_status as enum ('active', 'on_leave', 'suspended', 'terminated');

create type payslip_status as enum ('generated', 'sent');

-- One row per employee, holding what fuel/fleet/leave data never
-- needed: contract terms and a restricted-access notes field. Kept
-- separate from `users` so the (broadly-read) profile table never
-- carries HR data.
create table employee_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null unique references users (id) on delete cascade,
  contract_type contract_type,
  hire_date date,
  contract_end_date date,
  hr_status hr_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index employee_files_organization_id_idx on employee_files (organization_id);

create trigger employee_files_set_updated_at
  before update on employee_files
  for each row execute function set_updated_at();

-- Derives an employee's current HR status: a manually-set
-- suspended/terminated always wins; otherwise 'on_leave' when an
-- approved leave_requests row covers today, else 'active'. Called
-- from the UI rather than stored, so it can never drift out of sync
-- with leave decisions made after the fact.
--
-- Scoped to the caller's own organization and to self-or-direction —
-- without that check this SECURITY DEFINER function would leak any
-- org's employee HR status to any authenticated caller who guesses a
-- user id. anon has no legitimate reason to call this at all.
create or replace function public.compute_hr_status(p_user_id uuid)
returns hr_status
language sql
stable
security definer
set search_path = public
as $$
  select case
    when ef.hr_status in ('suspended', 'terminated') then ef.hr_status
    when exists (
      select 1 from leave_requests lr
      where lr.driver_id = p_user_id
        and lr.status = 'approved'
        and current_date between lr.start_date and lr.end_date
    ) then 'on_leave'::hr_status
    else 'active'::hr_status
  end
  from employee_files ef
  where ef.user_id = p_user_id
    and ef.organization_id = public.current_organization_id()
    and (p_user_id = public.current_app_user_id() or public.is_direction());
$$;

revoke execute on function public.compute_hr_status(uuid) from anon;

-- Contracts, ID copies, medical fitness certificates, etc. — the
-- file itself lives in the `employee-documents` storage bucket
-- (added below), this row is just the metadata + access control.
create table employee_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  employee_file_id uuid not null references employee_files (id) on delete cascade,
  doc_type text not null,
  file_path text not null,
  uploaded_by uuid references users (id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index employee_documents_employee_file_idx on employee_documents (employee_file_id);

-- Generated/uploaded bulletins, one per employee per period. The
-- French TRM-specific payroll computation itself (convention
-- collective rules, cotisations, etc.) is out of scope here — this
-- table stores the resulting document + headline amounts, produced
-- however GODAC staff or an eventual payroll integration generates
-- them, not computed by this schema.
create table payslips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  gross_amount numeric(10, 2),
  net_amount numeric(10, 2),
  file_path text not null,
  status payslip_status not null default 'generated',
  generated_by uuid references users (id) on delete set null,
  generated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (user_id, period_start, period_end)
);

create index payslips_user_idx on payslips (user_id, period_start);

-- Intranet & Convocations: a note/convocation targeted at one
-- service or the whole org, with a per-reader read receipt (the
-- "statut lu/non lu" from the module description).
create table announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  service_id uuid references services (id) on delete cascade,
  title text not null,
  body text not null,
  requires_acknowledgement boolean not null default false,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index announcements_organization_id_idx on announcements (organization_id);
create index announcements_service_id_idx on announcements (service_id);

create table announcement_reads (
  announcement_id uuid not null references announcements (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- ── RLS ──────────────────────────────────────────────────────────
alter table employee_files enable row level security;
alter table employee_documents enable row level security;
alter table payslips enable row level security;
alter table announcements enable row level security;
alter table announcement_reads enable row level security;

-- ── employee_files ───────────────────────────────────────────────
create policy "employee_files: own record or direction"
  on employee_files for select
  using (
    organization_id = public.current_organization_id()
    and (user_id = public.current_app_user_id() or public.is_direction())
  );

create policy "employee_files: direction manages"
  on employee_files for insert
  with check (organization_id = public.current_organization_id() and public.is_direction());

create policy "employee_files: direction updates"
  on employee_files for update
  using (organization_id = public.current_organization_id() and public.is_direction());

create policy "employee_files: direction deletes"
  on employee_files for delete
  using (organization_id = public.current_organization_id() and public.is_direction());

-- ── employee_documents ───────────────────────────────────────────
create policy "employee_documents: own record or direction"
  on employee_documents for select
  using (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or exists (
        select 1 from employee_files ef
        where ef.id = employee_documents.employee_file_id
          and ef.user_id = public.current_app_user_id()
      )
    )
  );

create policy "employee_documents: direction manages"
  on employee_documents for all
  using (organization_id = public.current_organization_id() and public.is_direction())
  with check (organization_id = public.current_organization_id() and public.is_direction());

-- ── payslips ──────────────────────────────────────────────────────
create policy "payslips: own record or direction"
  on payslips for select
  using (
    organization_id = public.current_organization_id()
    and (user_id = public.current_app_user_id() or public.is_direction())
  );

create policy "payslips: direction manages"
  on payslips for insert
  with check (organization_id = public.current_organization_id() and public.is_direction());

create policy "payslips: direction updates"
  on payslips for update
  using (organization_id = public.current_organization_id() and public.is_direction());

create policy "payslips: direction deletes"
  on payslips for delete
  using (organization_id = public.current_organization_id() and public.is_direction());

-- ── announcements ────────────────────────────────────────────────
create policy "announcements: read within org and service scope"
  on announcements for select
  using (
    organization_id = public.current_organization_id()
    and (service_id is null or public.is_direction() or service_id = any (public.current_user_service_ids()))
  );

create policy "announcements: manager-like writes"
  on announcements for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());

-- ── announcement_reads ───────────────────────────────────────────
create policy "announcement_reads: own reads, manager-like sees all in scope"
  on announcement_reads for select
  using (
    user_id = public.current_app_user_id()
    or exists (
      select 1 from announcements a
      where a.id = announcement_reads.announcement_id
        and a.organization_id = public.current_organization_id()
        and public.is_manager_like()
    )
  );

create policy "announcement_reads: mark own read"
  on announcement_reads for insert
  with check (user_id = public.current_app_user_id());

-- ── storage ──────────────────────────────────────────────────────
-- Same tenant-isolation-by-path convention as fuel-tickets/ticpe-exports:
-- `<organization_id>/<user_id>/<filename>`.
insert into storage.buckets (id, name, public)
values ('employee-documents', 'employee-documents', false), ('payslips', 'payslips', false)
on conflict (id) do nothing;

create policy "employee-documents: own docs or direction"
  on storage.objects for select
  using (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and ((storage.foldername(name))[2] = public.current_app_user_id()::text or public.is_direction())
  );

create policy "employee-documents: direction writes"
  on storage.objects for all
  using (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_direction()
  )
  with check (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_direction()
  );

create policy "payslips-storage: own payslip or direction"
  on storage.objects for select
  using (
    bucket_id = 'payslips'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and ((storage.foldername(name))[2] = public.current_app_user_id()::text or public.is_direction())
  );

create policy "payslips-storage: direction writes"
  on storage.objects for all
  using (
    bucket_id = 'payslips'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_direction()
  )
  with check (
    bucket_id = 'payslips'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_direction()
  );
