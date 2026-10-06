-- GODAC V2 — active pg_cron (jamais activé jusqu'ici, voir advisors)
-- et planifie la purge 90 jours des conversations de l'assistant : la
-- fonction public.cleanup_old_assistant_conversations() existait déjà
-- (migration 20260101000053_assistant_tables.sql) mais n'était
-- appelée par rien — documenté comme "à faire" dans le README.
create extension if not exists pg_cron with schema extensions;
select cron.schedule('assistant-cleanup', '0 3 * * *', 'select public.cleanup_old_assistant_conversations()');
