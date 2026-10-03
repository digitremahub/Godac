-- GODAC V2 — fallback driver code for fuel-entry identification.
--
-- The QR scanner's manual fallback only ever accepted a raw UUID
-- pasted in by hand — unusable in practice (nobody memorises a UUID).
-- This gives every user a short, memorable, per-organisation-unique
-- numeric code they can read off their badge or recite from memory at
-- a shared pump when they don't have the physical badge on them.
alter table users add column driver_code text;

-- One-time backfill for every existing user: sequential 6-digit codes
-- per organisation, trivially unique by construction.
update users u
set driver_code = lpad((99999 + sub.rn)::text, 6, '0')
from (
  select id, row_number() over (partition by organization_id order by created_at, id) as rn
  from users
) sub
where u.id = sub.id;

alter table users alter column driver_code set not null;
alter table users add constraint users_org_driver_code_unique unique (organization_id, driver_code);

-- Assigns a fresh code to every new user automatically (both the
-- email-invite and the no-email/PIN creation paths insert through the
-- admin client — see lib/auth/provisioning.ts and lib/auth/driver-pin.ts
-- — neither sets driver_code itself, so this is the single place that
-- guarantees every account gets one).
create or replace function public.assign_driver_code()
returns trigger
language plpgsql
as $$
declare
  candidate text;
begin
  if new.driver_code is not null then
    return new;
  end if;
  loop
    candidate := lpad((100000 + floor(random() * 900000))::text, 6, '0');
    exit when not exists (
      select 1 from users where organization_id = new.organization_id and driver_code = candidate
    );
  end loop;
  new.driver_code := candidate;
  return new;
end;
$$;

create trigger users_assign_driver_code
  before insert on users
  for each row
  execute function public.assign_driver_code();
