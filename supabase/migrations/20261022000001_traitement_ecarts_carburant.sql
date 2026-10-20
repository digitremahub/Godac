-- Demande client (François, 20/10/2026) : « une action pour les écarts de
-- carburant ». L'encadrement traite l'écart d'un plein (justifier / classer,
-- avec commentaire obligatoire) ou demande une explication au chauffeur, qui
-- peut répondre. Chaque action est une ligne : le traitement reste visible
-- dans l'historique (qui, quand, quoi) ; la dernière action donne le statut
-- (lib/fuel/ecarts.ts, statutEcart).
--
-- Migration ADDITIVE et rejouable : table et index « if not exists »,
-- policies créées seulement si absentes, valeur d'enum « if not exists ».
-- Aucune suppression, aucun drop.

-- 1. Type d'alerte « explication demandée / réponse sur un écart ».
--    Ajoutée ici mais utilisée seulement par l'application (jamais dans
--    cette transaction), comme le permet PostgreSQL ≥ 12.
alter type public.alert_type add value if not exists 'fuel_gap_explanation';

-- 2. Journal de traitement des écarts ---------------------------------
create table if not exists public.fuel_gap_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fuel_entry_id uuid not null references public.fuel_entries (id) on delete cascade,
  -- traite               : écart justifié / classé (statut → traité)
  -- explication_demandee : question posée au chauffeur du plein (alerte)
  -- reponse_chauffeur    : réponse du chauffeur à cette question
  action text not null
    constraint fuel_gap_reviews_action_check check (action in ('traite', 'explication_demandee', 'reponse_chauffeur')),
  commentaire text not null
    constraint fuel_gap_reviews_commentaire_check check (char_length(btrim(commentaire)) between 3 and 2000),
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists fuel_gap_reviews_entry_idx on public.fuel_gap_reviews (fuel_entry_id, created_at);
create index if not exists fuel_gap_reviews_org_idx on public.fuel_gap_reviews (organization_id);

alter table public.fuel_gap_reviews enable row level security;

-- 3. RLS ---------------------------------------------------------------
-- Lecture : quiconque voit le plein (la sous-requête sur fuel_entries
-- passe par sa propre RLS : chauffeur = ses pleins, manager = son service,
-- direction / comptable = toute l'organisation).
-- Écriture : journal immuable (aucune policy update / delete).
--   - traite / explication_demandee : direction, ou manager du service du
--     véhicule — jamais sur son propre plein (manager qui conduit) ;
--   - reponse_chauffeur : le chauffeur du plein uniquement.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fuel_gap_reviews' and policyname = 'fuel_gap_reviews: read if entry visible'
  ) then
    create policy "fuel_gap_reviews: read if entry visible"
      on public.fuel_gap_reviews for select
      using (
        organization_id = public.current_organization_id()
        and exists (select 1 from public.fuel_entries fe where fe.id = fuel_gap_reviews.fuel_entry_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fuel_gap_reviews' and policyname = 'fuel_gap_reviews: insert by encadrement or driver reply'
  ) then
    create policy "fuel_gap_reviews: insert by encadrement or driver reply"
      on public.fuel_gap_reviews for insert
      with check (
        organization_id = public.current_organization_id()
        and created_by = public.current_app_user_id()
        and exists (
          select 1 from public.fuel_entries fe
          where fe.id = fuel_gap_reviews.fuel_entry_id
            and fe.organization_id = fuel_gap_reviews.organization_id
            and (
              (
                fuel_gap_reviews.action in ('traite', 'explication_demandee')
                and (
                  public.is_direction()
                  or (
                    public.is_manager_like()
                    and fe.driver_id <> public.current_app_user_id()
                    and exists (
                      select 1 from public.vehicles v
                      where v.id = fe.vehicle_id
                        and v.service_id = any (public.current_user_service_ids())
                    )
                  )
                )
              )
              or (
                fuel_gap_reviews.action = 'reponse_chauffeur'
                and fe.driver_id = public.current_app_user_id()
              )
            )
        )
      );
  end if;
end
$$;

comment on table public.fuel_gap_reviews is
  'Traitement des écarts carburant d''un plein (justification, demande d''explication, réponse du chauffeur). Journal immuable ; la dernière action donne le statut.';
