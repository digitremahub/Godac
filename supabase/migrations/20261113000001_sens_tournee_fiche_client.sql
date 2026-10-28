-- Sens habituel des tournées et fiche client de l'annuaire.
--
-- 1. Sens de tournée : « tournee_sens » garde, par portée (modèle de tournée,
--    sinon chauffeur + service), le choix de l'utilisateur (mode : garder le sens
--    habituel, l'inverser, ou ne pas en tenir compte), la date d'« oubli » de
--    l'habitude et l'historique des ordres de secteurs (noms de villages
--    seulement, AUCUNE donnée de destinataire) des dernières tournées clôturées.
--    Code : lib/colis/sens-tournee.ts, lib/colis/sens-serveur.ts.
-- 2. Fiche client : on ÉTEND l'annuaire existant (delivery_address_hours, une
--    fiche par organisation et adresse normalisée) au lieu de créer une table :
--    téléphone, contact, consignes d'accès, fenêtre horaire, durée d'arrêt
--    moyenne, réussites par heure, motifs d'échec, contacts déjà faits. Mise à
--    jour automatique à la clôture d'un arrêt (lib/colis/fiche-client.ts) ;
--    delivery_stops.fiche_enregistree_le rend cette mise à jour idempotente.
--
-- RGPD : ces données sont des coordonnées de destinataires professionnels et des
-- consignes d'accès. RLS par organisation comme les tables voisines ; conservation
-- 12 mois sans mise à jour (purge dans le cron /api/cron/retention) ; suppression
-- à la demande depuis l'écran des horaires ; effacées avec l'organisation (clés
-- étrangères en cascade) lors de la suppression de fin de contrat.
--
-- ADDITIVE et rejouable : create table if not exists, add column if not exists,
-- index if not exists, politiques créées seulement si absentes. Aucun drop, aucun delete.

-- ── 1. Sens de tournée ─────────────────────────────────────────

create table if not exists public.tournee_sens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- « route:<uuid du modèle> » ou « chauffeur:<uuid>:service:<uuid ou -> ».
  scope_key text not null check (char_length(scope_key) between 3 and 120),
  -- habituel : suivre le sens habituel (défaut) ; inverse : le prendre à l'envers ; libre : ne pas en tenir compte.
  mode text not null default 'habituel' check (mode in ('habituel', 'inverse', 'libre')),
  -- « Oublier l'habitude » : seules les tournées postérieures à cette date comptent.
  reset_at timestamptz,
  -- [{ "run_id": "…", "date": "2026-10-28", "ordre": [{ "cle": "soulac", "nom": "Soulac" }, …] }], 8 au plus.
  historique jsonb not null default '[]'::jsonb check (jsonb_typeof(historique) = 'array'),
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, scope_key)
);

create index if not exists tournee_sens_org_updated_idx on public.tournee_sens (organization_id, updated_at);

alter table public.tournee_sens enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournee_sens' and policyname = 'tournee_sens: read within organization') then
    create policy "tournee_sens: read within organization"
      on public.tournee_sens for select
      using (organization_id = public.current_organization_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournee_sens' and policyname = 'tournee_sens: insert by drivers or manager-like') then
    create policy "tournee_sens: insert by drivers or manager-like"
      on public.tournee_sens for insert
      with check (
        organization_id = public.current_organization_id()
        and (public.current_role() in ('chauffeur', 'manager_chauffeur') or public.is_manager_like())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournee_sens' and policyname = 'tournee_sens: update by drivers or manager-like') then
    create policy "tournee_sens: update by drivers or manager-like"
      on public.tournee_sens for update
      using (
        organization_id = public.current_organization_id()
        and (public.current_role() in ('chauffeur', 'manager_chauffeur') or public.is_manager_like())
      )
      with check (
        organization_id = public.current_organization_id()
        and (public.current_role() in ('chauffeur', 'manager_chauffeur') or public.is_manager_like())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournee_sens' and policyname = 'tournee_sens: delete by drivers or manager-like') then
    create policy "tournee_sens: delete by drivers or manager-like"
      on public.tournee_sens for delete
      using (
        organization_id = public.current_organization_id()
        and (public.current_role() in ('chauffeur', 'manager_chauffeur') or public.is_manager_like())
      );
  end if;
end $$;

-- ── 2. Fiche client (extension de l'annuaire delivery_address_hours) ───

alter table public.delivery_address_hours add column if not exists phone text check (phone is null or char_length(phone) <= 40);
alter table public.delivery_address_hours add column if not exists recipient text check (recipient is null or char_length(recipient) <= 120);
alter table public.delivery_address_hours add column if not exists access_notes text check (access_notes is null or char_length(access_notes) <= 500);
alter table public.delivery_address_hours add column if not exists lat numeric(9, 6);
alter table public.delivery_address_hours add column if not exists lng numeric(9, 6);
-- Dernière fenêtre horaire ponctuelle connue pour cette adresse : préremplie à l'ajout d'un arrêt.
alter table public.delivery_address_hours add column if not exists window_start time;
alter table public.delivery_address_hours add column if not exists window_end time;
-- Durée d'arrêt : moyenne glissante bornée (1 à 30 min) et nombre d'observations.
alter table public.delivery_address_hours add column if not exists service_avg_min numeric(4, 1) check (service_avg_min is null or (service_avg_min >= 1 and service_avg_min <= 30));
alter table public.delivery_address_hours add column if not exists service_samples integer not null default 0 check (service_samples >= 0);
alter table public.delivery_address_hours add column if not exists delivered_count integer not null default 0 check (delivered_count >= 0);
alter table public.delivery_address_hours add column if not exists failed_count integer not null default 0 check (failed_count >= 0);
-- { "10": { "ok": 3, "ko": 1 }, … } : heure de Paris → livraisons réussies / échouées.
alter table public.delivery_address_hours add column if not exists success_by_hour jsonb not null default '{}'::jsonb check (jsonb_typeof(success_by_hour) = 'object');
-- { "absent": 3, "ferme": 1 } : motif d'échec → nombre.
alter table public.delivery_address_hours add column if not exists failure_reasons jsonb not null default '{}'::jsonb check (jsonb_typeof(failure_reasons) = 'object');
alter table public.delivery_address_hours add column if not exists contact_message_count integer not null default 0 check (contact_message_count >= 0);
alter table public.delivery_address_hours add column if not exists contact_phone_count integer not null default 0 check (contact_phone_count >= 0);
alter table public.delivery_address_hours add column if not exists last_delivery_at timestamptz;

comment on column public.delivery_address_hours.phone is 'Fiche client : dernier téléphone connu de l''établissement (donnée personnelle, conservée 12 mois sans mise à jour).';
comment on column public.delivery_address_hours.recipient is 'Fiche client : dernier destinataire / contact connu (donnée personnelle, conservée 12 mois sans mise à jour).';
comment on column public.delivery_address_hours.access_notes is 'Fiche client : consignes d''accès, code, stationnement (conservées 12 mois sans mise à jour).';

-- Recherche et purge : fiches d'une organisation par date de mise à jour.
create index if not exists delivery_address_hours_org_updated_idx on public.delivery_address_hours (organization_id, updated_at);

-- Idempotence de l'apprentissage : un arrêt n'alimente la fiche qu'une fois.
alter table public.delivery_stops add column if not exists fiche_enregistree_le timestamptz;
