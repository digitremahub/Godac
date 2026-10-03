-- GODAC V2 — new alert_type value for maintenance-request
-- notifications (see the following migration for the trigger that
-- uses it). Split into its own migration/transaction: Postgres
-- forbids using a freshly added enum value in the same transaction
-- that added it.
alter type alert_type add value if not exists 'maintenance_request';
