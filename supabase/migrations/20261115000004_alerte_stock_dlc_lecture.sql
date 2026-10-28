-- Module « Stock » : alerte « DLC proche » (profils avec date limite : alimentaire,
-- médicaments et pharmacie, vrac, santé). Suite de 20261115000003 (valeur d'enum).
--
-- Même périmètre de lecture que les autres alertes du stock : le comptable ne les lit
-- pas ; un manager ne lit que celles de ses services (l'alerte DLC proche n'a pas de
-- service : seules la direction et l'exploitation la lisent).
-- Les deux policies reprennent EXACTEMENT celles de 20261114000004, avec le nouveau
-- type en plus dans chaque liste : aucun type existant n'est retiré (tournee_retard,
-- tournee_non_demarree, tournee_sans_chauffeur, echeance_vehicule, echeance_rh,
-- pointage_a_regulariser, paiement_echoue, planning_a_confirmer, planning_fusion,
-- stock_seuil, stock_ecart, stock_non_rentre).
-- `type::text` : fonctionne même si les valeurs d'enum ne sont pas appliquées.
--
-- ADDITIVE et rejouable ; NON appliquée à la création.

alter policy "alerts: read within org for manager-like and comptable" on public.alerts
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_role() = 'direction'
      or (
        public.current_role() = 'comptable'
        and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer', 'planning_fusion', 'stock_seuil', 'stock_ecart', 'stock_non_rentre', 'stock_dlc_proche')
      )
      or (
        public.current_role() in ('manager', 'manager_chauffeur')
        and (
          service_id = any (public.current_user_service_ids())
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer', 'planning_fusion', 'stock_seuil', 'stock_ecart', 'stock_non_rentre', 'stock_dlc_proche'))
        )
      )
      or (
        public.is_exploitation()
        and (
          cardinality(recipient_roles) = 0
          or recipient_roles::text[] && array['manager', 'manager_chauffeur', 'exploitation']::text[]
        )
      )
    )
  );

alter policy "alerts: manager-like can acknowledge" on public.alerts
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_role() = 'direction'
      or (
        public.current_role() in ('manager', 'manager_chauffeur')
        and (
          service_id = any (public.current_user_service_ids())
          or (service_id is null and type::text not in ('tournee_retard', 'tournee_non_demarree', 'tournee_sans_chauffeur', 'echeance_vehicule', 'echeance_rh', 'pointage_a_regulariser', 'paiement_echoue', 'planning_a_confirmer', 'planning_fusion', 'stock_seuil', 'stock_ecart', 'stock_non_rentre', 'stock_dlc_proche'))
        )
      )
      or (
        public.is_exploitation()
        and (
          cardinality(recipient_roles) = 0
          or recipient_roles::text[] && array['manager', 'manager_chauffeur', 'exploitation']::text[]
        )
      )
    )
  );

notify pgrst, 'reload schema';
