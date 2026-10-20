-- Audit M18 : le jeton du lien d'inscription chauffeur (app/join/[token])
-- était lisible par tout membre de l'organisation (colonne
-- organizations.driver_signup_token, policy de lecture de l'organisation).
-- Quiconque le lisait pouvait créer des comptes en attente.
--
-- Additif et idempotent, aucune suppression, aucun revoke de table :
--  - nouvelle table organization_signup_tokens, RLS : lecture par la
--    direction de l'organisation uniquement ; écriture par le service role
--    (route /api/admin/organizations/driver-signup-token, contrôle direction) ;
--  - recopie des jetons actuels (les liens déjà diffusés restent valides) ;
--  - création automatique d'un jeton pour toute nouvelle organisation.
-- L'ancienne colonne reste en place mais n'est plus lue ni écrite par
-- l'application. Pour qu'elle ne révèle plus le jeton en vigueur, la
-- direction régénère le lien une fois (Administration › Organisation) :
-- le nouveau jeton n'est écrit que dans la nouvelle table.

create table if not exists public.organization_signup_tokens (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  rotated_at timestamptz not null default now()
);

alter table public.organization_signup_tokens enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'organization_signup_tokens' and policyname = 'signup_tokens: direction reads'
  ) then
    create policy "signup_tokens: direction reads" on public.organization_signup_tokens
      for select using (organization_id = public.current_organization_id() and public.is_direction());
  end if;
end $$;

insert into public.organization_signup_tokens (organization_id, token)
select id, driver_signup_token from public.organizations
on conflict (organization_id) do nothing;

create or replace function public.creer_jeton_inscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_signup_tokens (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke all on function public.creer_jeton_inscription() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'organizations_creer_jeton_inscription') then
    create trigger organizations_creer_jeton_inscription
      after insert on public.organizations
      for each row execute function public.creer_jeton_inscription();
  end if;
end $$;
