-- Journal immuable des événements de chaque arrêt de livraison.
create table if not exists delivery_stop_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references delivery_runs(id) on delete cascade,
  stop_id uuid not null references delivery_stops(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  event_type text not null check (event_type in (
    'stop_created', 'status_changed', 'delivered', 'failed', 'reopened',
    'reordered', 'list_changed', 'pickup_count_recorded', 'sms_prepared',
    'sms_confirmed_sent', 'call_started', 'call_confirmed', 'note'
  )),
  previous_value jsonb,
  new_value jsonb,
  details text,
  created_at timestamptz not null default now()
);
create index if not exists delivery_stop_events_stop_created_idx
  on delivery_stop_events (stop_id, created_at desc);
create index if not exists delivery_stop_events_run_created_idx
  on delivery_stop_events (run_id, created_at desc);
alter table delivery_stop_events enable row level security;
drop policy if exists delivery_stop_events_select_org on delivery_stop_events;
create policy delivery_stop_events_select_org on delivery_stop_events
  for select using (organization_id = (select organization_id from users where id = auth.uid()));
drop policy if exists delivery_stop_events_insert_org on delivery_stop_events;
create policy delivery_stop_events_insert_org on delivery_stop_events
  for insert with check (organization_id = (select organization_id from users where id = auth.uid()));
