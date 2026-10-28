-- Module « Stock » : types d'alerte.
--   stock_seuil       un article est passé sous son seuil mini
--   stock_ecart       un inventaire validé a révélé des écarts
--   stock_non_rentre  des unités chargées en tournée ne sont pas rentrées après la clôture
-- Relayés en cloche, push et e-mail à la direction, l'exploitation et aux managers
-- du service (jamais aux chauffeurs ni au comptable).
--
-- Fichier séparé : une nouvelle valeur d'enum ne peut pas être utilisée dans la
-- transaction qui l'ajoute (périmètre de lecture dans 20261114000004).
-- ADDITIVE et rejouable. NON appliquée à la création : tant qu'elle ne l'est pas,
-- ces alertes ne sont simplement pas créées (le tableau de bord du stock montre
-- les mêmes informations).
alter type public.alert_type add value if not exists 'stock_seuil';
alter type public.alert_type add value if not exists 'stock_ecart';
alter type public.alert_type add value if not exists 'stock_non_rentre';
