-- Génération à la demande d'une semaine à venir (« Générer le planning de la
-- semaine du … ») : la ligne de suivi planning_semaines_auto porte
-- genere_par = 'manuel' (au lieu de 'auto' pour le cron du jeudi).
--
-- ADDITIF et rejouable : la contrainte nommée est remplacée par une version plus
-- large (aucune donnée existante ne peut la violer). Sans effet si la table de suivi
-- (20261111000001) n'existe pas encore. NON appliquée à la création : sans elle,
-- le code note 'auto' à la place (repli sur la violation de contrainte 23514).

set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.planning_semaines_auto') is not null then
    alter table public.planning_semaines_auto drop constraint if exists planning_semaines_auto_genere_par_check;
    alter table public.planning_semaines_auto add constraint planning_semaines_auto_genere_par_check check (genere_par in ('auto', 'manuel'));
  end if;
end $$;

notify pgrst, 'reload schema';
