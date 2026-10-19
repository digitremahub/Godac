-- Audit 19/10/2026 : C1 et C2.
-- DÉJÀ APPLIQUÉ EN BASE. Ce fichier documente l'état réel et peut être rejoué
-- sans effet (idempotent).

-- C1 : un utilisateur ne peut plus modifier lui-même son rôle, son statut,
-- ses identifiants de connexion ni ses informations de rémunération.
create or replace function public.users_guard_self_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Changement d''entreprise interdit.' using errcode = '42501';
  end if;
  if public.is_direction() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.active is distinct from old.active
     or new.pending_approval is distinct from old.pending_approval
     or new.auth_method is distinct from old.auth_method
     or new.pin_set_at is distinct from old.pin_set_at
     or new.driver_code is distinct from old.driver_code
     or new.driver_recovery_code_hash is distinct from old.driver_recovery_code_hash
     or new.hourly_rate is distinct from old.hourly_rate
     or new.monthly_gross_salary is distinct from old.monthly_gross_salary
     or new.monthly_net_salary is distinct from old.monthly_net_salary
     or new.contractual_monthly_hours is distinct from old.contractual_monthly_hours
     or new.role_title is distinct from old.role_title then
    raise exception 'Seule la direction peut modifier ces informations.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists users_guard_self_update on public.users;
create trigger users_guard_self_update
  before update on public.users
  for each row execute function public.users_guard_self_update();

-- C2 : contrats filtrés par organisation.
alter policy "user_contracts: direction writes" on public.user_contracts
  using (
    public.is_direction() and exists (
      select 1 from public.users u
      where u.id = user_contracts.user_id
        and u.organization_id = public.current_organization_id()
    )
  )
  with check (
    public.is_direction() and exists (
      select 1 from public.users u
      where u.id = user_contracts.user_id
        and u.organization_id = public.current_organization_id()
    )
  );

alter policy "user_contracts: read own or direction" on public.user_contracts
  using (
    user_id = public.current_app_user_id()
    or (
      public.is_direction() and exists (
        select 1 from public.users u
        where u.id = user_contracts.user_id
          and u.organization_id = public.current_organization_id()
      )
    )
  );
