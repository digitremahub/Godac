-- Module « Stock » : codes internes, attributs génériques, étiquettes et profils
-- adaptables (schéma). Suite de 20261114000001 à 20261114000005.
-- Conception : docs/module-stock.md (sections « Codes et étiquettes », « Profils adaptables »).
--
-- Contenu
--   1. stock_parametres : préfixe des codes internes, format d'étiquette par défaut,
--      profils_config (personnalisation des profils d'activité, jsonb validé par check).
--   2. stock_articles : profil de l'article ; stock_unites : code interne complémentaire, profil, nature, température,
--      fragile, urgent, consigne, référence client, lot, DLC, température relevée.
--   3. stock_compteurs : compteur ATOMIQUE par organisation et par année.
--   4. stock_generations : journal des générations de codes (idempotence par clé).
--   5. Cohérence des codes : un code (principal ou interne) ne désigne qu'une unité.
--   6. RLS des nouvelles tables (lecture seule ; écriture par fonctions SQL).
--
-- Principes
--   * ADDITIVE et rejouable : add column if not exists, create table if not exists,
--     index if not exists ; policies et déclencheurs créés seulement s'ils sont absents.
--     Aucune suppression, aucune mise à jour de données existantes.
--   * Les anciennes colonnes et contraintes ne sont pas modifiées : la colonne
--     stock_parametres.profils reste limitée à ses trois « familles » historiques
--     (messagerie, palettes, vrac) ; la liste réelle des profils activés (sante,
--     pharmacie, alimentaire, personnalise…) est dans profils_config->'actifs'.
--   * AUCUNE donnée de destinataire ni de patient : champs logistiques seulement.
--   * Piège RLS (déjà rencontré sur stock_sites) : une policy de lecture ne passe
--     JAMAIS par une fonction qui relit sa propre table (l'insertion avec
--     « returning » serait refusée). Les policies ci-dessous n'utilisent que
--     current_organization_id(), stock_peut_lire() et stock_peut_parametrer(), qui
--     lisent public.users, pas la table protégée.

-- ── 1. Paramètres ──────────────────────────────────────────────────────

alter table public.stock_parametres add column if not exists prefixe_code text
  check (prefixe_code is null or prefixe_code ~ '^[A-Z0-9]{2,6}$');
alter table public.stock_parametres add column if not exists format_etiquette text
  check (format_etiquette is null or format_etiquette in ('a4_2x4', 'a4_3x7', 'thermique_100x150', 'etiquette_62x29'));
-- Personnalisation des profils : { "version": 1, "actifs": [...], "profils": { "<cle>": {...} } }.
-- Contrôles de forme ici ; le contenu est validé par zod côté API (lib/stock/profils.ts).
alter table public.stock_parametres add column if not exists profils_config jsonb not null default '{}'::jsonb
  check (
    jsonb_typeof(profils_config) = 'object'
    and length(profils_config::text) <= 30000
    and (not jsonb_exists(profils_config, 'version') or profils_config->'version' = '1'::jsonb)
    and (not jsonb_exists(profils_config, 'actifs') or jsonb_typeof(profils_config->'actifs') = 'array')
    and (not jsonb_exists(profils_config, 'profils') or jsonb_typeof(profils_config->'profils') = 'object')
  );

-- ── 2. Attributs génériques des unités ─────────────────────────────────

-- Code interne COMPLÉMENTAIRE (généré par stock_generer_codes). Le code principal
-- (stock_unites.code) reste celui qui est arrivé avec l'unité (code-barres du
-- transporteur ou du client, SSCC, bordereau) ; sans code d'origine, le code
-- interne est aussi le code principal.
alter table public.stock_unites add column if not exists code_interne text
  check (code_interne is null or char_length(btrim(code_interne)) between 1 and 80);
-- Profil d'activité de l'entrée (libellé du vocabulaire, champs obligatoires).
alter table public.stock_unites add column if not exists profil text
  check (profil is null or profil in ('messagerie', 'palettes', 'sante', 'pharmacie', 'alimentaire', 'vrac', 'personnalise'));
alter table public.stock_unites add column if not exists nature text
  check (nature is null or nature in ('colis', 'palette', 'prelevement', 'medicament', 'alimentaire', 'pharmaceutique', 'autre'));
alter table public.stock_unites add column if not exists nature_libelle text
  check (nature_libelle is null or char_length(nature_libelle) <= 60);
alter table public.stock_unites add column if not exists temperature text
  check (temperature is null or temperature in ('ambiante', 'frais', 'congele', 'autre'));
alter table public.stock_unites add column if not exists temperature_libelle text
  check (temperature_libelle is null or char_length(temperature_libelle) <= 60);
alter table public.stock_unites add column if not exists temperature_releve numeric(5, 1)
  check (temperature_releve is null or (temperature_releve >= -100 and temperature_releve <= 100));
alter table public.stock_unites add column if not exists fragile boolean not null default false;
alter table public.stock_unites add column if not exists urgent boolean not null default false;
alter table public.stock_unites add column if not exists consigne text
  check (consigne is null or char_length(consigne) <= 120);
alter table public.stock_unites add column if not exists reference_client text
  check (reference_client is null or char_length(reference_client) <= 60);
alter table public.stock_unites add column if not exists lot text
  check (lot is null or char_length(lot) <= 60);
alter table public.stock_unites add column if not exists dlc date;

-- Profil d'activité d'un article (règle de DLC proche, FEFO, champs obligatoires de l'entrée).
alter table public.stock_articles add column if not exists profil text
  check (profil is null or profil in ('messagerie', 'palettes', 'sante', 'pharmacie', 'alimentaire', 'vrac', 'personnalise'));

-- Recherche par code interne : unique par organisation (le code principal l'est déjà).
create unique index if not exists stock_unites_code_interne_unique
  on public.stock_unites (organization_id, code_interne) where code_interne is not null;
create index if not exists stock_unites_urgent_idx
  on public.stock_unites (organization_id, statut) where urgent;

-- ── 3. Compteurs de codes (atomiques) ──────────────────────────────────

create table if not exists public.stock_compteurs (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  annee integer not null check (annee between 2000 and 9999),
  -- Dernier numéro attribué (0 = aucun). Au-delà de 999 999, la génération est refusée.
  dernier integer not null default 0 check (dernier between 0 and 999999),
  updated_at timestamptz not null default now(),
  primary key (organization_id, annee)
);

-- ── 4. Journal des générations (idempotence par clé) ───────────────────

create table if not exists public.stock_generations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cle text not null check (char_length(cle) between 8 and 100),
  annee integer not null check (annee between 2000 and 9999),
  prefixe text not null check (prefixe ~ '^[A-Z0-9]{2,6}$'),
  nombre integer not null check (nombre between 1 and 500),
  codes text[] not null check (cardinality(codes) between 1 and 500),
  auteur_id uuid,
  auteur_nom text,
  created_at timestamptz not null default now(),
  unique (organization_id, cle)
);
create index if not exists stock_generations_org_idx on public.stock_generations (organization_id, created_at desc);

-- ── 5. Cohérence des codes ─────────────────────────────────────────────

-- Un code ne peut identifier qu'une seule unité : ni un code principal égal au
-- code interne d'une autre unité, ni un code interne égal au code d'une autre unité.
-- (L'unicité de code et de code_interne entre unités est portée par les index uniques.)
create or replace function public.stock_unites_codes_coherents()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.code_interne is not null then
    if new.code_interne = new.code then
      -- Même valeur dans les deux colonnes : le code interne est inutile.
      new.code_interne := null;
    elsif exists (select 1 from public.stock_unites u where u.organization_id = new.organization_id and u.id <> new.id and u.code = new.code_interne) then
      raise exception 'stock_code_ambigu' using errcode = 'P0001';
    end if;
  end if;
  if exists (select 1 from public.stock_unites u where u.organization_id = new.organization_id and u.id <> new.id and u.code_interne = new.code) then
    raise exception 'stock_code_ambigu' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stock_unites_codes_coherents_trg' and tgrelid = 'public.stock_unites'::regclass) then
    create trigger stock_unites_codes_coherents_trg
      before insert or update of code, code_interne on public.stock_unites
      for each row execute function public.stock_unites_codes_coherents();
  end if;
end $$;

-- ── 6. Droits et RLS ───────────────────────────────────────────────────

-- Lecture seule pour les rôles applicatifs : les écritures passent par les fonctions SQL.
revoke all on public.stock_compteurs from anon, authenticated;
grant select on public.stock_compteurs to authenticated;
revoke all on public.stock_generations from anon, authenticated;
grant select on public.stock_generations to authenticated;

alter table public.stock_compteurs enable row level security;
alter table public.stock_generations enable row level security;

do $$
begin
  -- Lecture des compteurs et du journal : exploitation et direction (paramétrage). Aucune fonction ne relit ces tables.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_compteurs' and policyname = 'stock_compteurs: read within organization') then
    create policy "stock_compteurs: read within organization"
      on public.stock_compteurs for select
      using (organization_id = public.current_organization_id() and public.stock_peut_parametrer());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_generations' and policyname = 'stock_generations: read within organization') then
    create policy "stock_generations: read within organization"
      on public.stock_generations for select
      using (organization_id = public.current_organization_id() and public.stock_peut_parametrer());
  end if;
end $$;

notify pgrst, 'reload schema';
