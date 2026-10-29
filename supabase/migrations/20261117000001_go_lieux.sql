-- « Aller à… » de GO : lieux enregistrés par l'utilisateur (favoris et
-- destinations récentes). ADDITIVE et rejouable : create ... if not exists,
-- policies créées seulement si absentes (pg_policies), aucune suppression ni
-- vidage ni modification de ligne existante.
--
-- RGPD : seuls les lieux CHOISIS par l'utilisateur sont stockés. Jamais le
-- trajet ni la position GPS d'une navigation libre. Les récents sont purgés
-- après 90 jours par le cron retention existant (lib/retention/lieux-go.ts) ;
-- l'utilisateur supprime ses lieux à tout moment ; tout part avec son compte
-- (users) ou son organisation (organizations) par cascade.
--
-- Identité : public.users.id EST l'identifiant Supabase Auth (voir
-- 20260101000008_auth_helpers.sql) : les policies comparent directement
-- user_id à auth.uid(). Aucune policy ne relit go_lieux (ni directement ni
-- par une fonction) : « insert ... returning » reste sans piège.

create table if not exists public.go_lieux (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  genre text not null check (genre in ('favori', 'recent')),
  -- Domicile / Travail : un seul de chaque par utilisateur (favoris seulement).
  type_lieu text check (type_lieu is null or type_lieu in ('domicile', 'travail')),
  libelle text not null check (char_length(btrim(libelle)) between 1 and 60),
  adresse text not null check (char_length(btrim(adresse)) between 3 and 200),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  -- Adresse normalisée (sans accents ni ponctuation) : dédoublonnage.
  cle text not null check (char_length(cle) between 1 and 200),
  dernier_usage timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint go_lieux_type_favori check (type_lieu is null or genre = 'favori')
);

comment on table public.go_lieux is 'Lieux enregistrés dans GO (« Aller à… ») : favoris et destinations récentes de l''utilisateur. Aucun trajet ni position GPS. Récents purgés après 90 jours (cron retention).';

-- Un lieu ordinaire une seule fois par genre et par utilisateur (dédoublonnage).
create unique index if not exists go_lieux_unique_lieu_idx
  on public.go_lieux (user_id, genre, cle)
  where type_lieu is null;

-- Domicile et Travail : un seul de chaque par utilisateur.
create unique index if not exists go_lieux_unique_type_idx
  on public.go_lieux (user_id, type_lieu)
  where type_lieu is not null;

-- Lecture de l'écran (par genre, plus récent d'abord) et purge des récents.
create index if not exists go_lieux_user_genre_idx on public.go_lieux (user_id, genre, dernier_usage desc);
create index if not exists go_lieux_purge_idx on public.go_lieux (dernier_usage) where genre = 'recent';
create index if not exists go_lieux_organisation_idx on public.go_lieux (organization_id);

alter table public.go_lieux enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'go_lieux' and policyname = 'go_lieux: select own') then
    create policy "go_lieux: select own" on public.go_lieux
      for select to authenticated
      using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'go_lieux' and policyname = 'go_lieux: insert own') then
    create policy "go_lieux: insert own" on public.go_lieux
      for insert to authenticated
      with check (user_id = auth.uid() and organization_id = public.current_organization_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'go_lieux' and policyname = 'go_lieux: update own') then
    create policy "go_lieux: update own" on public.go_lieux
      for update to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid() and organization_id = public.current_organization_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'go_lieux' and policyname = 'go_lieux: delete own') then
    create policy "go_lieux: delete own" on public.go_lieux
      for delete to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

notify pgrst, 'reload schema';
