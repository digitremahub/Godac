-- TICPE (remboursement partiel d'accise sur le gazole) — lot 1 :
-- barème daté, surcharges par organisation, réglages par organisation.
--
-- 1. ticpe_rates : barème GLOBAL (toutes organisations), daté
--    (début / fin), par catégorie d'activité et zone, en €/hl, avec sa
--    source. Lu par tout utilisateur connecté (information publique),
--    écrit UNIQUEMENT par le service role (backoffice GODAC, liste
--    GODAC_STAFF_EMAILS) : aucune policy d'écriture.
--    Un taux NULL = taux inconnu (ligne à compléter) : le calcul signale
--    « taux manquant » au lieu d'inventer un montant.
-- 2. ticpe_rate_overrides : surcharge d'une organisation (cas
--    particulier validé par son expert-comptable). Tracée : auteur,
--    motif, date ; jamais supprimée, seulement révoquée (revoked_at).
-- 3. ticpe_settings : réglages TICPE de l'organisation (activités,
--    régime de TVA, plafond, produits, location…). Absence de ligne =
--    réglages par défaut (lib/ticpe/reglages.ts).
--
-- ADDITIF : aucun drop, aucun delete. Les valeurs du barème sont
-- insérées « on conflict do nothing » (rejouable).

create table if not exists public.ticpe_rates (
  id uuid primary key default gen_random_uuid(),
  categorie text not null check (categorie in ('trm', 'trv', 'taxi')),
  zone text not null check (zone in ('metropole', 'corse', 'ile_de_france', 'auvergne_rhone_alpes', 'forfait_pondere')),
  date_debut date not null,
  date_fin date,
  taux_eur_hl numeric(8, 4) check (taux_eur_hl is null or taux_eur_hl >= 0),
  source text,
  source_url text,
  verifie_le date,
  a_confirmer boolean not null default false,
  note text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_fin is null or date_fin >= date_debut),
  unique (categorie, zone, date_debut)
);

comment on table public.ticpe_rates is
  'Barème TICPE (remboursement gazole) daté, en €/hl. Écrit par le service role (staff GODAC) seulement. taux NULL = inconnu, à compléter.';

alter table public.ticpe_rates enable row level security;

create policy "ticpe_rates: lecture par les utilisateurs connectés"
  on public.ticpe_rates for select
  to authenticated
  using (true);

create table if not exists public.ticpe_rate_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  categorie text not null check (categorie in ('trm', 'trv', 'taxi')),
  zone text not null check (zone in ('metropole', 'corse', 'ile_de_france', 'auvergne_rhone_alpes', 'forfait_pondere')),
  date_debut date not null,
  date_fin date,
  taux_eur_hl numeric(8, 4) not null check (taux_eur_hl >= 0),
  motif text not null check (char_length(btrim(motif)) >= 3),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.users (id) on delete set null,
  check (date_fin is null or date_fin >= date_debut)
);

create index if not exists ticpe_rate_overrides_org_idx on public.ticpe_rate_overrides (organization_id);

alter table public.ticpe_rate_overrides enable row level security;

create policy "ticpe_rate_overrides: lecture dans l'organisation"
  on public.ticpe_rate_overrides for select
  using (organization_id = public.current_organization_id());

create policy "ticpe_rate_overrides: direction et comptable ajoutent"
  on public.ticpe_rate_overrides for insert
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role()::text = 'comptable')
  );

-- Mise à jour = révocation (la route API ne touche qu'à revoked_at / revoked_by).
create policy "ticpe_rate_overrides: direction et comptable révoquent"
  on public.ticpe_rate_overrides for update
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role()::text = 'comptable')
  )
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role()::text = 'comptable')
  );

create table if not exists public.ticpe_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- Activités exercées (au moins une) : transport routier de marchandises,
  -- transport collectif de voyageurs, taxi.
  activite_trm boolean not null default true,
  activite_trv boolean not null default false,
  activite_taxi boolean not null default false,
  categorie_par_defaut text not null default 'trm' check (categorie_par_defaut in ('trm', 'trv', 'taxi')),
  -- Régime de TVA : la demande se fait sur l'annexe 3310-TIC de la CA3
  -- (mensuelle ou trimestrielle) ou avec la CA12 (annuelle).
  regime_tva text not null default 'mensuel' check (regime_tva in ('mensuel', 'trimestriel', 'annuel_ca12')),
  -- Jour du mois de la date limite de dépôt de la TVA (null = fin du mois suivant).
  jour_limite_depot smallint check (jour_limite_depot is null or jour_limite_depot between 1 and 31),
  -- Date limite de la CA12 au format MM-JJ (null = valeur par défaut, début mai).
  date_limite_ca12 text check (date_limite_ca12 is null or date_limite_ca12 ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  -- Plafond de volume par véhicule (sources contradictoires : à confirmer).
  plafond_litres integer not null default 40000 check (plafond_litres > 0),
  plafond_periode text not null default 'annuel' check (plafond_periode in ('annuel', 'semestriel')),
  -- Produits : gazole toujours ; HVO / B100 « à confirmer », exclus par défaut.
  accepte_hvo_b100 boolean not null default false,
  -- Véhicule loué : qui demande le remboursement par défaut.
  location_demandeur text not null default 'nous' check (location_demandeur in ('nous', 'loueur')),
  -- Zone par défaut des pleins (siège / dépôt en Corse).
  zone_par_defaut text not null default 'metropole' check (zone_par_defaut in ('metropole', 'corse')),
  -- 2025 seulement : taux forfaitaire pondéré au lieu des taux régionaux.
  forfait_pondere_2025 boolean not null default false,
  -- Rappel avant l'échéance de dépôt (jours).
  rappel_jours integer not null default 7 check (rappel_jours between 0 and 60),
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (activite_trm or activite_trv or activite_taxi)
);

alter table public.ticpe_settings enable row level security;

create policy "ticpe_settings: lecture dans l'organisation"
  on public.ticpe_settings for select
  using (organization_id = public.current_organization_id());

create policy "ticpe_settings: direction et comptable créent"
  on public.ticpe_settings for insert
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role()::text = 'comptable')
  );

create policy "ticpe_settings: direction et comptable modifient"
  on public.ticpe_settings for update
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role()::text = 'comptable')
  )
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role()::text = 'comptable')
  );

-- ── Barème connu (à vérifier régulièrement par l'équipe GODAC) ─────
-- 2025 : taux régionaux (Île-de-France, Auvergne-Rhône-Alpes, autres
-- régions) ou forfaitaire pondéré ; Corse à part.
-- 2026 : plus de taux régionaux ni de forfaitaire pondéré ; métropole
-- hors Corse 15,56 €/hl, Corse 14,21 €/hl.
-- TRV (autocars) et taxis : taux 2025 et 2026 non renseignés → lignes
-- vides à compléter (le calcul affichera « taux manquant »).

insert into public.ticpe_rates (categorie, zone, date_debut, date_fin, taux_eur_hl, source, source_url, verifie_le, a_confirmer, note)
values
  ('trm', 'metropole', '2025-01-01', '2025-12-31', 15.56, 'impots.gouv.fr / douane.gouv.fr — taux 2025 (régions hors IDF et AURA)', 'https://www.impots.gouv.fr/professionnel/questions/comment-obtenir-le-remboursement-partiel-de-laccise-sur-le-gazole', '2026-10-31', true, 'Régions hors Île-de-France et Auvergne-Rhône-Alpes.'),
  ('trm', 'ile_de_france', '2025-01-01', '2025-12-31', 17.45, 'impots.gouv.fr / douane.gouv.fr — taux 2025 Île-de-France', 'https://www.impots.gouv.fr/professionnel/questions/comment-obtenir-le-remboursement-partiel-de-laccise-sur-le-gazole', '2026-10-31', true, null),
  ('trm', 'auvergne_rhone_alpes', '2025-01-01', '2025-12-31', 15.29, 'impots.gouv.fr / douane.gouv.fr — taux 2025 Auvergne-Rhône-Alpes', 'https://www.impots.gouv.fr/professionnel/questions/comment-obtenir-le-remboursement-partiel-de-laccise-sur-le-gazole', '2026-10-31', true, null),
  ('trm', 'forfait_pondere', '2025-01-01', '2025-12-31', 15.71, 'impots.gouv.fr / douane.gouv.fr — taux forfaitaire pondéré 2025', 'https://www.impots.gouv.fr/professionnel/questions/comment-obtenir-le-remboursement-partiel-de-laccise-sur-le-gazole', '2026-10-31', true, 'Option : un seul taux pour toute la métropole hors Corse.'),
  ('trm', 'corse', '2025-01-01', '2025-12-31', null, 'À compléter', null, null, true, 'Taux Corse 2025 non renseigné.'),
  ('trm', 'metropole', '2026-01-01', null, 15.56, 'impots.gouv.fr — taux 2026 métropole hors Corse (Île-de-France alignée)', 'https://www.impots.gouv.fr/professionnel/questions/comment-obtenir-le-remboursement-partiel-de-laccise-sur-le-gazole', '2026-10-31', true, 'Depuis 2026 : plus de taux régionaux ni de taux forfaitaire pondéré.'),
  ('trm', 'corse', '2026-01-01', null, 14.21, 'impots.gouv.fr — taux 2026 Corse', 'https://www.impots.gouv.fr/professionnel/questions/comment-obtenir-le-remboursement-partiel-de-laccise-sur-le-gazole', '2026-10-31', true, null),
  ('trv', 'metropole', '2025-01-01', '2025-12-31', null, 'À compléter', null, null, true, 'Transport collectif de personnes : taux non renseigné.'),
  ('trv', 'corse', '2025-01-01', '2025-12-31', null, 'À compléter', null, null, true, null),
  ('trv', 'metropole', '2026-01-01', null, null, 'À compléter', null, null, true, 'Transport collectif de personnes : taux 2026 inconnu.'),
  ('trv', 'corse', '2026-01-01', null, null, 'À compléter', null, null, true, null),
  ('taxi', 'metropole', '2025-01-01', '2025-12-31', null, 'À compléter', null, null, true, 'Taxis : taux non renseigné.'),
  ('taxi', 'corse', '2025-01-01', '2025-12-31', null, 'À compléter', null, null, true, null),
  ('taxi', 'metropole', '2026-01-01', null, null, 'À compléter', null, null, true, 'Taxis : taux 2026 inconnu.'),
  ('taxi', 'corse', '2026-01-01', null, null, 'À compléter', null, null, true, null)
on conflict (categorie, zone, date_debut) do nothing;
