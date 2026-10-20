-- Décision client (20/10/2026) : « retire le compte manager chauffeur, par
-- contre ajoute la possibilité d'ajouter un chauffeur en manager ».
--
-- 1. Le rôle manager_chauffeur n'est plus attribuable. La valeur reste dans
--    l'enum user_role (la retirer d'un enum est risqué) et les fonctions
--    SQL qui la citent (is_manager_like(), policies colis_horaires…) restent
--    telles quelles. Vérifié le 20/10/2026 : aucun utilisateur n'a ce rôle,
--    la contrainte est donc valide dès sa création.
-- 2. users.can_drive : un manager qui conduit aussi (planning, tournées,
--    pleins, app Livreur, Tournée colis, badge + PIN, palier App Livreur).
--    Un chauffeur conduit toujours (dérivé du rôle dans l'application :
--    conduit = role = 'chauffeur' or (role = 'manager' and can_drive)).
--    « Passer manager » un chauffeur met can_drive à true.
--
-- Additif et idempotent : aucune suppression, aucun drop.

alter table public.users add column if not exists can_drive boolean not null default false;

comment on column public.users.can_drive is
  'Manager qui conduit aussi (planning, tournées, pleins, app Livreur, badge/PIN). Ignoré pour les autres rôles ; un chauffeur conduit toujours.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_role_sans_manager_chauffeur' and conrelid = 'public.users'::regclass) then
    alter table public.users add constraint users_role_sans_manager_chauffeur check (role <> 'manager_chauffeur');
  end if;
end $$;

-- Index partiel : listes de conducteurs (planning, affectations, palier).
create index if not exists users_conducteurs_idx
  on public.users (organization_id)
  where active and (role = 'chauffeur' or (role = 'manager' and can_drive));
