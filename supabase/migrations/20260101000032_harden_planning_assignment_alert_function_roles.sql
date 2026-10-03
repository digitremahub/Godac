-- Follow-up to 20260101000031: unlike after_vehicle_intervention_insert
-- (which only needed the PUBLIC grant revoked, anon/authenticated
-- having already been revoked inline with its CREATE FUNCTION), this
-- function's anon and authenticated EXECUTE grants were still present
-- after that migration (confirmed via
-- information_schema.routine_privileges) since this one never revoked
-- them inline at all. Revoke them explicitly too.
revoke execute on function public.after_planning_entry_upsert() from anon, authenticated;
