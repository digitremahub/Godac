-- GODAC V2 — auth helper functions built on Supabase's native
-- `auth.uid()`. Because `public.users.id` IS the Supabase Auth user
-- id (see 20260101000002_core_tables.sql), there is no JWT-claim
-- bridging to do — RLS reads the organisation/role straight off the
-- one profile row per signed-in user.
--
-- These are `security definer`, owned by the migration role (which
-- has bypassrls on Supabase), so a policy on `users` calling
-- current_role()/current_organization_id() doesn't recurse into its
-- own RLS while resolving them.

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from users where id = auth.uid();
$$;

create or replace function public.current_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from users where id = auth.uid();
$$;

create or replace function public.current_user_service_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(service_id), '{}') from user_services
  where user_id = auth.uid();
$$;

create or replace function public.is_manager_like()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('manager', 'manager_chauffeur', 'direction');
$$;

create or replace function public.is_direction()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'direction';
$$;
