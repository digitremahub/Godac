-- Recommandation d'un employeur par un chauffeur « GO » (décision fondateur,
-- stratégie d'acquisition) : à la limite de la version gratuite, le chauffeur
-- peut « Recommander GODAC à mon employeur » et accepte explicitement que
-- GODAC contacte son employeur. Plusieurs chauffeurs pour la même entreprise
-- (company_key identique) = piste « chaude ».
--
-- ADDITIVE et rejouable : « create table if not exists », policies créées
-- seulement si absentes, aucun drop, aucun delete.
--  * Le chauffeur connecté peut INSERT (referrer_user_id = lui-même) et
--    SELECT ses propres lignes (anti-doublon / limite quotidienne côté API).
--    Aucune lecture des recommandations des autres, aucun UPDATE/DELETE.
--  * Le staff GODAC lit et modifie via le client service (RLS contournée),
--    comme app/godac-staff/* ; l'accès staff est contrôlé par
--    GODAC_STAFF_EMAILS côté code.

create table if not exists public.employer_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid references public.users (id) on delete set null,
  referrer_org_id uuid references public.organizations (id) on delete set null,
  company_name text not null check (char_length(company_name) between 2 and 120),
  -- Nom normalisé (minuscules, sans accents ni formes juridiques) : regroupe les doublons.
  company_key text not null check (char_length(company_key) >= 1),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 30),
  message text check (message is null or char_length(message) <= 500),
  -- Accord explicite d'être recontacté : preuve RGPD (texte exact accepté + date).
  consent boolean not null check (consent = true),
  consent_at timestamptz not null default now(),
  consent_text text not null,
  status text not null default 'nouvelle' check (status in ('nouvelle', 'contactee', 'essai', 'signee', 'perdue')),
  staff_notes text check (staff_notes is null or char_length(staff_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Au moins un moyen de contacter l'employeur.
  constraint employer_referrals_contact_requis check (
    nullif(btrim(coalesce(contact_email, '')), '') is not null
    or nullif(btrim(coalesce(contact_phone, '')), '') is not null
  )
);

create index if not exists employer_referrals_company_key_idx on public.employer_referrals (company_key);
create index if not exists employer_referrals_referrer_idx on public.employer_referrals (referrer_user_id, created_at desc);

alter table public.employer_referrals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employer_referrals' and policyname = 'employer_referrals: insert own') then
    create policy "employer_referrals: insert own" on public.employer_referrals
      for insert to authenticated
      with check (referrer_user_id = auth.uid() and consent = true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employer_referrals' and policyname = 'employer_referrals: select own') then
    create policy "employer_referrals: select own" on public.employer_referrals
      for select to authenticated
      using (referrer_user_id = auth.uid());
  end if;
end $$;

comment on table public.employer_referrals is
  'Recommandations d''employeur par les chauffeurs GO. Lecture/modification staff GODAC via le client service uniquement ; le chauffeur ne voit que les siennes.';
