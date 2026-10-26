-- Exploitation, lot 1 : types d'alerte « tournée non démarrée » et
-- « tournée sans chauffeur », créés toutes les 5 minutes par le cron
-- /api/cron/surveillance-tournees (aujourd'hui et demain), relayés en
-- cloche, push et e-mail comme les retards, puis clos tout seuls quand la
-- condition disparaît (tournée démarrée, chauffeur affecté).
--
-- Fichier séparé : une nouvelle valeur d'enum ne peut pas être utilisée
-- dans la transaction qui l'ajoute (l'index unique est dans 20261106000002).
-- ADDITIVE et rejouable. NON appliquée à la création : tant qu'elle ne
-- l'est pas, le cron ne crée simplement pas ces deux alertes.
alter type public.alert_type add value if not exists 'tournee_non_demarree';
alter type public.alert_type add value if not exists 'tournee_sans_chauffeur';
