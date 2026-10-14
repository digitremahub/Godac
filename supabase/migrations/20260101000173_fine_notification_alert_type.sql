-- Allow the fines module to create a driver notification alert.
-- Keep this enum addition in its own migration so it is committed before use.
alter type alert_type add value if not exists 'fine_notification';
