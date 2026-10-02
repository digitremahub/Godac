-- GODAC V2 — leave replacement planning for direction, separate from
-- the work planning (planning_entries): which driver covers for
-- someone on approved leave. A plain nullable FK on leave_requests
-- rather than a new table — there's at most one replacement per leave
-- request, not a many-to-many relationship worth its own table.
alter table leave_requests add column replacement_driver_id uuid references users (id) on delete set null;
