-- Planning / RH / paie, lot 3 : nouveaux types d'alerte.
--
--  - echeance_rh : permis de conduire, visite médicale, fin de contrat et
--    documents du salarié (titre de séjour, diplôme, pièce d'identité) qui
--    arrivent à échéance. Créée une fois par jour par /api/cron/rh-quotidien
--    aux paliers J-60, J-30, J-7 et J0, close quand le document est renouvelé.
--  - pointage_a_regulariser : pointage resté ouvert, clos automatiquement par
--    le même cron avec une sortie estimée, à corriger par l'encadrement.
--  - paiement_echoue : facture Stripe impayée (webhook invoice.payment_failed),
--    pour la direction.
--
-- Fichier séparé : une nouvelle valeur d'enum ne peut pas être utilisée dans
-- la transaction qui l'ajoute (colonnes, index et policies sont dans
-- 20261109000002). ADDITIVE et rejouable. NON appliquée à la création : tant
-- qu'elle ne l'est pas, ces alertes ne sont simplement pas créées (« À traiter »
-- calcule les pointages à régulariser directement depuis la table).
alter type public.alert_type add value if not exists 'echeance_rh';
alter type public.alert_type add value if not exists 'pointage_a_regulariser';
alter type public.alert_type add value if not exists 'paiement_echoue';
