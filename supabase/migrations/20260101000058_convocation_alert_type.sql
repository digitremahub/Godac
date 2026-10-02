-- Isolated per Postgres's rule (a new enum value can't be used in the
-- same transaction that adds it) — same split as every prior
-- alert_type addition (024, 039, 042, 047, 054).
alter type alert_type add value if not exists 'convocation';
