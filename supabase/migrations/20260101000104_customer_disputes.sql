-- Module « Contestations clients » : une réclamation client (colis non
-- reçu, endommagé, litige de livraison…) est photographiée ou importée,
-- lue par OCR, rattachée par suggestion au chauffeur concerné puis
-- validée par un humain ; le chauffeur est alors notifié pour régler
-- le problème et répond dans GODAC.

alter type alert_type add value if not exists 'customer_dispute';

insert into modules (key, name, description, wave, is_transverse, base_price, included_from_plan, sort_order) values
  ('customer_disputes', 'Contestations clients', 'Réclamations clients lues par OCR, rattachées au chauffeur concerné après validation humaine, notification et réponse du chauffeur.', 'v2', false, 19, null, 32)
on conflict (key) do nothing;

insert into module_plan_prices (module_key, plan_id, monthly_price, setup_price, included)
select 'customer_disputes', p.id, 19, 0, false
from plans p
on conflict do nothing;

create table customer_disputes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  status text not null default 'to_validate' check (status in ('to_validate', 'assigned', 'answered', 'resolved', 'rejected')),
  document_path text,
  client_name text,
  reference text,
  parcel_code text,
  delivery_address text,
  delivery_date date,
  tour_number text,
  reason text,
  claimed_amount numeric(10, 2),
  -- Suggestion automatique (jamais appliquée sans validation humaine).
  suggested_driver_id uuid references users (id) on delete set null,
  suggestion_reason text,
  driver_id uuid references users (id) on delete set null,
  validated_by uuid references users (id) on delete set null,
  validated_at timestamptz,
  driver_response text,
  responded_at timestamptz,
  resolution_note text,
  resolved_at timestamptz,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customer_disputes_org_status_idx on customer_disputes (organization_id, status);
create index customer_disputes_driver_idx on customer_disputes (driver_id);

alter table customer_disputes enable row level security;

create policy "customer_disputes: manager-like all within org"
  on customer_disputes for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());

-- Le chauffeur ne voit que les contestations validées qui lui sont attribuées.
create policy "customer_disputes: driver reads own"
  on customer_disputes for select
  using (organization_id = public.current_organization_id() and driver_id = public.current_app_user_id() and status <> 'to_validate');

insert into storage.buckets (id, name, public)
values ('dispute-docs', 'dispute-docs', false)
on conflict (id) do nothing;

create policy "dispute-docs: manager-like read within org"
  on storage.objects for select
  using (
    bucket_id = 'dispute-docs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_manager_like()
  );

create policy "dispute-docs: manager-like upload within org"
  on storage.objects for insert
  with check (
    bucket_id = 'dispute-docs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_manager_like()
  );
