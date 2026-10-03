-- Supabase grants EXECUTE to PUBLIC at function-creation time
-- independently of any REVOKE FROM anon, authenticated in the same
-- migration — this closes that gap for
-- after_vehicle_intervention_insert() (see the previous migration).
revoke execute on function public.after_vehicle_intervention_insert() from public;
