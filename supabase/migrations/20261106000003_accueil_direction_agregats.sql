-- Accueil de la direction : agrégats calculés par la base (coût carburant du
-- mois, coût par véhicule sur 30 jours, tournées par service) au lieu de
-- trois balayages complets de fuel_entries / planning_entries agrégés en
-- JavaScript. SECURITY INVOKER : la RLS de la personne connectée s'applique
-- (direction : toute l'organisation). Le code retombe sur l'ancien calcul
-- tant que cette fonction n'existe pas. ADDITIVE et rejouable ; NON
-- appliquée à la création.
create or replace function public.accueil_direction_agregats(p_depuis_mois timestamptz, p_depuis_30j timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'cout_mois', coalesce((
      select sum(f.total_amount) from fuel_entries f
      where f.status in ('manual', 'validated') and f.occurred_at >= p_depuis_mois
    ), 0),
    'cout_par_vehicule', coalesce((
      select jsonb_agg(x) from (
        select coalesce(v.registration, '—') as name, round(sum(f.total_amount))::int as value
        from fuel_entries f left join vehicles v on v.id = f.vehicle_id
        where f.status in ('manual', 'validated') and f.occurred_at >= p_depuis_30j
        group by 1 order by 2 desc limit 8
      ) x
    ), '[]'::jsonb),
    'tournees_par_service', coalesce((
      select jsonb_agg(x) from (
        select coalesce(s.name, '—') as name, count(*)::int as value
        from planning_entries p left join services s on s.id = p.service_id
        where p.status in ('in_progress', 'done') and p.start_at >= p_depuis_30j
        group by 1 order by 2 desc
      ) x
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.accueil_direction_agregats(timestamptz, timestamptz) to authenticated;
