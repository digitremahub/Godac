-- Audit 19/10/2026 : C4, facturation contournable.
-- La direction ne peut plus modifier elle-même sa formule, son statut
-- d'abonnement ni ses identifiants Stripe, ni activer un module payant à
-- 0 €. Ces écritures passent par le serveur (client admin / service role) :
--   - app/api/onboarding/modules (essai uniquement),
--   - app/api/admin/modules, app/api/admin/organization (prix de la grille),
--   - app/api/webhooks/stripe (seule source après paiement).
-- `usage_overage_enabled` et les champs de profil restent modifiables par
-- la direction (policy existante « org: direction can update their own org »).
-- Idempotent.

create or replace function public.organizations_guard_billing()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.is_demo is distinct from old.is_demo then
    raise exception 'La formule et l''abonnement ne se modifient que par la facturation GODAC.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists organizations_guard_billing on public.organizations;
create trigger organizations_guard_billing
  before update on public.organizations
  for each row execute function public.organizations_guard_billing();

-- organization_modules : toutes les écritures applicatives passent par le
-- client admin. Les rôles anon/authenticated ne peuvent plus insérer,
-- modifier ni supprimer de ligne (prix, pricing_mode, activation), même si
-- la policy « organization_modules: direction manages » le laisserait
-- passer. La lecture reste inchangée.
create or replace function public.organization_modules_guard_write()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'Les modules se modifient depuis l''application (Modules & tarifs).'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists organization_modules_guard_write on public.organization_modules;
create trigger organization_modules_guard_write
  before insert or update or delete on public.organization_modules
  for each row execute function public.organization_modules_guard_write();
