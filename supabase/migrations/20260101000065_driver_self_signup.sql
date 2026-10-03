-- GODAC V2 — self-service driver onboarding: one reusable, regenerable
-- link/QR per organization (not per-driver, unlike the Lot 7 badge),
-- posted once at the depot. A new chauffeur scans it, enters their own
-- name, and the account is created as a 'chauffeur' — but it cannot
-- actually sign in (requireAppUser treats pending_approval like a
-- deactivated account) until a chef de service/responsable
-- exploitation (manager/manager_chauffeur) or direction approves it
-- from /driver-signups. Setting a PIN at first scan is still allowed
-- while pending (auth_method='pin' + active=true already covers that
-- check in app/api/auth/driver-pin/[id]/set) so the driver doesn't
-- have to come back for a second visit once approved.
alter table organizations add column driver_signup_token uuid not null default gen_random_uuid();

alter table users add column pending_approval boolean not null default false;
