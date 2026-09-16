-- GODAC V2 — auth helper functions bridging Clerk JWTs (configured as
-- a Supabase third-party auth provider) to our own tables.
--
-- These are `security definer`, owned by the migration role (which
-- has bypassrls on Supabase), so they can read `users`/`organizations`
-- without being blocked by the very RLS policies that call them.
-- Never expose them for writes — read-only lookups only.

create or replace function public.clerk_user_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '');
$$;

-- Clerk's native Supabase integration nests the active organisation
-- under the `o` claim (`o.id`). We also accept a flat `org_id` claim
-- as a fallback for custom JWT templates.
create or replace function public.clerk_org_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb -> 'o' ->> 'id', ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'org_id', '')
  );
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from organizations where clerk_org_id = public.clerk_org_id();
$$;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from users
  where clerk_user_id = public.clerk_user_id()
    and organization_id = public.current_organization_id();
$$;

create or replace function public.current_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from users where id = public.current_app_user_id();
$$;

create or replace function public.current_user_service_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(service_id), '{}') from user_services
  where user_id = public.current_app_user_id();
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
