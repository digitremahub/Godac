-- « Faire essayer GO » : suivi d'apporteur (décision fondateur).
--
-- La direction, les personnes qu'elle désigne ou toute l'équipe peuvent faire
-- essayer GO Navigation (Tournée colis seule, 30 jours : offre existante,
-- migration 20261023000003) avec un lien qui permet de savoir qui a partagé,
-- comme un suivi d'apporteur d'affaires. Aucun calcul de commission : suivi
-- seulement.
--
-- Choix de conception :
--  * Lien PERSONNEL multi-usage = nouvelle table go_apporteur_liens (un lien
--    actif par personne, jusqu'à max_inscriptions inscriptions, 90 jours,
--    révocable, régénérable). Seul le SHA-256 du jeton est stocké ; le jeton
--    est dérivable côté serveur depuis l'id (HMAC) pour pouvoir être
--    ré-affiché à son propriétaire.
--  * Invitations À USAGE UNIQUE d'un apporteur = la table existante
--    go_navigation_invitations, étendue de 3 colonnes (qui l'a créée, pour
--    quelle organisation, via quel lien). Les invitations du staff GODAC les
--    laissent à null : leur comportement ne change pas. Une inscription par
--    lien personnel crée une ligne d'invitation déjà « utilisée » : le
--    parcours d'inscription (inscrire_go_navigation) reste inchangé.
--  * Attribution mémorisée sur la nouvelle organisation d'essai
--    (referred_by_user_id, referred_by_org_id, referral_link_id), posée côté
--    serveur depuis le jeton, jamais depuis un paramètre du client.
--  * Droit « Faire essayer GO » : la direction l'a toujours ; elle l'ouvre à
--    des personnes (users.peut_partager_go) ou à toute l'équipe
--    (organizations.partage_go_tous).
--
-- ADDITIVE : « create table if not exists », « add column if not exists »,
-- « create index if not exists ». Aucun drop, aucun delete. Les policies sont
-- créées par une instruction simple (sans bloc DO) : elles ne se rejouent pas
-- une seconde fois sur la même base (le reste de la migration, oui).

-- ── 1. Droits ───────────────────────────────────────────────────────
alter table public.users add column if not exists peut_partager_go boolean not null default false;
alter table public.organizations add column if not exists partage_go_tous boolean not null default false;

comment on column public.users.peut_partager_go is
  'Personne désignée par la direction pour faire essayer GO (écran /partage-go). La direction a toujours ce droit.';
comment on column public.organizations.partage_go_tous is
  'Tous les membres de l''organisation peuvent faire essayer GO (réglage de la direction).';

-- ── 2. Liens personnels d'apporteur ─────────────────────────────────
create table if not exists public.go_apporteur_liens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Le partageur (l'apporteur).
  user_id uuid not null references public.users (id) on delete cascade,
  -- SHA-256 du jeton (même procédé que go_navigation_invitations.token_hash).
  code_hash text not null unique,
  libelle text check (libelle is null or char_length(libelle) <= 200),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  max_inscriptions integer not null default 20 check (max_inscriptions between 1 and 1000),
  expires_at timestamptz not null
);

create index if not exists go_apporteur_liens_user_idx on public.go_apporteur_liens (user_id, created_at desc);
create index if not exists go_apporteur_liens_org_idx on public.go_apporteur_liens (organization_id);
-- Un seul lien personnel actif par personne.
create unique index if not exists go_apporteur_liens_actif_idx on public.go_apporteur_liens (user_id) where revoked_at is null;

alter table public.go_apporteur_liens enable row level security;

-- ── 3. Invitations : qui les a créées, pour quelle organisation, via quel lien
alter table public.go_navigation_invitations add column if not exists created_by_user_id uuid references public.users (id) on delete set null;
alter table public.go_navigation_invitations add column if not exists created_by_org_id uuid references public.organizations (id) on delete set null;
alter table public.go_navigation_invitations add column if not exists referral_link_id uuid references public.go_apporteur_liens (id) on delete set null;

create index if not exists go_navigation_invitations_apporteur_idx on public.go_navigation_invitations (created_by_user_id, created_at desc);
create index if not exists go_navigation_invitations_lien_idx on public.go_navigation_invitations (referral_link_id);

-- ── 4. Attribution sur l'organisation d'essai ───────────────────────
alter table public.organizations add column if not exists referred_by_user_id uuid references public.users (id) on delete set null;
alter table public.organizations add column if not exists referred_by_org_id uuid references public.organizations (id) on delete set null;
alter table public.organizations add column if not exists referral_link_id uuid references public.go_apporteur_liens (id) on delete set null;

create index if not exists organizations_referred_by_user_idx on public.organizations (referred_by_user_id) where referred_by_user_id is not null;
create index if not exists organizations_referred_by_org_idx on public.organizations (referred_by_org_id) where referred_by_org_id is not null;

comment on column public.organizations.referred_by_user_id is
  'Apporteur : la personne qui a fait essayer GO (lien personnel ou invitation). Posé côté serveur à l''inscription d''essai.';

-- ── 5. RLS ──────────────────────────────────────────────────────────
-- Les routes /api/partage-go passent par le client service après contrôle du
-- droit, de la limite quotidienne et de l'organisation. Ces policies sont la
-- défense en profondeur : on ne lit et n'insère que dans SON organisation,
-- et ses propres liens (la direction lit ceux de l'organisation).
create policy "go_apporteur_liens: select own org" on public.go_apporteur_liens
  for select to authenticated
  using (organization_id = public.current_organization_id() and (user_id = auth.uid() or public.is_direction()));

create policy "go_apporteur_liens: insert own" on public.go_apporteur_liens
  for insert to authenticated
  with check (organization_id = public.current_organization_id() and user_id = auth.uid());

create policy "go_navigation_invitations: select apporteur" on public.go_navigation_invitations
  for select to authenticated
  using (created_by_org_id is not null and created_by_org_id = public.current_organization_id() and (created_by_user_id = auth.uid() or public.is_direction()));

create policy "go_navigation_invitations: insert apporteur" on public.go_navigation_invitations
  for insert to authenticated
  with check (created_by_org_id is not null and created_by_org_id = public.current_organization_id() and created_by_user_id = auth.uid());
