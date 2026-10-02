-- GODAC V2 — new alert_type value for support_requests. Must be its
-- own migration/transaction (Postgres forbids using a new enum value
-- in the same transaction that adds it) — see every prior alert_type
-- addition (024, 039, 042, 047) for the same split.
alter type alert_type add value if not exists 'support_request';
