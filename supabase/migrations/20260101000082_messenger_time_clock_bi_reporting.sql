-- GODAC Messenger: simple 1:1 internal chat between org users.
create table messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  recipient_id uuid not null references users(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index messages_sender_idx on messages (organization_id, sender_id, created_at);
create index messages_recipient_idx on messages (organization_id, recipient_id, created_at);

alter table messages enable row level security;

create policy "messages: read own thread"
  on messages for select
  using (organization_id = current_organization_id() and (sender_id = current_app_user_id() or recipient_id = current_app_user_id()));

create policy "messages: send as self"
  on messages for insert
  with check (organization_id = current_organization_id() and sender_id = current_app_user_id());

create policy "messages: mark own received read"
  on messages for update
  using (organization_id = current_organization_id() and recipient_id = current_app_user_id())
  with check (organization_id = current_organization_id() and recipient_id = current_app_user_id());

-- Pointeuse Électronique: clock in/out. Direction-visible for payroll
-- cross-check, kept deliberately simple (no service scoping) for a
-- first version — see /reporting for aggregate hours, this table is
-- the raw log.
create table time_clock_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  clocked_in_at timestamptz not null default now(),
  clocked_out_at timestamptz,
  created_at timestamptz not null default now()
);
create index time_clock_entries_user_idx on time_clock_entries (user_id, clocked_in_at desc);

alter table time_clock_entries enable row level security;

create policy "time_clock: read own or direction"
  on time_clock_entries for select
  using (organization_id = current_organization_id() and (user_id = current_app_user_id() or is_direction()));

create policy "time_clock: insert own"
  on time_clock_entries for insert
  with check (organization_id = current_organization_id() and user_id = current_app_user_id());

create policy "time_clock: close own open entry"
  on time_clock_entries for update
  using (organization_id = current_organization_id() and user_id = current_app_user_id() and clocked_out_at is null)
  with check (organization_id = current_organization_id() and user_id = current_app_user_id());

-- These three modules are real and built as of this migration — the
-- v3 tag was hiding them from every pricing surface, same fix as
-- 20260101000081 for the HR group.
update modules set wave = 'v2' where key in ('messenger', 'time_clock', 'bi_reporting');

update module_plan_prices set monthly_price = 19, setup_price = 190 where module_key = 'messenger' and plan_id in ('essentiel', 'starter');
update module_plan_prices set monthly_price = 29, setup_price = 290 where module_key = 'messenger' and plan_id in ('pro', 'business');

update module_plan_prices set monthly_price = 19, setup_price = 190 where module_key = 'time_clock' and plan_id in ('essentiel', 'starter');
update module_plan_prices set monthly_price = 29, setup_price = 290 where module_key = 'time_clock' and plan_id in ('pro', 'business');

update module_plan_prices set monthly_price = 39, setup_price = 390 where module_key = 'bi_reporting' and plan_id in ('essentiel', 'starter');
update module_plan_prices set monthly_price = 59, setup_price = 590 where module_key = 'bi_reporting' and plan_id in ('pro', 'business');
