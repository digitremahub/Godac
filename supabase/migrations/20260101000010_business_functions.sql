-- GODAC V2 — core business logic enforced at the database level so it
-- can never be bypassed by a client bug: PMP recomputation and
-- totalizer-continuity gap detection.
--
-- IMPORTANT: this trigger only fires for entries whose status is
-- 'manual' or 'validated' — i.e. human-confirmed data. An OCR row
-- sitting in pending_ocr/awaiting_validation never touches the tank's
-- totalizer index or the PMP trail, per the hard rule in the spec:
-- "ne jamais faire dépendre le calcul de l'écart de totaliseur d'une
-- donnée OCR non validée."

create or replace function public.compute_fuel_entry_derived()
returns trigger
language plpgsql
as $$
declare
  prev_entry fuel_entries%rowtype;
  cumulative_liters numeric(14, 2);
  cumulative_amount numeric(16, 4);
  new_pmp numeric(10, 4);
  gap numeric(12, 2);
  price_deviation numeric;
  gap_tolerance_liters constant numeric := 0.5;
  price_anomaly_threshold constant numeric := 0.15; -- 15% vs current PMP
begin
  -- Most recent trusted entry on the same tank, strictly before this
  -- one chronologically (continuity is per-tank, across all drivers).
  select * into prev_entry
  from fuel_entries
  where tank_id = new.tank_id
    and status in ('manual', 'validated')
    and id <> new.id
    and occurred_at <= new.occurred_at
  order by occurred_at desc, created_at desc
  limit 1;

  if found and new.totalizer_before is not null then
    gap := round(new.totalizer_before - prev_entry.totalizer_after, 2);
    new.totalizer_gap := gap;
    new.gap_flagged := abs(gap) > gap_tolerance_liters;
  else
    new.totalizer_gap := null;
    new.gap_flagged := false;
  end if;

  -- Weighted average price trail, sourced from fuel_price_history so
  -- it is O(1) per insert instead of re-scanning every past entry.
  select coalesce(sum(liters), 0), coalesce(sum(liters * unit_price), 0)
    into cumulative_liters, cumulative_amount
  from fuel_price_history
  where tank_id = new.tank_id;

  cumulative_liters := cumulative_liters + new.liters;
  cumulative_amount := cumulative_amount + (new.liters * new.unit_price);
  new_pmp := round(cumulative_amount / nullif(cumulative_liters, 0), 4);
  new.pmp_at_entry := new_pmp;

  return new;
end;
$$;

create trigger fuel_entries_compute_derived
  before insert or update of status, totalizer_before, totalizer_after, liters, unit_price, occurred_at
  on fuel_entries
  for each row
  when (new.status in ('manual', 'validated'))
  execute function public.compute_fuel_entry_derived();

-- After the derived columns are written, persist the PMP trail row,
-- bump the tank's live totalizer index, and raise alerts. Runs
-- `after` so it sees the final NEW row including trigger-computed
-- columns.
create or replace function public.after_fuel_entry_trusted()
returns trigger
language plpgsql
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

create trigger fuel_entries_after_trusted
  after insert or update of status
  on fuel_entries
  for each row
  when (new.status in ('manual', 'validated'))
  execute function public.after_fuel_entry_trusted();
