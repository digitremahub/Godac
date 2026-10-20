-- Tournée colis clôturée : ses arrêts sont figés.
--
-- Un chauffeur pouvait encore « Annuler » une livraison (remise à faire),
-- la déplacer ou la corriger après la clôture de la tournée. L'API le
-- refuse désormais (lib/colis/cloture.ts, tourneeCloturee) ; la base le
-- refuse aussi pour tout appel venant du site ou de l'application
-- (rôles anon / authenticated). Le service (clé serveur, SQL de
-- maintenance) garde la main pour une correction exceptionnelle.
-- La suppression d'un arrêt n'est pas concernée : la suppression d'une
-- tournée clôturée reste réservée à la direction (migration 190) et ses
-- arrêts partent en cascade.

set local lock_timeout = '10s';

create or replace function public.delivery_stops_protect_done_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() not in ('anon', 'authenticated') then
    return new;
  end if;
  if exists (select 1 from public.delivery_runs r where r.id = new.run_id and r.status = 'done')
     or (tg_op = 'UPDATE' and new.run_id is distinct from old.run_id
         and exists (select 1 from public.delivery_runs r where r.id = old.run_id and r.status = 'done')) then
    raise exception 'Tournée clôturée : ses livraisons ne peuvent plus être modifiées ni annulées.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger delivery_stops_protect_done_run
  before insert or update on public.delivery_stops
  for each row execute function public.delivery_stops_protect_done_run();
