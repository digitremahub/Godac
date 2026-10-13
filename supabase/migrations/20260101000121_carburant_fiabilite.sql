-- Audit du module carburant : fiabilité des pleins, des cuves et du PMP.
--
-- Corrige :
-- 1. Triggers des pleins exécutés avec les droits de l'utilisateur : l'insert
--    dans fuel_price_history / alerts était refusé par la RLS (tout plein
--    saisi par un chauffeur ou un manager échouait), le plein précédent sur
--    la cuve était lu sous RLS (faux écarts de totaliseur) et le stock de la
--    cuve n'était pas décompté. → security definer.
-- 2. format('%.4f') inexistant en PostgreSQL : l'alerte prix plantait l'insert.
-- 3. PMP : les livraisons ne l'alimentaient pas. Le PMP est désormais porté
--    par la cuve et recalculé à chaque livraison :
--    PMP = (stock⁺ × PMP + litres livrés × prix) / (stock⁺ + litres livrés),
--    stock⁺ = max(stock, 0) ; une sortie (plein) ne change pas le PMP.
-- 4. Stock décompté deux fois quand un plein déjà enregistré était revalidé ;
--    modification d'un plein sans effet sur le stock. → triggers distincts
--    insert / passage en « de confiance » / modification (delta).
-- 5. Livraisons modifiables sans effet sur le stock → figées ; seule la
--    dernière livraison d'une cuve peut être annulée (stock et PMP restaurés).
-- 6. Cuve ou véhicule d'une autre organisation acceptés → refusés.
-- 7. Produit (gazole / AdBlue) enregistré sur chaque plein.
-- Les achats en station sans cuve et la RLS de modification des pleins
-- (qui remplacent des contraintes / policies existantes) sont dans la 122.

-- ── Produit acheté (gazole / AdBlue) ───────────────────────────────
alter table fuel_entries add column product text not null default 'gazole' check (product in ('gazole', 'adblue'));
-- Plein à la cuve : le produit est celui de la cuve.
update fuel_entries fe set product = 'adblue' from tanks t where t.id = fe.tank_id and t.fuel_type = 'adblue';

-- ── PMP porté par la cuve, instantanés sur les livraisons ─────────
alter table tanks add column pmp numeric(10, 4);
alter table tank_deliveries
  add column stock_before numeric(12, 2),
  add column pmp_before numeric(10, 4),
  add column pmp_after numeric(10, 4);

update tanks t set pmp = coalesce(
  (select round(sum(d.liters * d.unit_price) / nullif(sum(d.liters), 0), 4)
     from tank_deliveries d where d.tank_id = t.id and d.unit_price is not null),
  (select h.pmp_after from fuel_price_history h where h.tank_id = t.id order by h.recorded_at desc limit 1)
);

-- ── Contrôle d'appartenance (cuve / véhicule de la même organisation) ──
create or replace function public.check_fuel_entry_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tank_id is not null and not exists (select 1 from tanks where id = new.tank_id and organization_id = new.organization_id) then
    raise exception 'Cuve introuvable pour cette organisation.' using errcode = '42501';
  end if;
  if not exists (select 1 from vehicles where id = new.vehicle_id and organization_id = new.organization_id) then
    raise exception 'Véhicule introuvable pour cette organisation.' using errcode = '42501';
  end if;
  if new.tank_id is not null then
    select case when fuel_type = 'adblue' then 'adblue' else 'gazole' end into new.product from tanks where id = new.tank_id;
  end if;
  return new;
end;
$$;

create trigger fuel_entries_check_scope
  before insert or update of tank_id, vehicle_id, organization_id on fuel_entries
  for each row execute function public.check_fuel_entry_scope();

-- ── Valeurs dérivées d'un plein (avant écriture) ──────────────────
create or replace function public.compute_fuel_entry_derived()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_entry fuel_entries%rowtype;
  gap numeric(12, 2);
  gap_tolerance_liters constant numeric := 0.5;
begin
  if new.tank_id is null then
    -- Achat en station : ni cuve, ni totaliseur, ni PMP de cuve.
    new.totalizer_gap := null;
    new.gap_flagged := false;
    new.pmp_at_entry := null;
    return new;
  end if;

  select * into prev_entry
  from fuel_entries
  where tank_id = new.tank_id
    and status in ('manual', 'validated')
    and id <> new.id
    and occurred_at <= new.occurred_at
  order by occurred_at desc, created_at desc
  limit 1;

  if found and new.totalizer_before is not null and prev_entry.totalizer_after is not null then
    gap := round(new.totalizer_before - prev_entry.totalizer_after, 2);
    new.totalizer_gap := gap;
    new.gap_flagged := abs(gap) > gap_tolerance_liters;
  else
    new.totalizer_gap := null;
    new.gap_flagged := false;
  end if;

  -- Valorisation : PMP de la cuve au moment du plein (hors ce plein).
  if tg_op = 'UPDATE' and old.status in ('manual', 'validated') and old.tank_id is not distinct from new.tank_id then
    new.pmp_at_entry := old.pmp_at_entry;
  else
    select pmp into new.pmp_at_entry from tanks where id = new.tank_id;
  end if;

  return new;
end;
$$;

-- ── Effets d'un plein de confiance (stock, index, historique, alertes) ──
create or replace function public.after_fuel_entry_trusted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  price_deviation numeric;
  price_anomaly_threshold constant numeric := 0.15;
  v_service_id uuid;
begin
  -- Déjà de confiance avant cette mise à jour : effets déjà appliqués.
  if tg_op = 'UPDATE' and old.status in ('manual', 'validated') then
    return new;
  end if;
  if new.tank_id is null then
    return new;
  end if;

  select service_id into v_service_id from vehicles where id = new.vehicle_id;

  insert into fuel_price_history (organization_id, tank_id, fuel_entry_id, unit_price, liters, pmp_after)
  values (new.organization_id, new.tank_id, new.id, new.unit_price, new.liters, coalesce(new.pmp_at_entry, new.unit_price));

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
      new.organization_id, 'totalizer_gap', 'critical',
      format('Écart de totaliseur de %s L détecté sur la cuve (ravitaillement du %s).', new.totalizer_gap,
             to_char(new.occurred_at at time zone 'Europe/Paris', 'DD/MM/YYYY HH24:MI')),
      'fuel_entries', new.id, array['manager', 'manager_chauffeur', 'direction']::user_role[], v_service_id
    );
  end if;

  -- Litres déclarés incohérents avec le totaliseur avant/après.
  if new.totalizer_before is not null and new.totalizer_after is not null
     and abs((new.totalizer_after - new.totalizer_before) - new.liters) > 0.5 then
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles, service_id)
    values (
      new.organization_id, 'totalizer_gap', 'critical',
      format('Plein incohérent : le totaliseur indique %s L mais %s L ont été déclarés (ravitaillement du %s).',
             round(new.totalizer_after - new.totalizer_before, 2), new.liters,
             to_char(new.occurred_at at time zone 'Europe/Paris', 'DD/MM/YYYY HH24:MI')),
      'fuel_entries', new.id, array['manager', 'manager_chauffeur', 'direction']::user_role[], v_service_id
    );
  end if;

  if new.pmp_at_entry is not null and new.pmp_at_entry > 0 then
    price_deviation := abs(new.unit_price - new.pmp_at_entry) / new.pmp_at_entry;
    if price_deviation > price_anomaly_threshold then
      insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles, service_id)
      values (
        new.organization_id, 'price_anomaly', 'warning',
        format('Prix unitaire %s €/L inhabituel (PMP de la cuve %s €/L).', round(new.unit_price, 4), round(new.pmp_at_entry, 4)),
        'fuel_entries', new.id, array['manager', 'manager_chauffeur', 'direction']::user_role[], v_service_id
      );
    end if;
  end if;

  return new;
end;
$$;

-- Modification d'un plein déjà enregistré : on annule l'ancien effet, on applique le nouveau.
create or replace function public.after_fuel_entry_corrected()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.tank_id is not null then
    update tanks set current_stock_liters = current_stock_liters + old.liters where id = old.tank_id;
  end if;
  delete from fuel_price_history where fuel_entry_id = new.id;
  if new.tank_id is not null then
    update tanks set current_stock_liters = current_stock_liters - new.liters where id = new.tank_id;
    insert into fuel_price_history (organization_id, tank_id, fuel_entry_id, unit_price, liters, pmp_after)
    values (new.organization_id, new.tank_id, new.id, new.unit_price, new.liters, coalesce(new.pmp_at_entry, new.unit_price));
    update tanks
    set current_totalizer_index = new.totalizer_after, last_reading_at = new.occurred_at
    where id = new.tank_id and (last_reading_at is null or last_reading_at <= new.occurred_at);
  end if;
  return new;
end;
$$;

create trigger fuel_entries_compute_derived_tank
  before update of tank_id on fuel_entries
  for each row when (new.status in ('manual', 'validated'))
  execute function public.compute_fuel_entry_derived();

create trigger fuel_entries_after_corrected
  after update of tank_id, liters, unit_price, totalizer_after, occurred_at on fuel_entries
  for each row when (old.status in ('manual', 'validated') and new.status in ('manual', 'validated'))
  execute function public.after_fuel_entry_corrected();

-- Consommation : vérifiée une seule fois par plein (pas de doublon d'alerte à la revalidation).
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
  if tg_op = 'UPDATE' and old.status in ('manual', 'validated') then
    return new;
  end if;
  if new.product <> 'gazole' then
    return new;
  end if;

  select coalesce(consumption_anomaly_threshold_percent, 20) into threshold_percent
  from organizations where id = new.organization_id;

  select count(*), coalesce(sum(fe.liters), 0)
    into fillup_count, baseline_liters
  from fuel_entries fe
  where fe.vehicle_id = new.vehicle_id
    and fe.status in ('manual', 'validated')
    and fe.product = 'gazole'
    and fe.occurred_at between new.occurred_at - interval '90 days' and new.occurred_at;

  if fillup_count < 3 then
    return new;
  end if;

  select coalesce(sum(fe.liters), 0) into recent_liters
  from fuel_entries fe
  where fe.vehicle_id = new.vehicle_id
    and fe.status in ('manual', 'validated')
    and fe.product = 'gazole'
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

    -- Une seule alerte non traitée par véhicule à la fois.
    if exists (
      select 1 from alerts a
      join fuel_entries fe on fe.id = a.related_id
      where a.type = 'consumption_anomaly' and a.related_table = 'fuel_entries'
        and fe.vehicle_id = new.vehicle_id and a.acknowledged_at is null
    ) then
      return new;
    end if;

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

-- ── Livraisons : PMP, contrôle d'appartenance, figées, annulation ──
create or replace function public.before_tank_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t tanks%rowtype;
  stock_plus numeric;
begin
  select * into t from tanks where id = new.tank_id for update;
  if not found or t.organization_id <> new.organization_id then
    raise exception 'Cuve introuvable pour cette organisation.' using errcode = '42501';
  end if;

  stock_plus := greatest(t.current_stock_liters, 0);
  new.stock_before := t.current_stock_liters;
  new.pmp_before := t.pmp;
  new.pmp_after := case
    when new.unit_price is null then t.pmp
    when t.pmp is null or stock_plus = 0 then round(new.unit_price, 4)
    else round((stock_plus * t.pmp + new.liters * new.unit_price) / (stock_plus + new.liters), 4)
  end;

  update tanks
  set current_stock_liters = current_stock_liters + new.liters,
      pmp = new.pmp_after
  where id = new.tank_id;

  if t.current_stock_liters + new.liters > t.capacity_liters then
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles, service_id)
    values (
      new.organization_id, 'tank_overflow', 'warning',
      format('Stock estimé (%s L) dépasse la capacité de la cuve (%s L) après approvisionnement.', t.current_stock_liters + new.liters, t.capacity_liters),
      'tank_deliveries', new.id, array['manager', 'manager_chauffeur', 'direction']::user_role[], t.service_id
    );
  end if;

  return new;
end;
$$;

-- L'ancien trigger AFTER ne fait plus rien : tout est fait avant l'écriture.
create or replace function public.after_tank_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;

create trigger tank_deliveries_before_insert
  before insert on tank_deliveries
  for each row execute function public.before_tank_delivery();

-- Une livraison enregistrée est figée (seule la facture peut être jointe).
create or replace function public.tank_delivery_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.tank_id is distinct from old.tank_id or new.liters is distinct from old.liters
     or new.unit_price is distinct from old.unit_price or new.delivered_at is distinct from old.delivered_at
     or new.organization_id is distinct from old.organization_id
     or new.stock_before is distinct from old.stock_before or new.pmp_before is distinct from old.pmp_before
     or new.pmp_after is distinct from old.pmp_after then
    raise exception 'Une livraison enregistrée ne se modifie pas : annulez-la puis ressaisissez-la.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tank_deliveries_immutable
  before update on tank_deliveries
  for each row execute function public.tank_delivery_immutable();

-- Annulation : uniquement la dernière livraison de la cuve (PMP restauré exactement).
create or replace function public.before_tank_delivery_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from tanks where id = old.tank_id for update;
  if exists (
    select 1 from tank_deliveries d
    where d.tank_id = old.tank_id and d.id <> old.id
      and (d.created_at > old.created_at or (d.created_at = old.created_at and d.id > old.id))
  ) then
    raise exception 'Seule la dernière livraison d''une cuve peut être annulée.' using errcode = '42501';
  end if;
  update tanks
  set current_stock_liters = current_stock_liters - old.liters,
      pmp = case when old.pmp_after is not null then old.pmp_before else pmp end
  where id = old.tank_id;
  return old;
end;
$$;

create trigger tank_deliveries_before_delete
  before delete on tank_deliveries
  for each row execute function public.before_tank_delivery_delete();

create policy "tank_deliveries: manager-like cancel scoped to service"
  on tank_deliveries for delete
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or (public.is_manager_like() and exists (
      select 1 from tanks t where t.id = tank_deliveries.tank_id and t.service_id = any (public.current_user_service_ids())
    )))
  );

-- Le PMP et l'index d'une cuve ne s'écrivent que par les triggers.
create or replace function public.tank_guard_derived()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.pmp is distinct from old.pmp
    or new.current_stock_liters is distinct from old.current_stock_liters
    or new.current_totalizer_index is distinct from old.current_totalizer_index) then
    raise exception 'Le stock, l''index et le PMP d''une cuve sont calculés par GODAC.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tanks_guard_derived
  before update on tanks
  for each row execute function public.tank_guard_derived();

revoke execute on function public.check_fuel_entry_scope() from public, anon, authenticated;
revoke execute on function public.compute_fuel_entry_derived() from public, anon, authenticated;
revoke execute on function public.after_fuel_entry_trusted() from public, anon, authenticated;
revoke execute on function public.after_fuel_entry_corrected() from public, anon, authenticated;
revoke execute on function public.after_fuel_entry_consumption_check() from public, anon, authenticated;
revoke execute on function public.before_tank_delivery() from public, anon, authenticated;
revoke execute on function public.before_tank_delivery_delete() from public, anon, authenticated;
