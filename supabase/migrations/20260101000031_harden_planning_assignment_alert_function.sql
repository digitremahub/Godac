-- Supabase grants EXECUTE to PUBLIC at function-creation time
-- regardless of the anon/authenticated revokes issued in the same
-- migration (confirmed via information_schema.routine_privileges for
-- after_vehicle_intervention_insert() in 20260101000026) — this
-- trigger function needs the same follow-up revoke, run once the
-- CREATE FUNCTION transaction has committed.
revoke execute on function public.after_planning_entry_upsert() from public;
