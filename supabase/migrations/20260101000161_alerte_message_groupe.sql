-- Groupes d'équipe du Messenger : une mention @prénom (ou @tous) et une
-- « Info équipe » deviennent une alerte du destinataire, routée par
-- le pipeline e-mail + push existant (app/api/webhooks/supabase-alerts).
-- Les messages ordinaires partent en push direct depuis
-- app/api/messenger/groupes/[id]/messages/route.ts, sans e-mail.
alter type alert_type add value if not exists 'group_message';
