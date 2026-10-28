-- Module « Stock » (palettes, colis, références) : fiche du module au catalogue,
-- tables, index, contraintes et RLS. Conception : docs/module-stock.md.
-- Les fonctions SQL (mouvements, inventaires) sont dans 20261114000002.
--
-- Principes
--   * Tout est rattaché à organizations (on delete cascade) : la suppression de
--     fin de contrat efface le stock avec l'organisation.
--   * RLS par organisation. Lecture : chauffeur, manager (ses services),
--     exploitation, direction ; jamais le comptable. Configuration (paramètres,
--     dépôts, emplacements, articles) : exploitation et direction.
--   * Registre des mouvements (stock_mouvements) IMMUABLE : aucune policy
--     d'écriture, droits d'écriture retirés à tous les rôles applicatifs et
--     déclencheur qui refuse toute modification. Unités, soldes et inventaires
--     ne s'écrivent que par les fonctions SQL du fichier suivant.
--   * AUCUNE donnée de destinataire : seul lien vers les colis existants, les
--     identifiants de tournée et d'arrêt.
--   * Le module est ajouté au catalogue SANS prix (tarif à décider par GODAC).
--
-- ADDITIVE et rejouable : create table if not exists, index if not exists,
-- politiques et déclencheurs créés seulement s'ils sont absents. Aucune
-- suppression, aucune mise à jour de données existantes.

-- ── 1. Fiche du module (sans grille tarifaire) ─────────────────────────

insert into public.modules (key, name, description, wave, is_transverse, base_price, included_from_plan, sort_order) values
  ('stock', 'Stock (palettes, colis, références)', 'Suivi du stock selon votre activité : colis (code-barres, poids, volume), palettes (EUR, demi, SSCC, emplacements) ou références en vrac (lots, DLC, seuils). Entrées et sorties par scan, transferts, inventaire guidé, historique non modifiable, liens avec les tournées et alertes de seuil.', 'v2', false, 0, null, 34)
on conflict (key) do nothing;

-- ── 2. Fonctions d'aide pour les policies ──────────────────────────────

-- Rôles qui lisent le stock (le comptable n'y a pas accès).
create or replace function public.stock_peut_lire()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role()::text in ('chauffeur', 'manager', 'manager_chauffeur', 'exploitation', 'direction'), false);
$$;

-- Rôles qui paramètrent le stock (profils, dépôts, emplacements, articles, seuils).
create or replace function public.stock_peut_parametrer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role()::text in ('exploitation', 'direction'), false);
$$;

revoke execute on function public.stock_peut_lire() from anon;
revoke execute on function public.stock_peut_parametrer() from anon;

-- ── 3. Paramètres : profils d'activité activés ─────────────────────────

create table if not exists public.stock_parametres (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- messagerie : colis ; palettes : palettes / fret ; vrac : références en vrac.
  profils text[] not null default '{}' check (profils <@ array['messagerie', 'palettes', 'vrac']::text[]),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ── 4. Dépôts, zones et emplacements ───────────────────────────────────

create table if not exists public.stock_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  nom text not null check (char_length(btrim(nom)) between 1 and 80),
  adresse text check (adresse is null or char_length(adresse) <= 200),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, nom)
);
create index if not exists stock_sites_org_idx on public.stock_sites (organization_id, actif);

-- Dépôts visibles : tous pour chauffeur, exploitation, direction ; pour un manager,
-- ceux de ses services et ceux qui n'ont pas de service.
create or replace function public.stock_sites_visibles()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.stock_sites s
  where s.organization_id = public.current_organization_id()
    and (
      public.current_role()::text in ('chauffeur', 'exploitation', 'direction')
      or s.service_id is null
      or s.service_id = any (public.current_user_service_ids())
    );
$$;

revoke execute on function public.stock_sites_visibles() from anon;

create table if not exists public.stock_emplacements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.stock_sites (id),
  -- Une zone n'a pas de parent ; un emplacement a une zone pour parent.
  parent_id uuid references public.stock_emplacements (id),
  genre text not null check (genre in ('zone', 'emplacement')),
  type_zone text check (type_zone is null or type_zone in ('quai', 'zone', 'allee', 'rayonnage', 'retour', 'autre')),
  code text not null check (char_length(btrim(code)) between 1 and 40),
  libelle text check (libelle is null or char_length(libelle) <= 80),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  check ((genre = 'zone' and parent_id is null) or (genre = 'emplacement' and parent_id is not null)),
  unique (site_id, code)
);
create index if not exists stock_emplacements_site_idx on public.stock_emplacements (organization_id, site_id, genre);
create index if not exists stock_emplacements_parent_idx on public.stock_emplacements (parent_id) where parent_id is not null;

-- Un emplacement est rangé dans une zone du même dépôt et de la même organisation.
create or replace function public.stock_emplacements_coherence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent public.stock_emplacements%rowtype;
begin
  if new.parent_id is not null then
    select * into v_parent from public.stock_emplacements where id = new.parent_id;
    if not found or v_parent.genre <> 'zone' or v_parent.site_id <> new.site_id or v_parent.organization_id <> new.organization_id then
      raise exception 'stock_emplacement_parent_invalide' using errcode = 'P0001';
    end if;
  end if;
  if not exists (select 1 from public.stock_sites s where s.id = new.site_id and s.organization_id = new.organization_id) then
    raise exception 'stock_site_invalide' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stock_emplacements_coherence_trg' and tgrelid = 'public.stock_emplacements'::regclass) then
    create trigger stock_emplacements_coherence_trg
      before insert or update on public.stock_emplacements
      for each row execute function public.stock_emplacements_coherence();
  end if;
end $$;

-- ── 5. Articles / références ───────────────────────────────────────────

create table if not exists public.stock_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  activite text not null default 'vrac' check (activite in ('messagerie', 'palettes', 'vrac')),
  code text not null check (char_length(btrim(code)) between 1 and 60),
  nom text not null check (char_length(btrim(nom)) between 1 and 120),
  unite text not null default 'piece' check (unite in ('piece', 'colis', 'palette', 'carton', 'kg', 'litre', 'metre', 'autre')),
  seuil_mini numeric(14, 3) not null default 0 check (seuil_mini >= 0),
  suivi_lots boolean not null default false,
  suivi_dlc boolean not null default false,
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index if not exists stock_articles_org_idx on public.stock_articles (organization_id, actif);

-- ── 6. Unités individualisées (colis, palettes) ────────────────────────

create table if not exists public.stock_unites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  activite text not null check (activite in ('messagerie', 'palettes')),
  -- Code colis (code-barres) ou numéro de palette ; le SSCC peut le remplacer.
  code text not null check (char_length(btrim(code)) between 1 and 80),
  type_unite text not null default 'colis' check (type_unite in ('colis', 'palette_eur', 'demi_palette', 'palette_autre')),
  poids_kg numeric(10, 3) check (poids_kg is null or (poids_kg >= 0 and poids_kg <= 100000)),
  volume_m3 numeric(10, 3) check (volume_m3 is null or (volume_m3 >= 0 and volume_m3 <= 1000)),
  sscc text check (sscc is null or sscc ~ '^[0-9]{18}$'),
  article_id uuid references public.stock_articles (id),
  statut text not null default 'dans_depot' check (statut in ('dans_depot', 'en_tournee', 'livre', 'retour', 'perdu', 'endommage')),
  site_id uuid references public.stock_sites (id),
  emplacement_id uuid references public.stock_emplacements (id),
  -- Liens vers la tournée colis (aucune donnée de destinataire n'est recopiée).
  run_id uuid references public.delivery_runs (id) on delete set null,
  stop_id uuid references public.delivery_stops (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  check ((activite = 'messagerie' and type_unite = 'colis') or (activite = 'palettes' and type_unite <> 'colis'))
);
create index if not exists stock_unites_statut_idx on public.stock_unites (organization_id, statut);
create index if not exists stock_unites_emplacement_idx on public.stock_unites (organization_id, site_id, emplacement_id);
create index if not exists stock_unites_run_idx on public.stock_unites (run_id) where run_id is not null;
create index if not exists stock_unites_stop_idx on public.stock_unites (stop_id) where stop_id is not null;
create index if not exists stock_unites_sscc_idx on public.stock_unites (organization_id, sscc) where sscc is not null;

-- ── 7. Soldes des articles (mis à jour par la fonction de mouvement) ───

create table if not exists public.stock_soldes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  article_id uuid not null references public.stock_articles (id),
  site_id uuid not null references public.stock_sites (id),
  emplacement_id uuid references public.stock_emplacements (id),
  -- Clé de rapprochement : un emplacement absent compte comme « sans emplacement ».
  emplacement_key uuid generated always as (coalesce(emplacement_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  lot text not null default '' check (char_length(lot) <= 60),
  dlc date,
  quantite numeric(14, 3) not null default 0 check (quantite >= 0),
  updated_at timestamptz not null default now(),
  unique (organization_id, article_id, site_id, emplacement_key, lot)
);
create index if not exists stock_soldes_article_idx on public.stock_soldes (organization_id, article_id);
create index if not exists stock_soldes_site_idx on public.stock_soldes (organization_id, site_id);

-- ── 8. Inventaires ─────────────────────────────────────────────────────

create table if not exists public.stock_inventaires (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.stock_sites (id),
  -- Zone comptée ; vide = tout le dépôt.
  zone_id uuid references public.stock_emplacements (id),
  statut text not null default 'en_cours' check (statut in ('en_cours', 'valide', 'annule')),
  note text check (note is null or char_length(note) <= 300),
  cle_idempotence text not null check (char_length(cle_idempotence) between 8 and 100),
  created_by uuid,
  created_by_nom text,
  created_at timestamptz not null default now(),
  validated_by uuid,
  validated_by_nom text,
  validated_at timestamptz,
  ecarts_total integer check (ecarts_total is null or ecarts_total >= 0),
  unique (organization_id, cle_idempotence)
);
create index if not exists stock_inventaires_org_idx on public.stock_inventaires (organization_id, created_at desc);
-- Un seul inventaire en cours par dépôt et par zone.
create unique index if not exists stock_inventaires_en_cours_unique
  on public.stock_inventaires (organization_id, site_id, coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where statut = 'en_cours';

create table if not exists public.stock_inventaire_lignes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  inventaire_id uuid not null references public.stock_inventaires (id) on delete cascade,
  genre text not null check (genre in ('unite', 'article')),
  unite_code text check (unite_code is null or char_length(unite_code) between 1 and 80),
  article_id uuid references public.stock_articles (id),
  emplacement_id uuid references public.stock_emplacements (id),
  emplacement_key uuid generated always as (coalesce(emplacement_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  lot text not null default '' check (char_length(lot) <= 60),
  -- Vide : pas encore compté.
  quantite_comptee numeric(14, 3) check (quantite_comptee is null or quantite_comptee >= 0),
  -- Renseignées à la validation.
  quantite_theorique numeric(14, 3) check (quantite_theorique is null or quantite_theorique >= 0),
  ecart numeric(14, 3),
  counted_by uuid,
  updated_at timestamptz not null default now(),
  check ((genre = 'unite' and unite_code is not null and article_id is null) or (genre = 'article' and article_id is not null and unite_code is null))
);
create unique index if not exists stock_inventaire_lignes_unite_unique
  on public.stock_inventaire_lignes (inventaire_id, unite_code) where genre = 'unite';
create unique index if not exists stock_inventaire_lignes_article_unique
  on public.stock_inventaire_lignes (inventaire_id, article_id, emplacement_key, lot) where genre = 'article';
create index if not exists stock_inventaire_lignes_org_idx on public.stock_inventaire_lignes (organization_id, inventaire_id);

-- ── 9. Registre des mouvements (immuable) ──────────────────────────────

create table if not exists public.stock_mouvements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type text not null check (type in ('entree', 'sortie', 'transfert', 'ajustement', 'casse', 'perte', 'retour')),
  -- Effet sur le stock : +1 entrée, -1 sortie, 0 transfert.
  sens smallint not null check (sens in (-1, 0, 1)),
  article_id uuid references public.stock_articles (id),
  unite_id uuid references public.stock_unites (id),
  -- Code de l'unité au moment du mouvement (lecture de l'historique).
  unite_code text,
  quantite numeric(14, 3) not null check (quantite > 0),
  site_id uuid references public.stock_sites (id),
  emplacement_source_id uuid references public.stock_emplacements (id),
  emplacement_dest_id uuid references public.stock_emplacements (id),
  lot text not null default '' check (char_length(lot) <= 60),
  dlc date,
  statut_avant text check (statut_avant is null or statut_avant in ('dans_depot', 'en_tournee', 'livre', 'retour', 'perdu', 'endommage')),
  statut_apres text check (statut_apres is null or statut_apres in ('dans_depot', 'en_tournee', 'livre', 'retour', 'perdu', 'endommage')),
  motif text check (motif is null or char_length(motif) <= 300),
  -- Liens vers les tournées colis ; remis à vide si la tournée est supprimée (seule modification tolérée).
  run_id uuid references public.delivery_runs (id) on delete set null,
  stop_id uuid references public.delivery_stops (id) on delete set null,
  inventaire_id uuid references public.stock_inventaires (id),
  source text not null default 'app' check (source in ('app', 'tournee', 'inventaire')),
  -- Idempotence : rejouer une même action (file hors ligne, double appui) ne crée qu'un mouvement.
  cle_idempotence text not null check (char_length(cle_idempotence) between 8 and 100),
  auteur_id uuid,
  auteur_nom text,
  created_at timestamptz not null default now(),
  unique (organization_id, cle_idempotence),
  check (article_id is not null or unite_id is not null),
  check (
    (type in ('entree', 'retour') and sens = 1)
    or (type in ('sortie', 'casse', 'perte') and sens = -1)
    or (type = 'transfert' and sens = 0)
    or (type = 'ajustement' and sens in (-1, 1))
  )
);
create index if not exists stock_mouvements_org_date_idx on public.stock_mouvements (organization_id, created_at desc);
create index if not exists stock_mouvements_unite_idx on public.stock_mouvements (organization_id, unite_id, created_at desc) where unite_id is not null;
create index if not exists stock_mouvements_article_idx on public.stock_mouvements (organization_id, article_id, created_at desc) where article_id is not null;
create index if not exists stock_mouvements_run_idx on public.stock_mouvements (run_id) where run_id is not null;
create index if not exists stock_mouvements_stop_idx on public.stock_mouvements (stop_id) where stop_id is not null;

-- Refuse toute modification d'une ligne du registre. Seule exception : le lien
-- vers une tournée ou un arrêt supprimé passe à vide (clé étrangère « set null »).
-- La suppression est impossible pour tous les rôles applicatifs (droits retirés
-- ci-dessous) ; seule la suppression de l'organisation, en fin de contrat, efface
-- le registre, par la cascade exécutée avec les droits du propriétaire.
create or replace function public.stock_mouvements_immuable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'run_id' - 'stop_id') = (to_jsonb(old) - 'run_id' - 'stop_id')
     and (new.run_id is null or new.run_id is not distinct from old.run_id)
     and (new.stop_id is null or new.stop_id is not distinct from old.stop_id) then
    return new;
  end if;
  raise exception 'stock_registre_immuable' using errcode = 'P0001';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'stock_mouvements_immuable_trg' and tgrelid = 'public.stock_mouvements'::regclass) then
    create trigger stock_mouvements_immuable_trg
      before update on public.stock_mouvements
      for each row execute function public.stock_mouvements_immuable();
  end if;
end $$;

-- Droits de table : lecture seule pour les rôles applicatifs (service_role compris)
-- sur le registre ; lecture seule pour les rôles de l'application sur le reste
-- (les écritures passent par les fonctions SQL du fichier suivant).
revoke all on public.stock_mouvements from anon, authenticated, service_role;
grant select on public.stock_mouvements to authenticated, service_role;
revoke all on public.stock_unites from anon, authenticated;
grant select on public.stock_unites to authenticated;
revoke all on public.stock_soldes from anon, authenticated;
grant select on public.stock_soldes to authenticated;
revoke all on public.stock_inventaires from anon, authenticated;
grant select on public.stock_inventaires to authenticated;
revoke all on public.stock_inventaire_lignes from anon, authenticated;
grant select on public.stock_inventaire_lignes to authenticated;

-- ── 10. RLS ────────────────────────────────────────────────────────────

alter table public.stock_parametres enable row level security;
alter table public.stock_sites enable row level security;
alter table public.stock_emplacements enable row level security;
alter table public.stock_articles enable row level security;
alter table public.stock_unites enable row level security;
alter table public.stock_soldes enable row level security;
alter table public.stock_inventaires enable row level security;
alter table public.stock_inventaire_lignes enable row level security;
alter table public.stock_mouvements enable row level security;

do $$
begin
  -- Lecture : parametres et articles pour tous les rôles lecteurs de l'organisation.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_parametres' and policyname = 'stock_parametres: read within organization') then
    create policy "stock_parametres: read within organization"
      on public.stock_parametres for select
      using (organization_id = public.current_organization_id() and public.stock_peut_lire());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_articles' and policyname = 'stock_articles: read within organization') then
    create policy "stock_articles: read within organization"
      on public.stock_articles for select
      using (organization_id = public.current_organization_id() and public.stock_peut_lire());
  end if;

  -- Lecture bornée au périmètre de service pour les tables rattachées à un dépôt.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_sites' and policyname = 'stock_sites: read in scope') then
    create policy "stock_sites: read in scope"
      on public.stock_sites for select
      using (organization_id = public.current_organization_id() and public.stock_peut_lire() and id in (select public.stock_sites_visibles()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_emplacements' and policyname = 'stock_emplacements: read in scope') then
    create policy "stock_emplacements: read in scope"
      on public.stock_emplacements for select
      using (organization_id = public.current_organization_id() and public.stock_peut_lire() and site_id in (select public.stock_sites_visibles()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_unites' and policyname = 'stock_unites: read in scope') then
    create policy "stock_unites: read in scope"
      on public.stock_unites for select
      using (organization_id = public.current_organization_id() and public.stock_peut_lire() and (site_id is null or site_id in (select public.stock_sites_visibles())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_soldes' and policyname = 'stock_soldes: read in scope') then
    create policy "stock_soldes: read in scope"
      on public.stock_soldes for select
      using (organization_id = public.current_organization_id() and public.stock_peut_lire() and site_id in (select public.stock_sites_visibles()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_inventaires' and policyname = 'stock_inventaires: read in scope') then
    create policy "stock_inventaires: read in scope"
      on public.stock_inventaires for select
      using (organization_id = public.current_organization_id() and public.stock_peut_lire() and site_id in (select public.stock_sites_visibles()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_inventaire_lignes' and policyname = 'stock_inventaire_lignes: read in scope') then
    create policy "stock_inventaire_lignes: read in scope"
      on public.stock_inventaire_lignes for select
      using (
        organization_id = public.current_organization_id()
        and public.stock_peut_lire()
        and inventaire_id in (select i.id from public.stock_inventaires i where i.site_id in (select public.stock_sites_visibles()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_mouvements' and policyname = 'stock_mouvements: read in scope') then
    create policy "stock_mouvements: read in scope"
      on public.stock_mouvements for select
      using (organization_id = public.current_organization_id() and public.stock_peut_lire() and (site_id is null or site_id in (select public.stock_sites_visibles())));
  end if;

  -- Configuration : exploitation et direction (insertion et modification).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_parametres' and policyname = 'stock_parametres: insert by exploitation or direction') then
    create policy "stock_parametres: insert by exploitation or direction"
      on public.stock_parametres for insert
      with check (organization_id = public.current_organization_id() and public.stock_peut_parametrer());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_parametres' and policyname = 'stock_parametres: update by exploitation or direction') then
    create policy "stock_parametres: update by exploitation or direction"
      on public.stock_parametres for update
      using (organization_id = public.current_organization_id() and public.stock_peut_parametrer())
      with check (organization_id = public.current_organization_id() and public.stock_peut_parametrer());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_sites' and policyname = 'stock_sites: insert by exploitation or direction') then
    create policy "stock_sites: insert by exploitation or direction"
      on public.stock_sites for insert
      with check (organization_id = public.current_organization_id() and public.stock_peut_parametrer());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_sites' and policyname = 'stock_sites: update by exploitation or direction') then
    create policy "stock_sites: update by exploitation or direction"
      on public.stock_sites for update
      using (organization_id = public.current_organization_id() and public.stock_peut_parametrer())
      with check (organization_id = public.current_organization_id() and public.stock_peut_parametrer());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_emplacements' and policyname = 'stock_emplacements: insert by exploitation or direction') then
    create policy "stock_emplacements: insert by exploitation or direction"
      on public.stock_emplacements for insert
      with check (organization_id = public.current_organization_id() and public.stock_peut_parametrer());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_emplacements' and policyname = 'stock_emplacements: update by exploitation or direction') then
    create policy "stock_emplacements: update by exploitation or direction"
      on public.stock_emplacements for update
      using (organization_id = public.current_organization_id() and public.stock_peut_parametrer())
      with check (organization_id = public.current_organization_id() and public.stock_peut_parametrer());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_articles' and policyname = 'stock_articles: insert by exploitation or direction') then
    create policy "stock_articles: insert by exploitation or direction"
      on public.stock_articles for insert
      with check (organization_id = public.current_organization_id() and public.stock_peut_parametrer());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_articles' and policyname = 'stock_articles: update by exploitation or direction') then
    create policy "stock_articles: update by exploitation or direction"
      on public.stock_articles for update
      using (organization_id = public.current_organization_id() and public.stock_peut_parametrer())
      with check (organization_id = public.current_organization_id() and public.stock_peut_parametrer());
  end if;
end $$;

notify pgrst, 'reload schema';
