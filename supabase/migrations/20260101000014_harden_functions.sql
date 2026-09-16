-- GODAC V2 — hardening pass from the Supabase security advisor:
-- 1) pin search_path on every function so it can't be hijacked by a
--    session-level search_path change;
-- 2) the small security-definer helpers (current_role, is_direction,
--    etc.) are only ever meant to be called from inside RLS policies
--    on behalf of a signed-in user — never directly over the REST API
--    by an anonymous visitor. Supabase's default schema setup grants
--    EXECUTE directly to the `anon` role (not inherited via PUBLIC),
--    so that's what has to be revoked explicitly; `authenticated`
--    keeps EXECUTE because RLS policies evaluate under the querying
--    role and would otherwise fail for every signed-in user.

alter function public.set_updated_at() set search_path = public;
alter function public.current_app_user_id() set search_path = public;
alter function public.compute_fuel_entry_derived() set search_path = public;
alter function public.after_fuel_entry_trusted() set search_path = public;

revoke execute on function public.current_organization_id() from anon;
revoke execute on function public.current_role() from anon;
revoke execute on function public.current_user_service_ids() from anon;
revoke execute on function public.is_direction() from anon;
revoke execute on function public.is_manager_like() from anon;
