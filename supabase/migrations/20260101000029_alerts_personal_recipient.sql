-- GODAC V2 — personal (single-user) alert targeting.
--
-- Every alert so far broadcasts to a set of roles (recipient_roles) —
-- fine for "a manager should look at this", useless for "you, the
-- driver, were just assigned this tour". Chauffeurs also never had
-- read access to /alerts at all (the RLS select policy only matches
-- manager-like roles), so a personal notification needs both a
-- recipient column and its own read/acknowledge policies rather than
-- widening the existing role-broadcast ones.
alter table alerts add column recipient_user_id uuid references users (id) on delete cascade;

create policy "alerts: recipient reads own"
  on alerts for select
  using (
    organization_id = public.current_organization_id()
    and recipient_user_id = public.current_app_user_id()
  );

create policy "alerts: recipient acknowledges own"
  on alerts for update
  using (
    organization_id = public.current_organization_id()
    and recipient_user_id = public.current_app_user_id()
  )
  with check (
    organization_id = public.current_organization_id()
    and recipient_user_id = public.current_app_user_id()
  );
