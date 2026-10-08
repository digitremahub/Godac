-- GODAC V2 — scope fleet/service alerts to the relevant team instead
-- of broadcasting every alert to every manager-like user org-wide.
--
-- `recipient_roles` (a set of roles) was never actually enforced by
-- RLS — "alerts: read within org for manager-like and comptable"
-- grants every manager/manager_chauffeur/direction/comptable user
-- read access to every alert in the organization regardless of its
-- content, the same way planning_entries scopes manager-like reads to
-- `service_id = any(current_user_service_ids())` but alerts never did.
-- A manager for Service A was seeing Service B's vehicle swaps, fuel
-- anomalies, maintenance requests, etc.
--
-- service_id is nullable — alerts with no natural vehicle/service
-- context (meeting_requests, support_requests to a gestionnaire,
-- convocations, planning_assignment/digest — all already personal via
-- recipient_user_id anyway) stay visible to every manager-like user,
-- same as today; direction and comptable keep full org-wide
-- visibility regardless.
alter table alerts add column service_id uuid references services (id) on delete set null;
create index alerts_org_service_idx on alerts (organization_id, service_id);

drop policy "alerts: read within org for manager-like and comptable" on alerts;
create policy "alerts: read within org for manager-like and comptable"
  on alerts for select
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_role() in ('direction', 'comptable')
      or (
        public.current_role() in ('manager', 'manager_chauffeur')
        and (service_id is null or service_id = any (public.current_user_service_ids()))
      )
    )
  );

-- ── fuel_entries: totalizer-gap / price-anomaly, via the vehicle ───
create or replace function public.after_fuel_entry_trusted()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  price_deviation numeric;
  price_anomaly_threshold constant numeric := 0.15;
  v_service_id uuid;
begin
  select service_id into v_service_id from vehicles where id = new.vehicle_id;

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
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles, service_id)
    values (
      new.organization_id,
      'totalizer_gap',
      'critical',
      format('Écart de totaliseur de %s L détecté sur la cuve (ravitaillement du %s).', new.totalizer_gap, to_char(new.occurred_at, 'DD/MM/YYYY HH24:MI')),
      'fuel_entries',
      new.id,
      array['manager', 'manager_chauffeur', 'direction']::user_role[],
      v_service_id
    );
  end if;

  if new.pmp_at_entry is not null and new.pmp_at_entry > 0 then
    price_deviation := abs(new.unit_price - new.pmp_at_entry) / new.pmp_at_entry;
    if price_deviation > price_anomaly_threshold then
      insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles, service_id)
      values (
        new.organization_id,
        'price_anomaly',
        'warning',
        format('Prix unitaire %.4f €/L inhabituel (PMP courant %.4f €/L).', new.unit_price, new.pmp_at_entry),
        'fuel_entries',
        new.id,
        array['manager', 'manager_chauffeur', 'direction']::user_role[],
        v_service_id
      );
    end if;
  end if;

  return new;
end;
$$;

-- ── tank_deliveries: tank_overflow, via the tank's own service ─────
create or replace function public.after_tank_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tank_capacity numeric(10, 2);
  new_stock numeric(12, 2);
  v_service_id uuid;
begin
  update tanks
  set current_stock_liters = current_stock_liters + new.liters
  where id = new.tank_id
  returning capacity_liters, current_stock_liters, service_id into tank_capacity, new_stock, v_service_id;

  if new_stock > tank_capacity then
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles, service_id)
    values (
      new.organization_id,
      'tank_overflow',
      'warning',
      format('Stock estimé (%s L) dépasse la capacité de la cuve (%s L) après approvisionnement.', new_stock, tank_capacity),
      'tank_deliveries',
      new.id,
      array['manager', 'manager_chauffeur', 'direction']::user_role[],
      v_service_id
    );
  end if;

  return new;
end;
$$;

-- ── vehicle_interventions: maintenance_request, via the vehicle ────
create or replace function public.after_vehicle_intervention_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_registration text;
  v_service_id uuid;
  computed_severity alert_severity;
begin
  select registration, service_id into vehicle_registration, v_service_id from vehicles where id = new.vehicle_id;

  computed_severity := case new.urgency
    when 'critical' then 'critical'
    when 'high' then 'warning'
    else 'info'
  end;

  insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles, service_id)
  values (
    new.organization_id,
    'maintenance_request',
    computed_severity,
    format('Nouvelle demande d''entretien (%s) pour %s — %s', new.urgency, coalesce(vehicle_registration, 'véhicule'), new.type),
    'vehicle_interventions',
    new.id,
    array['manager', 'manager_chauffeur', 'direction']::user_role[],
    v_service_id
  );

  return new;
end;
$$;

-- ── planning_entries: odometer_anomaly — service_id already on the row ──
create or replace function public.after_planning_entry_odometer_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gap_km numeric(12, 1);
  large_gap_threshold constant numeric := 1500;
  vehicle_registration text;
begin
  if new.end_km is null or new.start_km is null then
    return new;
  end if;
  if old.end_km is not null and old.end_km = new.end_km then
    return new;
  end if;

  gap_km := new.end_km - new.start_km;
  if gap_km > large_gap_threshold then
    select registration into vehicle_registration from vehicles where id = new.vehicle_id;

    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles, service_id)
    values (
      new.organization_id,
      'odometer_anomaly',
      'warning',
      format(
        'Tournée n°%s (%s) : écart de %s km entre départ et retour — à vérifier.',
        new.tour_number,
        coalesce(vehicle_registration, 'véhicule'),
        gap_km
      ),
      'planning_entries',
      new.id,
      array['manager', 'manager_chauffeur', 'direction']::user_role[],
      new.service_id
    );
  end if;

  return new;
end;
$$;

-- ── fuel_entries: consumption_anomaly, via the vehicle ─────────────
create or replace function public.after_fuel_entry_consumption_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  threshold_percent numeric;
  recent_liters numeric;
  recent_km numeric;
  baseline_liters numeric;
  baseline_km numeric;
  fillup_count int;
  recent_consumption numeric;
  baseline_consumption numeric;
  vehicle_registration text;
  v_service_id uuid;
begin
  select coalesce(consumption_anomaly_threshold_percent, 20) into threshold_percent
  from organizations where id = new.organization_id;

  select count(*), coalesce(sum(fe.liters), 0)
    into fillup_count, baseline_liters
  from fuel_entries fe
  join tanks t on t.id = fe.tank_id
  where fe.vehicle_id = new.vehicle_id
    and fe.status in ('manual', 'validated')
    and t.fuel_type = 'diesel'
    and fe.occurred_at between new.occurred_at - interval '90 days' and new.occurred_at;

  if fillup_count < 3 then
    return new;
  end if;

  select coalesce(sum(fe.liters), 0) into recent_liters
  from fuel_entries fe
  join tanks t on t.id = fe.tank_id
  where fe.vehicle_id = new.vehicle_id
    and fe.status in ('manual', 'validated')
    and t.fuel_type = 'diesel'
    and fe.occurred_at between new.occurred_at - interval '30 days' and new.occurred_at;

  baseline_km := public.vehicle_km_traveled(new.vehicle_id, new.occurred_at - interval '90 days', new.occurred_at);
  recent_km := public.vehicle_km_traveled(new.vehicle_id, new.occurred_at - interval '30 days', new.occurred_at);

  if baseline_km is null or baseline_km <= 0 or recent_km is null or recent_km <= 0 then
    return new;
  end if;

  baseline_consumption := round(baseline_liters / baseline_km * 100, 1);
  recent_consumption := round(recent_liters / recent_km * 100, 1);

  if baseline_consumption > 0 and recent_consumption > baseline_consumption * (1 + threshold_percent / 100.0) then
    select registration, service_id into vehicle_registration, v_service_id from vehicles where id = new.vehicle_id;

    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles, service_id)
    values (
      new.organization_id,
      'consumption_anomaly',
      'warning',
      format(
        'Consommation de %s en hausse : %s L/100km sur 30 jours contre %s L/100km habituellement.',
        coalesce(vehicle_registration, 'véhicule'),
        recent_consumption,
        baseline_consumption
      ),
      'fuel_entries',
      new.id,
      array['manager', 'manager_chauffeur', 'direction']::user_role[],
      v_service_id
    );
  end if;

  return new;
end;
$$;
