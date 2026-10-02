-- GODAC V2 — new alert_type value for tour-distance anomalies (see
-- the following migration for the trigger that uses it). Split into
-- its own migration/transaction: Postgres forbids using a freshly
-- added enum value in the same transaction that added it — same
-- pattern as 20260101000024_maintenance_request_alert_type.sql.
alter type alert_type add value if not exists 'odometer_anomaly';
