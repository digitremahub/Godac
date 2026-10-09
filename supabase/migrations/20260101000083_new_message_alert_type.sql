-- Messenger shipped with no notification at all — a recipient only
-- found out about a message by opening /messenger themselves. Adds
-- the enum value app/api/messenger/send/route.ts now inserts an
-- alert with, routed through the existing email+push pipeline.
alter type alert_type add value 'new_message';
