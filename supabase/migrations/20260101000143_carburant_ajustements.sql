-- Ajustements carburant appliqués en production le 14/10/2026, après
-- 121/122 (remplacements de fonctions uniquement, rejouables).
--
-- 1. tank_pmp_initial() : PMP d'une cuve tant qu'aucune livraison ne l'a
--    fixé (moyenne pondérée des livraisons, sinon dernier PMP connu).
--    Utilisé par le calcul d'un plein et d'une livraison.
-- 2. Correction d'un plein enregistré : la ligne d'historique de prix
--    est mise à jour sur place ; un plein à la cuve ne devient pas un
--    achat en station (annuler puis ressaisir).

create or replace function public.tank_pmp_initial(p_tank_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select round(sum(d.liters * d.unit_price) / nullif(sum(d.liters), 0), 4)
       from tank_deliveries d where d.tank_id = p_tank_id and d.unit_price is not null),
    (select h.pmp_after from fuel_price_history h where h.tank_id = p_tank_id order by h.recorded_at desc limit 1)
  );
$$;

revoke execute on function public.tank_pmp_initial(uuid) from public, anon, authenticated;

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

  if tg_op = 'UPDATE' and old.status in ('manual', 'validated') and old.tank_id is not distinct from new.tank_id then
    new.pmp_at_entry := old.pmp_at_entry;
  else
    select coalesce(pmp, public.tank_pmp_initial(id)) into new.pmp_at_entry from tanks where id = new.tank_id;
  end if;

  return new;
end;
$$;

create or replace function public.before_tank_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t tanks%rowtype;
  stock_plus numeric;
  pmp_courant numeric;
begin
  select * into t from tanks where id = new.tank_id for update;
  if not found or t.organization_id <> new.organization_id then
    raise exception 'Cuve introuvable pour cette organisation.' using errcode = '42501';
  end if;

  pmp_courant := coalesce(t.pmp, public.tank_pmp_initial(t.id));
  stock_plus := greatest(t.current_stock_liters, 0);
  new.stock_before := t.current_stock_liters;
  new.pmp_before := pmp_courant;
  new.pmp_after := case
    when new.unit_price is null then pmp_courant
    when pmp_courant is null or stock_plus = 0 then round(new.unit_price, 4)
    else round((stock_plus * pmp_courant + new.liters * new.unit_price) / (stock_plus + new.liters), 4)
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

create or replace function public.after_fuel_entry_corrected()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.tank_id is not null and new.tank_id is null then
    raise exception 'Un plein à la cuve ne devient pas un achat en station : annulez-le puis ressaisissez-le.' using errcode = '42501';
  end if;
  if old.tank_id is not null then
    update tanks set current_stock_liters = current_stock_liters + old.liters where id = old.tank_id;
  end if;
  if new.tank_id is not null then
    update tanks set current_stock_liters = current_stock_liters - new.liters where id = new.tank_id;
    update fuel_price_history
    set tank_id = new.tank_id, unit_price = new.unit_price, liters = new.liters,
        pmp_after = coalesce(new.pmp_at_entry, new.unit_price)
    where fuel_entry_id = new.id;
    if not found then
      insert into fuel_price_history (organization_id, tank_id, fuel_entry_id, unit_price, liters, pmp_after)
      values (new.organization_id, new.tank_id, new.id, new.unit_price, new.liters, coalesce(new.pmp_at_entry, new.unit_price));
    end if;
    update tanks
    set current_totalizer_index = new.totalizer_after, last_reading_at = new.occurred_at
    where id = new.tank_id and (last_reading_at is null or last_reading_at <= new.occurred_at);
  end if;
  return new;
end;
$$;
