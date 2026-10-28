-- Module « Stock » : type d'alerte stock_dlc_proche (lots ou unités dont la date limite
-- approche : J-n selon la règle du profil, 30 jours par défaut pour les références en vrac).
-- Relayée en cloche, push et e-mail à la direction et à l'exploitation (jamais aux
-- chauffeurs ni au comptable).
--
-- Fichier séparé : une nouvelle valeur d'enum ne peut pas être utilisée dans la
-- transaction qui l'ajoute (périmètre de lecture dans 20261115000004).
-- ADDITIVE et rejouable. NON appliquée à la création : tant qu'elle ne l'est pas,
-- l'alerte n'est simplement pas créée (la liste des articles montre la même information).
alter type public.alert_type add value if not exists 'stock_dlc_proche';
