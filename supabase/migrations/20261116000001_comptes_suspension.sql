-- Suspension d'un compte (organisation) par GODAC : tous les utilisateurs de
-- l'organisation perdent l'accès à l'application (écran « Compte suspendu par
-- GODAC », API refusées), SANS rien supprimer. Rétablir = remettre les trois
-- colonnes à null. Additive et idempotente : aucune suppression ni vidage,
-- aucune donnée existante modifiée.
-- Code : lib/comptes-essai (règles pures, garde, actions), page
-- app/godac-staff/comptes-essai, routes app/api/godac-staff/comptes-essai.

-- 1. État de suspension sur l'organisation (null = compte actif).
alter table public.organizations
  add column if not exists suspendue_le timestamptz,
  add column if not exists suspendue_motif text,
  add column if not exists suspendue_par text;

comment on column public.organizations.suspendue_le is 'Date de suspension du compte par GODAC. Null = compte actif. Tant que posée : plus aucun accès pour les utilisateurs de l''organisation (rien n''est supprimé).';
comment on column public.organizations.suspendue_motif is 'Motif de la suspension, saisi par GODAC (obligatoire).';
comment on column public.organizations.suspendue_par is 'Adresse e-mail du membre de GODAC qui a suspendu le compte.';

-- 2. Ces colonnes ne se modifient que côté serveur (clé de service) : ni la
--    direction d'une entreprise cliente ni un autre rôle ne peuvent lever leur
--    propre suspension (la policy « direction can update their own org »
--    laisserait sinon passer). Même principe que organizations_guard_fin_contrat.
create or replace function public.organizations_guard_suspension()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.suspendue_le is distinct from old.suspendue_le
     or new.suspendue_motif is distinct from old.suspendue_motif
     or new.suspendue_par is distinct from old.suspendue_par then
    raise exception 'La suspension d''un compte ne se modifie que par GODAC.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'organizations_guard_suspension' and tgrelid = 'public.organizations'::regclass and not tgisinternal
  ) then
    create trigger organizations_guard_suspension
      before update on public.organizations
      for each row execute function public.organizations_guard_suspension();
  end if;
end $$;

-- 3. Index partiel : retrouver rapidement les comptes suspendus (liste du back-office).
create index if not exists organizations_suspendue_idx
  on public.organizations (suspendue_le)
  where suspendue_le is not null;

-- Aucune policy de lecture n'est ajoutée ni modifiée : les membres lisent déjà
-- leur organisation (la garde de l'application lit ces colonnes avec leur propre session).
