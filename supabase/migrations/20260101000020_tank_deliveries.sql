-- GODAC V2 — tank fuel deliveries ("approvisionnement"), the Phase 2
-- feature the /tanks page has been disclaiming since Module 4:
-- "[le niveau réel de carburant] nécessite de suivre les livraisons
-- de carburant, qui ne sont pas encore enregistrées dans GODAC."
--
-- `tanks.current_totalizer_index` stays exactly what it always was —
-- the cumulative dispensed-volume counter the totalizer-gap check
-- trusts, never touched by this migration. Physical remaining stock
-- is tracked separately as a simple running balance:
-- `current_stock_liters` goes up on each recorded delivery and down
-- on each trusted fuel entry, so no historical baseline hack is
-- needed — it starts at 0 for existing tanks and direction records
-- an initial delivery for their real current stock to seed it.

create table tank_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  tank_id uuid not null references tanks (id) on delete cascade,
  liters numeric(10, 2) not null check (liters > 0),
  unit_price numeric(10, 4),
  supplier text,
  delivered_at timestamptz not null default now(),
  recorded_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index tank_deliveries_tank_idx on tank_deliveries (tank_id, delivered_at);

alter table tanks add column current_stock_liters numeric(12, 2) not null default 0;

alter table tank_deliveries enable row level security;

create policy "tank_deliveries: read within org"
  on tank_deliveries for select
  using (organization_id = public.current_organization_id());

create policy "tank_deliveries: manager-like write scoped to service"
  on tank_deliveries for insert
  with check (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (
        public.is_manager_like()
        and exists (select 1 from tanks t where t.id = tank_deliveries.tank_id and t.service_id = any (public.current_user_service_ids()))
      )
    )
  );

-- Bumps the tank's stock and raises the (previously unused)
-- tank_overflow alert if the delivery pushes it past capacity —
-- doesn't block the insert, a manager may be intentionally
-- overfilling a buffer tank, but it should be visible.
create or replace function public.after_tank_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tank_capacity numeric(10, 2);
  new_stock numeric(12, 2);
begin
  update tanks
  set current_stock_liters = current_stock_liters + new.liters
  where id = new.tank_id
  returning capacity_liters, current_stock_liters into tank_capacity, new_stock;

  if new_stock > tank_capacity then
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
    values (
      new.organization_id,
      'tank_overflow',
      'warning',
      format('Stock estimé (%s L) dépasse la capacité de la cuve (%s L) après approvisionnement.', new_stock, tank_capacity),
      'tank_deliveries',
      new.id,
      array['manager', 'manager_chauffeur', 'direction']::user_role[]
    );
  end if;

  return new;
end;
$$;

create trigger tank_deliveries_after_insert
  after insert on tank_deliveries
  for each row
  execute function public.after_tank_delivery();

-- Pure trigger function, no legitimate direct caller — Supabase
-- grants EXECUTE to anon/authenticated directly at creation
-- (bypassing PUBLIC entirely), so both need an explicit revoke.
revoke execute on function public.after_tank_delivery() from anon, authenticated;

-- Extends the existing trusted-fuel-entry trigger to also draw down
-- the tank's physical stock, alongside what it already did (PMP
-- trail, totalizer index, gap/price alerts) — same trigger, so stock
-- and totalizer never fall out of step with each other. `set
-- search_path = public` re-pins what harden_functions established —
-- `create or replace` doesn't preserve it.
create or replace function public.after_fuel_entry_trusted()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  price_deviation numeric;
  price_anomaly_threshold constant numeric := 0.15;
begin
  insert into fuel_price_history (organization_id, tank_id, fuel_entry_id, unit_price, liters, pmp_after)
  values (new.organization_id, new.tank_id, new.id, new.unit_price, new.liters, new.pmp_at_entry);

  update tanks
  set current_totalizer_index = new.totalizer_after,
      last_reading_at = new.occurred_at
  where id = new.tank_id
    and (last_reading_at is null or last_reading_at <= new.occurred_at);

  update tanks
  set current_stock_liters = current_stock_liters - new.liters
  where id = new.tank_id;

  if new.gap_flagged then
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
    values (
      new.organization_id,
      'totalizer_gap',
      'critical',
      format('Écart de totaliseur de %s L détecté sur la cuve (ravitaillement du %s).', new.totalizer_gap, to_char(new.occurred_at, 'DD/MM/YYYY HH24:MI')),
      'fuel_entries',
      new.id,
      array['manager', 'manager_chauffeur', 'direction']::user_role[]
    );
  end if;

  if new.pmp_at_entry is not null and new.pmp_at_entry > 0 then
    price_deviation := abs(new.unit_price - new.pmp_at_entry) / new.pmp_at_entry;
    if price_deviation > price_anomaly_threshold then
      insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
      values (
        new.organization_id,
        'price_anomaly',
        'warning',
        format('Prix unitaire %.4f €/L inhabituel (PMP courant %.4f €/L).', new.unit_price, new.pmp_at_entry),
        'fuel_entries',
        new.id,
        array['manager', 'manager_chauffeur', 'direction']::user_role[]
      );
    end if;
  end if;

  return new;
end;
$$;
